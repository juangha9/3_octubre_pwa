// ============================================================
// Edge Function: osinergmin-cron  (ACTUALIZACIÓN AUTOMÁTICA)
// ============================================================
// Descarga el Excel de OSINERGMIN, lo parsea EN EL SERVIDOR con un lector
// liviano (fflate + lectura directa del XML, SIN SheetJS) para caber en los
// límites del edge (256MB/CPU), calcula el ranking de la zona y guarda el
// snapshot + top10. Pensada para el cron horario (pg_cron), pero también la
// puede disparar el superadmin para probar.
//
// REGLAS DEL RANKING (deben reflejar lo que publica OSINERGMIN en facilito):
//
//  · ZONA = DEPARTAMENTO + PROVINCIA + DISTRITO. El distrito NO basta: hay 36
//    nombres de distrito repetidos en el país (MIRAFLORES está en Arequipa y
//    en Lima). Filtrar solo por distrito mezclaba grifos de otra ciudad.
//  · La unidad que compite es el ESTABLECIMIENTO (CODIGO_OSINERG), NO el RUC:
//    una empresa puede tener varios grifos en el mismo distrito (COESTI tiene
//    2 en Miraflores) y OSINERGMIN los lista por separado. Agrupar por RUC
//    borraba competidores y descuadraba todos los puestos siguientes.
//  · Orden: precio ascendente. Empate → primero el que registró su precio
//    antes (FCHA_REGISTRO). Segundo empate → CODIGO_OSINERG, para que el orden
//    sea DETERMINISTA y no dependa de cómo venga ordenado el Excel.
//
// Los nombres de columna se resuelven contra una lista de alias normalizada
// (sin tildes, sin guiones bajos). Si falta una columna obligatoria la función
// ABORTA con un error explícito, y si falta una opcional lo devuelve en
// `avisos`: un cambio de cabecera de OSINERGMIN nunca debe degradar el ranking
// en silencio (así se coló durante meses el desempate roto: el Excel llama a
// la columna FCHA_REGISTRO —sin la "E"— y el código buscaba FECHA_REGISTRO).
//
// Se salta la escritura si el ranking/precio no cambió respecto al último
// snapshot (evita ensuciar el historial con 24 filas idénticas al día).
//
// Slug en Supabase: osinergmin-cron  ·  Verify JWT: DESACTIVADO.
// ============================================================
import { serve } from 'https://deno.land/std@0.208.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { unzipSync, strFromU8 } from 'https://esm.sh/fflate@0.8.2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
// Secreto propio para autenticar al cron (header x-cron-secret). Se define como
// secreto de la función; el gateway no toca los headers personalizados, a
// diferencia de Authorization con la service_role key.
const CRON_SECRET = Deno.env.get('CRON_SECRET') ?? ''

// CORS para que el botón manual (navegador, superadmin) también pueda llamarla.
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const jsonHeaders = { ...CORS, 'Content-Type': 'application/json' }
const toCentimos = (p: number) => (isNaN(p) ? 0 : Math.round(p * 100))

// Nombre de columna → forma canónica: solo A–Z y 0–9. NFD separa la tilde de
// su letra y el filtro se la lleva, así que 'PROVINCIA', 'Província' y
// 'PROVINCIA ' colapsan al mismo alias y una cabecera nueva de OSINERGMIN no
// rompe el parseo por un guion bajo o un acento de más.
const canon = (s: string) =>
  s.normalize('NFD').toUpperCase().replace(/[^A-Z0-9]/g, '')

