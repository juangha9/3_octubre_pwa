// ============================================================
// Edge Function: osinergmin-cron  (ACTUALIZACIÓN AUTOMÁTICA DEL RANKING)
// ============================================================
// Fuente OFICIAL: FACILITO (la web de OSINERGMIN, base VIVA, leída por GET —el
// reCAPTCHA v3 gatea el POST del navegador, no este GET a datos públicos). Es
// fresca: refleja un precio en cuanto se declara, no ~18 h después como el
// Excel EVPC.
//
// RESPALDO: el Excel EVPC. Si Facilito falla (HTTP), viene incompleto (algún
// producto con 0 filas, o no aparece nuestro establecimiento) o cambió de
// formato, se cae al Excel. Si TAMBIÉN falla el Excel, no se escribe nada: el
// front conserva el último snapshot y avisa. Cada snapshot guarda su `fuente`
// ('facilito' | 'excel') para que el ranking muestre de dónde salió y su
// frescura.
//
// REGLAS DEL RANKING (deben reflejar lo que publica OSINERGMIN en facilito):
//  · ZONA = DEPARTAMENTO + PROVINCIA + DISTRITO (hay 36 distritos homónimos).
//  · La unidad que compite es el ESTABLECIMIENTO (CODIGO_OSINERG), NO el RUC.
//  · Orden: precio ascendente. Facilito ya viene en el orden canónico de
//    OSINERGMIN (incluye su desempate); el Excel desempata por FCHA_REGISTRO.
//
// Config en app_config: la zona de Facilito (códigos INEI) y nuestro
// CODIGO_OSINERG para la fuente en vivo; el RUC y la URL del Excel para el
// respaldo. Se salta la escritura si el ranking/precio/fuente no cambió.
//
// Slug en Supabase: osinergmin-cron  ·  Verify JWT: DESACTIVADO.
// ============================================================
import { serve } from 'https://deno.land/std@0.208.0/http/server.ts'
import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { unzipSync, strFromU8 } from 'https://esm.sh/fflate@0.8.2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
const CRON_SECRET = Deno.env.get('CRON_SECRET') ?? ''

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const jsonHeaders = { ...CORS, 'Content-Type': 'application/json' }
const toCentimos = (p: number) => (isNaN(p) ? 0 : Math.round(p * 100))

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36'

// Nombre de columna → forma canónica: solo A–Z y 0–9 (para el Excel).
const canon = (s: string) =>
  s.normalize('NFD').toUpperCase().replace(/[^A-Z0-9]/g, '')

// ── Shape común que producen las dos fuentes ──────────────────
type Producto = { codigo: string; nombreExcel: string; facilito: string }
type T10Row = {
  producto: string; ranking: number; razon_social: string; direccion: string
  codigo_osinerg: string; precio_centimos: number; es_nuestro: boolean
}
type Snapshot = Record<string, number | null>
type Resultado = {
  fuente: 'facilito' | 'excel'
  zona: { departamento: string; provincia: string; distrito: string }
  snapshot: Snapshot
  top10: T10Row[]
  totalEstablecimientos: number
  avisos: string[]
}

const snapshotVacio = (): Snapshot => ({
  ranking_db5: null, precio_db5_centimos: null, total_db5: null,
  ranking_regular: null, precio_regular_centimos: null, total_regular: null,
  ranking_premium: null, precio_premium_centimos: null, total_premium: null,
})

// Escribe en el snapshot los 3 campos de un producto según su código.
function setProducto(snap: Snapshot, codigo: string, rk: number | null, precio: number | null, total: number | null) {
  const k = codigo === 'DB5' ? 'db5' : codigo === 'REGULAR' ? 'regular' : 'premium'
  snap[`ranking_${k}`] = rk
  snap[`precio_${k}_centimos`] = precio
  snap[`total_${k}`] = total
}

// ══════════════════════════════════════════════════════════════
// FUENTE OFICIAL — Facilito (en vivo)
// ══════════════════════════════════════════════════════════════

const limpiar = (s: string) =>
  s.replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/\s+/g, ' ').trim()

// Fila del buscador de Facilito (regex VALIDADO del spike, sin tocar):
//   <tr onclick="...irMapa('CODIGO',N)..."> <th>DISTRITO</th>
//     <td>RAZON</td> <td>DIRECCION</td> <td>TELEFONO</td>
//     <td>…align="center">PRECIO</td> </tr>
const ROW =
  /irMapa\('(\d+)'[^>]*>[\s\S]*?<td>([\s\S]*?)<\/td>[\s\S]*?<td>([\s\S]*?)<\/td>[\s\S]*?<td>([\s\S]*?)<\/td>[\s\S]*?align="center">\s*([\d.]+)/g
// El nombre del distrito es el mismo para toda la zona: se saca UNA vez del
// <th> de la primera fila, aparte, para NO arriesgar la captura de filas de
// arriba (si el <th> no estuviera donde se espera, solo se pierde el nombre,
// no las filas → Facilito sigue funcionando).
const TH_DISTRITO = /irMapa\('\d+'[^>]*>[\s\S]*?<th[^>]*>([\s\S]*?)<\/th>/

type FilaLive = { codigo: string; razon: string; direccion: string; precio: number }

async function traerFacilito(zona: { departamento: string; provincia: string; distrito: string }, facilitoProd: string): Promise<{ filas: FilaLive[]; distrito: string }> {
  const url =
    `https://www.facilito.gob.pe/facilito/actions/PreciosCombustibleAutomotorAction.do` +
    `?method=cambiarProducto&departamento=${zona.departamento}&departamentoAux=${zona.departamento}` +
    `&provincia=${zona.provincia}&distrito=${zona.distrito}&producto=${facilitoProd}`
  const resp = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'text/html,*/*' }, redirect: 'follow' })
  if (!resp.ok) throw new Error(`Facilito HTTP ${resp.status} (producto ${facilitoProd})`)
  // La página declara charset Cp1252 (Windows-1252).
  const html = new TextDecoder('windows-1252').decode(new Uint8Array(await resp.arrayBuffer()))
  const filas: FilaLive[] = []
  ROW.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = ROW.exec(html))) {
    filas.push({
      codigo: m[1],
      razon: limpiar(m[2]),
      direccion: limpiar(m[3]),
      precio: Number(m[5]) || 0,
    })
  }
  const th = TH_DISTRITO.exec(html)
  return { filas, distrito: th ? limpiar(th[1]) : '' }
}

// Devuelve el Resultado completo desde Facilito, o lanza si falla/incompleto.
async function rankearFacilito(
  zona: { departamento: string; provincia: string; distrito: string },
  codigoEst: string,
  productos: Producto[],
): Promise<Resultado> {
  const snapshot = snapshotVacio()
  const top10: T10Row[] = []
  const codigosZona = new Set<string>()
  let distritoNombre = ''
  let aparecemos = false

  for (const p of productos) {
    const { filas, distrito } = await traerFacilito(zona, p.facilito)
    if (filas.length === 0) throw new Error(`Facilito no devolvió filas para ${p.codigo}`)
    if (!distritoNombre && distrito) distritoNombre = distrito
    for (const f of filas) codigosZona.add(f.codigo)

    // La página ya viene ascendente por precio (orden canónico de OSINERGMIN);
    // se respeta. Nuestro puesto = la posición de nuestro código.
    const idx = filas.findIndex((f) => f.codigo === codigoEst)
    if (idx >= 0) aparecemos = true
    const nuestro = idx >= 0 ? filas[idx] : null
    setProducto(
      snapshot, p.codigo,
      idx >= 0 ? idx + 1 : null,
      nuestro ? toCentimos(nuestro.precio) : null,
      filas.length,
    )
    // Top 10; si quedamos fuera, la lista crece hasta incluir nuestro puesto.
    const hasta = idx >= 10 ? idx + 1 : 10
    filas.slice(0, hasta).forEach((f, i) => {
      top10.push({
        producto: p.codigo, ranking: i + 1,
        razon_social: f.razon, direccion: f.direccion, codigo_osinerg: f.codigo,
        precio_centimos: toCentimos(f.precio), es_nuestro: f.codigo === codigoEst,
      })
    })
  }

  // "Incompleto" = nuestro establecimiento no aparece en NINGÚN producto.
  // Reintentar en vivo no lo arregla → se cae al Excel (identifica por RUC).
  if (!aparecemos) {
    throw new Error(`El establecimiento ${codigoEst} no aparece en Facilito para esta zona.`)
  }

  return {
    fuente: 'facilito',
    // Facilito no trae departamento/provincia en la fila; el distrito sí.
    zona: { departamento: '', provincia: '', distrito: distritoNombre },
    snapshot,
    top10,
    totalEstablecimientos: codigosZona.size,
    avisos: [],
  }
}