// Columnas que necesita el ranking. `alias` va en orden de preferencia; la
// primera que exista en el Excel gana. `req`: sin ella el ranking sería FALSO
// (no incompleto), así que la función aborta en vez de publicar un ranking malo.
const COLUMNAS = {
  ruc:          { req: true,  alias: ['RUC'] },
  departamento: { req: true,  alias: ['DEPARTAMENTO'] },
  provincia:    { req: true,  alias: ['PROVINCIA'] },
  distrito:     { req: true,  alias: ['DISTRITO'] },
  producto:     { req: true,  alias: ['PRODUCTO'] },
  precio:       { req: true,  alias: ['PRECIO_VENTA', 'PRECIO'] },
  // Identifica al ESTABLECIMIENTO (dos grifos de un mismo RUC en el distrito).
  codigo:       { req: false, alias: ['CODIGO_OSINERG', 'CODIGO_OSINERGMIN', 'NRO_REGISTRO'] },
  razon:        { req: false, alias: ['RAZON', 'RAZON_SOCIAL'] },
  direccion:    { req: false, alias: ['DIRECCION'] },
  // OJO: en el Excel real es FCHA_REGISTRO (sin la "E"). Solo desempata.
  fecha:        { req: false, alias: ['FCHA_REGISTRO', 'FECHA_REGISTRO', 'FECHA_HORA', 'FECHA_PRECIO', 'FECHA_ACTUALIZACION', 'FECHA'] },
  activo:       { req: false, alias: ['PRODUCTO_ACTIVO'] },
} as const

type Campo = keyof typeof COLUMNAS

// ── Parser liviano del .xlsx (validado contra SheetJS) ────────
// Memoria acotada: resuelve la cabecera primero y en las filas de datos guarda
// SOLO las columnas pedidas (no las 18), para caber en el edge sin tocar 546.
function parseXlsx(u8: Uint8Array, needed: string[]) {
  const files = unzipSync(u8, {
    filter: (f) => /xl\/(worksheets\/sheet1\.xml|sharedStrings\.xml)$/.test(f.name),
  })
  const sstXml = files['xl/sharedStrings.xml'] ? strFromU8(files['xl/sharedStrings.xml']) : ''
  const sst: string[] = []
  const siRe = /<si>([\s\S]*?)<\/si>/g
  let m: RegExpExecArray | null
  while ((m = siRe.exec(sstXml))) {
    let s = ''
    const tRe = /<t[^>]*>([\s\S]*?)<\/t>/g
    let tm: RegExpExecArray | null
    while ((tm = tRe.exec(m[1]))) s += tm[1]
    sst.push(s)
  }

  const decode = (s: string) =>
    s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))

  // Extrae las celdas de una fila como { letra → valor } (resolviendo cadenas).
  const cellRe = /<c r="([A-Z]+)\d+"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g
  const parseCells = (rowXml: string, keep?: Set<string>) => {
    const cells: Record<string, string> = {}
    let cm: RegExpExecArray | null
    cellRe.lastIndex = 0
    while ((cm = cellRe.exec(rowXml))) {
      const col = cm[1]
      if (keep && !keep.has(col)) continue
      const vt = /<v>([\s\S]*?)<\/v>/.exec(cm[3] ?? '')
      if (!vt) continue
      cells[col] = /t="s"/.test(cm[2] ?? '') ? (sst[+vt[1]] ?? '') : vt[1]
    }
    return cells
  }

  const sheetXml = strFromU8(files['xl/worksheets/sheet1.xml'])
  const rowRe = /<row\b[^>]*>([\s\S]*?)<\/row>/g

  // Cabecera (fila 1): nombre CANÓNICO de columna → letra
  const first = rowRe.exec(sheetXml)
  const letraDe: Record<string, string> = {}
  const cabecera: string[] = []
  if (first) {
    const head = parseCells(first[1])
    for (const [letra, name] of Object.entries(head)) {
      const bruto = decode(name).trim()
      cabecera.push(bruto)
      letraDe[canon(bruto)] = letra
    }
  }
  const keep = new Set(needed.map((n) => letraDe[n]).filter(Boolean))

  // Filas de datos: solo las columnas necesarias.
  const rows: Record<string, string>[] = []
  let rm: RegExpExecArray | null
  while ((rm = rowRe.exec(sheetXml))) rows.push(parseCells(rm[1], keep))

  return { rows, letraDe, cabecera, decode }
}