// ══════════════════════════════════════════════════════════════
// RESPALDO — Excel EVPC
// ══════════════════════════════════════════════════════════════

const COLUMNAS = {
  ruc:          { req: true,  alias: ['RUC'] },
  departamento: { req: true,  alias: ['DEPARTAMENTO'] },
  provincia:    { req: true,  alias: ['PROVINCIA'] },
  distrito:     { req: true,  alias: ['DISTRITO'] },
  producto:     { req: true,  alias: ['PRODUCTO'] },
  precio:       { req: true,  alias: ['PRECIO_VENTA', 'PRECIO'] },
  codigo:       { req: false, alias: ['CODIGO_OSINERG', 'CODIGO_OSINERGMIN', 'NRO_REGISTRO'] },
  razon:        { req: false, alias: ['RAZON', 'RAZON_SOCIAL'] },
  direccion:    { req: false, alias: ['DIRECCION'] },
  // OJO: en el Excel real es FCHA_REGISTRO (sin la "E"). Solo desempata.
  fecha:        { req: false, alias: ['FCHA_REGISTRO', 'FECHA_REGISTRO', 'FECHA_HORA', 'FECHA_PRECIO', 'FECHA_ACTUALIZACION', 'FECHA'] },
  activo:       { req: false, alias: ['PRODUCTO_ACTIVO'] },
} as const
type Campo = keyof typeof COLUMNAS

// Parser liviano del .xlsx (fflate + XML directo; validado contra SheetJS).
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

  const rows: Record<string, string>[] = []
  let rm: RegExpExecArray | null
  while ((rm = rowRe.exec(sheetXml))) rows.push(parseCells(rm[1], keep))

  return { rows, letraDe, cabecera, decode }
}

// Devuelve el Resultado completo desde el Excel, o lanza si falla.
async function rankearExcel(url: string, ruc: string, productos: Producto[]): Promise<Resultado> {
  const resp = await fetch(url, {
    headers: {
      'User-Agent': UA,
      Accept: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,*/*',
    },
    redirect: 'follow',
  })
  if (!resp.ok) throw new Error(`No se pudo descargar el Excel (HTTP ${resp.status})`)

  const aliasAll = Object.values(COLUMNAS).flatMap((c) => c.alias.map(canon))
  const { rows, letraDe, cabecera, decode } = parseXlsx(new Uint8Array(await resp.arrayBuffer()), aliasAll)

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
    throw new Error(`El Excel cambió de formato: faltan columnas obligatorias → ${faltan.join(', ')}. Cabecera: ${cabecera.join(', ')}`)
  }

  const norm = (v: string | undefined) => decode(v ?? '').trim()
  const val = (fila: Record<string, string>, campo: Campo) => {
    const c = col[campo]
    return c ? norm(fila[c]) : ''
  }
  const fechaClave = (s: string): number => {
    if (!s) return Infinity
    const n = Number(s)
    if (!isNaN(n) && n > 0) return n
    const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/.exec(s)
    if (m) return Date.UTC(+m[3], +m[2] - 1, +m[1], +(m[4] ?? '0'), +(m[5] ?? '0'), +(m[6] ?? '0'))
    const t = Date.parse(s)
    return isNaN(t) ? Infinity : t
  }

  const nuestras = rows.filter((f) => val(f, 'ruc') === ruc)
  if (nuestras.length === 0) throw new Error(`No se encontró el RUC ${ruc} en el Excel.`)
  const zona = {
    departamento: val(nuestras[0], 'departamento'),
    provincia: val(nuestras[0], 'provincia'),
    distrito: val(nuestras[0], 'distrito'),
  }
  const zonasDelRuc = new Set(
    nuestras.map((f) => `${val(f, 'departamento')}|${val(f, 'provincia')}|${val(f, 'distrito')}`),
  )
  if (zonasDelRuc.size > 1) {
    avisos.push(`El RUC ${ruc} tiene grifos en ${zonasDelRuc.size} zonas; se rankea ${zona.distrito}, ${zona.provincia}.`)
  }
  const mismaZona = (f: Record<string, string>) =>
    canon(val(f, 'departamento')) === canon(zona.departamento) &&
    canon(val(f, 'provincia')) === canon(zona.provincia) &&
    canon(val(f, 'distrito')) === canon(zona.distrito)

  const claveEst = (f: Record<string, string>) =>
    val(f, 'codigo') || `${val(f, 'ruc')}|${val(f, 'direccion')}`

  type Reg = { key: string; ruc: string; razon: string; direccion: string; producto: string; precio: number; fecha: number }
  const enZona: Reg[] = []
  const establecimientosZona = new Set<string>()
  for (const f of rows) {
    if (!mismaZona(f)) continue
    establecimientosZona.add(claveEst(f))
    if (val(f, 'activo').toUpperCase() === 'NO') continue
    enZona.push({
      key: claveEst(f), ruc: val(f, 'ruc'), razon: val(f, 'razon'), direccion: val(f, 'direccion'),
      producto: val(f, 'producto').toUpperCase(), precio: Number(val(f, 'precio')) || 0, fecha: fechaClave(val(f, 'fecha')),
    })
  }

  const snapshot = snapshotVacio()
  const top10: T10Row[] = []
  for (const p of productos) {
    const items = enZona.filter((r) => r.producto === p.nombreExcel && r.precio > 0)
    const porEst = new Map<string, Reg>()
    for (const it of items) {
      const prev = porEst.get(it.key)
      if (!prev || it.fecha > prev.fecha) porEst.set(it.key, it)
    }
    const lista = [...porEst.values()].sort(
      (a, b) => a.precio - b.precio || a.fecha - b.fecha || a.key.localeCompare(b.key),
    )
    if (lista.length === 0) continue
    const ourIdx = lista.findIndex((x) => x.ruc === ruc)
    setProducto(
      snapshot, p.codigo,
      ourIdx >= 0 ? ourIdx + 1 : null,
      ourIdx >= 0 ? toCentimos(lista[ourIdx].precio) : null,
      lista.length,
    )
    const hasta = ourIdx >= 10 ? ourIdx + 1 : 10
    lista.slice(0, hasta).forEach((x, i) => {
      top10.push({
        producto: p.codigo, ranking: i + 1,
        razon_social: x.razon, direccion: x.direccion, codigo_osinerg: x.key,
        precio_centimos: toCentimos(x.precio), es_nuestro: x.ruc === ruc,
      })
    })
  }

  return { fuente: 'excel', zona, snapshot, top10, totalEstablecimientos: establecimientosZona.size, avisos }
}

// ══════════════════════════════════════════════════════════════
// Escritura (dedup + insert), común a las dos fuentes
// ══════════════════════════════════════════════════════════════

async function escribir(admin: SupabaseClient, r: Resultado): Promise<{ status: number; body: unknown }> {
  // Huella para el dedup: TODO el Top 10 + totales + FUENTE. Si cambia la
  // fuente (aunque los precios coincidan) se crea snapshot nuevo, para que el
  // ranking refleje el cambio de frescura (en vivo ⇄ respaldo).
  const fp = (arr: T10Row[], totales: (number | null)[], fuente: string) =>
    JSON.stringify([
      [...arr]
        .sort((a, b) => (a.producto === b.producto ? a.ranking - b.ranking : a.producto < b.producto ? -1 : 1))
        .map((t) => [t.producto, t.ranking, t.razon_social, t.codigo_osinerg ?? '', t.precio_centimos, t.es_nuestro]),
      totales, fuente,
    ])
  const totalesNuevos = [r.totalEstablecimientos, r.snapshot.total_db5, r.snapshot.total_regular, r.snapshot.total_premium]

  const { data: prev } = await admin
    .from('osinergmin_snapshots')
    .select('id, fuente, total_establecimientos, total_db5, total_regular, total_premium')
    .order('fecha_consulta', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (prev) {
    const { data: prevTop } = await admin
      .from('osinergmin_top10')
      .select('producto, ranking, razon_social, codigo_osinerg, precio_centimos, es_nuestro')
      .eq('snapshot_id', prev.id)
    const totalesPrev = [prev.total_establecimientos, prev.total_db5, prev.total_regular, prev.total_premium]
    if (fp(r.top10, totalesNuevos, r.fuente) === fp((prevTop as T10Row[]) ?? [], totalesPrev, (prev as { fuente?: string }).fuente ?? '')) {
      await admin.from('osinergmin_snapshots').update({ fecha_consulta: new Date().toISOString() }).eq('id', prev.id)
      return { status: 200, body: { ok: true, skipped: true, fuente: r.fuente, ...r.zona, avisos: r.avisos } }
    }
  }

  const { data: snap, error: snapErr } = await admin
    .from('osinergmin_snapshots')
    .insert({
      fecha_datos_excel: new Date().toISOString().slice(0, 10),
      fuente: r.fuente,
      ...r.zona,
      total_establecimientos: r.totalEstablecimientos,
      ...r.snapshot,
    })
    .select('id')
    .single()
  if (snapErr) return { status: 500, body: { error: `Error snapshot: ${snapErr.message}` } }
  if (r.top10.length > 0) {
    const { error: e } = await admin.from('osinergmin_top10').insert(r.top10.map((t) => ({ ...t, snapshot_id: snap.id })))
    if (e) return { status: 500, body: { error: `Error top10: ${e.message}` } }
  }
  return { status: 200, body: { ok: true, fuente: r.fuente, ...r.zona, total_establecimientos: r.totalEstablecimientos, avisos: r.avisos } }
}

async function run(): Promise<{ status: number; body: unknown }> {
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE)

  const CLAVES = [
    'osinergmin_url_excel', 'osinergmin_ruc',
    'osinergmin_facilito_departamento', 'osinergmin_facilito_provincia',
    'osinergmin_facilito_distrito', 'osinergmin_codigo_establecimiento',
  ]
  const [{ data: cfgRows }, { data: tipos }] = await Promise.all([
    admin.from('app_config').select('clave, valor').in('clave', CLAVES),
    admin.from('tipos_combustible').select('codigo, nombre_osinergmin').eq('activo', true),
  ])
  const cfg = Object.fromEntries((cfgRows ?? []).map((r) => [r.clave, (r.valor ?? '').trim()]))

  // Productos con su código en cada fuente (nombre en el Excel + código Facilito).
  const FACILITO_ID: Record<string, string> = { DB5: '40', REGULAR: '126', PREMIUM: '127' }
  const productos: Producto[] = (tipos ?? []).map((t) => ({
    codigo: t.codigo as string,
    nombreExcel: String(t.nombre_osinergmin).trim().toUpperCase(),
    facilito: FACILITO_ID[t.codigo as string] ?? '',
  }))

  const zona = {
    departamento: cfg['osinergmin_facilito_departamento'] ?? '',
    provincia: cfg['osinergmin_facilito_provincia'] ?? '',
    distrito: cfg['osinergmin_facilito_distrito'] ?? '',
  }
  const codigoEst = cfg['osinergmin_codigo_establecimiento'] ?? ''
  const url = cfg['osinergmin_url_excel'] ?? ''
  const ruc = cfg['osinergmin_ruc'] ?? ''

  const errores: string[] = []

  // 1) Fuente oficial: Facilito en vivo.
  const hayFacilito = zona.departamento && zona.provincia && zona.distrito && codigoEst && productos.every((p) => p.facilito)
  if (hayFacilito) {
    try {
      return await escribir(admin, await rankearFacilito(zona, codigoEst, productos))
    } catch (e) {
      errores.push(`Facilito: ${(e as Error).message}`)
    }
  } else {
    errores.push('Facilito: falta configuración (zona INEI o código de establecimiento).')
  }

  // 2) Respaldo: Excel EVPC.
  if (url && ruc) {
    try {
      const r = await rankearExcel(url, ruc, productos)
      // El aviso deja rastro de que se sirvió respaldo y por qué.
      r.avisos.unshift(`Se usó el Excel de respaldo (la fuente en vivo no estuvo disponible). ${errores.join(' ')}`)
      return await escribir(admin, r)
    } catch (e) {
      errores.push(`Excel: ${(e as Error).message}`)
    }
  } else {
    errores.push('Excel: falta configuración (URL o RUC).')
  }

  // 3) Ambas fallaron: no se escribe. El front conserva el último snapshot.
  return { status: 502, body: { error: `No se pudo actualizar el ranking. ${errores.join(' | ')}` } }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  try {
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