async function run(): Promise<{ status: number; body: unknown }> {
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE)

  const [{ data: cfgRows }, { data: tipos }] = await Promise.all([
    admin.from('app_config').select('clave, valor').in('clave', ['osinergmin_url_excel', 'osinergmin_ruc']),
    admin.from('tipos_combustible').select('codigo, nombre_osinergmin').eq('activo', true),
  ])
  const cfg = Object.fromEntries((cfgRows ?? []).map((r) => [r.clave, r.valor]))
  const url = (cfg['osinergmin_url_excel'] ?? '').trim()
  const ruc = (cfg['osinergmin_ruc'] ?? '').trim()
  if (!url) return { status: 400, body: { error: 'Falta osinergmin_url_excel' } }
  if (!ruc) return { status: 400, body: { error: 'Falta osinergmin_ruc' } }
  const productos = (tipos ?? []).map((t) => ({
    codigo: t.codigo as string,
    nombreExcel: String(t.nombre_osinergmin).trim().toUpperCase(),
  }))

  const resp = await fetch(url, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
      Accept: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,*/*',
    },
    redirect: 'follow',
  })
  if (!resp.ok) return { status: 502, body: { error: `No se pudo descargar el Excel (HTTP ${resp.status})` } }

  // ── Resolución de columnas por alias canónico ──
  const alias = Object.values(COLUMNAS).flatMap((c) => c.alias.map(canon))
  const { rows, letraDe, cabecera, decode } = parseXlsx(new Uint8Array(await resp.arrayBuffer()), alias)

  const avisos: string[] = []
  const col = {} as Record<Campo, string | undefined>
  const faltan: string[] = []
  for (const [campo, def] of Object.entries(COLUMNAS) as [Campo, typeof COLUMNAS[Campo]][]) {
    col[campo] = def.alias.map((a) => letraDe[canon(a)]).find(Boolean)
    if (col[campo]) continue
    if (def.req) faltan.push(`${campo} (${def.alias.join(' | ')})`)
    else avisos.push(`No se encontró la columna "${campo}" (${def.alias.join(' | ')}) en el Excel.`)
  }
  if (faltan.length > 0) {
    return {
      status: 422,
      body: {
        error: `El Excel cambió de formato: faltan columnas obligatorias → ${faltan.join(', ')}.`,
        cabecera_recibida: cabecera,
      },
    }
  }

  const norm = (v: string | undefined) => decode(v ?? '').trim()
  const val = (fila: Record<string, string>, campo: Campo) => {
    const c = col[campo]
    return c ? norm(fila[c]) : ''
  }
  // Clave ordenable de la fecha de registro: acepta el serial numérico de Excel
  // o texto "dd/mm/yyyy [hh:mm[:ss]]". Sin fecha → Infinity (pierde el empate).
  const fechaClave = (s: string): number => {
    if (!s) return Infinity
    const n = Number(s)
    if (!isNaN(n) && n > 0) return n
    const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/.exec(s)
    if (m) return Date.UTC(+m[3], +m[2] - 1, +m[1], +(m[4] ?? '0'), +(m[5] ?? '0'), +(m[6] ?? '0'))
    const t = Date.parse(s)
    return isNaN(t) ? Infinity : t
  }

  // ── Zona de nuestro grifo: DEPARTAMENTO + PROVINCIA + DISTRITO ──
  // Con el distrito solo, 'MIRAFLORES' arrastraba también los grifos de Lima.
  const nuestras = rows.filter((f) => val(f, 'ruc') === ruc)
  if (nuestras.length === 0) {
    return { status: 404, body: { error: `No se encontró el RUC ${ruc} en el Excel.` } }
  }
  const zona = {
    departamento: val(nuestras[0], 'departamento'),
    provincia: val(nuestras[0], 'provincia'),
    distrito: val(nuestras[0], 'distrito'),
  }
  // Si el RUC tuviera grifos en varias zonas, cuál se rankea dependería del
  // orden del Excel. Se rankea la primera, pero avisando (no en silencio).
  const zonasDelRuc = new Set(
    nuestras.map((f) => `${val(f, 'departamento')}|${val(f, 'provincia')}|${val(f, 'distrito')}`),
  )
  if (zonasDelRuc.size > 1) {
    avisos.push(
      `El RUC ${ruc} tiene grifos en ${zonasDelRuc.size} zonas; se rankea ${zona.distrito}, ${zona.provincia}.`,
    )
  }
  const mismaZona = (f: Record<string, string>) =>
    canon(val(f, 'departamento')) === canon(zona.departamento) &&
    canon(val(f, 'provincia')) === canon(zona.provincia) &&
    canon(val(f, 'distrito')) === canon(zona.distrito)

  // Clave del ESTABLECIMIENTO (lo que compite en el ranking). Sin
  // CODIGO_OSINERG, RUC+dirección sigue separando dos grifos de una misma
  // empresa; solo si tampoco hay dirección se cae a agrupar por RUC.
  const claveEst = (f: Record<string, string>) =>
    val(f, 'codigo') || `${val(f, 'ruc')}|${val(f, 'direccion')}`

  type Reg = {
    key: string; ruc: string; razon: string; direccion: string
    producto: string; precio: number; fecha: number
  }
  const enZona: Reg[] = []
  const establecimientosZona = new Set<string>()
  for (const f of rows) {
    if (!mismaZona(f)) continue
    establecimientosZona.add(claveEst(f))
    // PRODUCTO_ACTIVO = 'NO' → OSINERGMIN no lo lista como oferta vigente.
    if (val(f, 'activo').toUpperCase() === 'NO') continue
    enZona.push({
      key: claveEst(f),
      ruc: val(f, 'ruc'),
      razon: val(f, 'razon'),
      direccion: val(f, 'direccion'),
      producto: val(f, 'producto').toUpperCase(),
      precio: Number(val(f, 'precio')) || 0,
      fecha: fechaClave(val(f, 'fecha')),
    })
  }

  const snapshot: Record<string, number | null> = {
    ranking_db5: null, precio_db5_centimos: null, total_db5: null,
    ranking_regular: null, precio_regular_centimos: null, total_regular: null,
    ranking_premium: null, precio_premium_centimos: null, total_premium: null,
  }
  const top10: {
    producto: string; ranking: number; razon_social: string; direccion: string
    codigo_osinerg: string; precio_centimos: number; es_nuestro: boolean
  }[] = []

  for (const p of productos) {
    const items = enZona.filter((r) => r.producto === p.nombreExcel && r.precio > 0)
    // Un establecimiento aporta UNA fila por producto (su último precio). Si el
    // Excel repitiera el establecimiento, se queda la fecha MÁS RECIENTE: es su
    // precio vigente, no el más barato que llegó a tener.
    const porEst = new Map<string, Reg>()
    for (const it of items) {
      const prev = porEst.get(it.key)
      if (!prev || it.fecha > prev.fecha) porEst.set(it.key, it)
    }
    // Orden: precio asc → registró antes → CODIGO_OSINERG. El último criterio
    // hace el ranking DETERMINISTA: sin él, los empates quedaban al azar del
    // orden del Excel y el puesto bailaba entre una corrida y la siguiente.
    const lista = [...porEst.values()].sort(
      (a, b) => a.precio - b.precio || a.fecha - b.fecha || a.key.localeCompare(b.key),
    )
    if (lista.length === 0) continue

    // "Nosotros" = todos los establecimientos de nuestro RUC en la zona (si el
    // grifo abre un segundo local, aparecen los dos resaltados). El puesto del
    // snapshot es el MEJOR de ellos.
    const ourIdx = lista.findIndex((x) => x.ruc === ruc)
    const total = lista.length
    if (p.codigo === 'DB5') snapshot.total_db5 = total
    if (p.codigo === 'REGULAR') snapshot.total_regular = total
    if (p.codigo === 'PREMIUM') snapshot.total_premium = total
    if (ourIdx >= 0) {
      const nuestro = lista[ourIdx]
      const rk = ourIdx + 1
      if (p.codigo === 'DB5') { snapshot.ranking_db5 = rk; snapshot.precio_db5_centimos = toCentimos(nuestro.precio) }
      if (p.codigo === 'REGULAR') { snapshot.ranking_regular = rk; snapshot.precio_regular_centimos = toCentimos(nuestro.precio) }
      if (p.codigo === 'PREMIUM') { snapshot.ranking_premium = rk; snapshot.precio_premium_centimos = toCentimos(nuestro.precio) }
    }
    // Top 10; si nuestro grifo queda fuera del 10, la lista crece hasta incluir
    // nuestra posición (para que siempre aparezcamos).
    const hasta = ourIdx >= 10 ? ourIdx + 1 : 10
    lista.slice(0, hasta).forEach((x, i) => {
      top10.push({
        producto: p.codigo, ranking: i + 1,
        razon_social: x.razon, direccion: x.direccion, codigo_osinerg: x.key,
        precio_centimos: toCentimos(x.precio), es_nuestro: x.ruc === ruc,
      })
    })
  }

  // Dedup por TODO el Top 10 (competencia incluida), no solo nuestros valores:
  // si la lista completa es idéntica a la del último snapshot, NO se crea fila
  // nueva (evita historial ruidoso); solo se refresca la fecha para mostrar que
  // sigue vigente. Si CUALQUIER precio/orden del Top 10 cambió → snapshot nuevo.
  // Los totales van en la huella aparte: un competidor que entra o sale de la
  // zona sin tocar el Top 10 igual cambia el "de N" y merece snapshot propio.
  const totalEstablecimientos = establecimientosZona.size
  type T10 = {
    producto: string; ranking: number; razon_social: string
    codigo_osinerg: string | null; precio_centimos: number; es_nuestro: boolean
  }
  const fp = (arr: T10[], totales: (number | null)[]) =>
    JSON.stringify([
      [...arr]
        .sort((a, b) => (a.producto === b.producto ? a.ranking - b.ranking : a.producto < b.producto ? -1 : 1))
        .map((t) => [t.producto, t.ranking, t.razon_social, t.codigo_osinerg ?? '', t.precio_centimos, t.es_nuestro]),
      totales,
    ])
  const totalesNuevos = [
    totalEstablecimientos, snapshot.total_db5, snapshot.total_regular, snapshot.total_premium,
  ]
  const { data: prev } = await admin
    .from('osinergmin_snapshots')
    .select('id, total_establecimientos, total_db5, total_regular, total_premium')
    .order('fecha_consulta', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (prev) {
    const { data: prevTop } = await admin
      .from('osinergmin_top10')
      .select('producto, ranking, razon_social, codigo_osinerg, precio_centimos, es_nuestro')
      .eq('snapshot_id', prev.id)
    const totalesPrev = [
      prev.total_establecimientos, prev.total_db5, prev.total_regular, prev.total_premium,
    ]
    if (fp(top10, totalesNuevos) === fp((prevTop as T10[]) ?? [], totalesPrev)) {
      await admin
        .from('osinergmin_snapshots')
        .update({ fecha_consulta: new Date().toISOString() })
        .eq('id', prev.id)
      return { status: 200, body: { ok: true, skipped: true, ...zona, avisos } }
    }
  }

  const { data: snap, error: snapErr } = await admin
    .from('osinergmin_snapshots')
    .insert({
      fecha_datos_excel: new Date().toISOString().slice(0, 10),
      ...zona,
      total_establecimientos: totalEstablecimientos,
      ...snapshot,
    })
    .select('id')
    .single()
  if (snapErr) return { status: 500, body: { error: `Error snapshot: ${snapErr.message}` } }
  if (top10.length > 0) {
    const { error: e } = await admin.from('osinergmin_top10').insert(top10.map((t) => ({ ...t, snapshot_id: snap.id })))
    if (e) return { status: 500, body: { error: `Error top10: ${e.message}` } }
  }
  return {
    status: 200,
    body: { ok: true, ...zona, total_establecimientos: totalEstablecimientos, avisos },
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  try {
    // Autorización: el cron manda nuestro secreto propio (x-cron-secret), que
    // el gateway NO transforma (a diferencia de Authorization con service_role).
    // Alternativa: un superadmin con su sesión (para disparo manual).
    const cronSecret = req.headers.get('x-cron-secret') ?? ''
    const esCron = CRON_SECRET !== '' && cronSecret === CRON_SECRET
    if (!esCron) {
      const authHeader = req.headers.get('Authorization') ?? ''
      const asUser = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } })
      const { data: u } = await asUser.auth.getUser()
      if (!u?.user) return new Response(JSON.stringify({ error: 'No autenticado' }), { status: 401, headers: jsonHeaders })
      const admin = createClient(SUPABASE_URL, SERVICE_ROLE)
      const { data: prof } = await admin.from('profiles').select('rol').eq('id', u.user.id).single()
      if (prof?.rol !== 'superadmin') return new Response(JSON.stringify({ error: 'No autorizado' }), { status: 403, headers: jsonHeaders })
    }
    const { status, body } = await run()
    return new Response(JSON.stringify(body), { status, headers: jsonHeaders })
  } catch (e) {
    return new Response(JSON.stringify({ error: `Error inesperado: ${(e as Error).message}` }), { status: 500, headers: jsonHeaders })
  }
})
