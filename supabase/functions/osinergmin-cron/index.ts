// ============================================================
// Edge Function: osinergmin-cron  (ACTUALIZACIÓN AUTOMÁTICA)
// ============================================================
// Descarga el Excel de OSINERGMIN, lo parsea EN EL SERVIDOR con un lector
// liviano (fflate + lectura directa del XML, SIN SheetJS) para caber en los
// límites del edge (256MB/CPU), calcula el ranking del distrito y guarda el
// snapshot + top10. Pensada para el cron horario (pg_cron), pero también la
// puede disparar el superadmin para probar.
//
// Ranking: precio ascendente; si dos grifos EMPATAN en precio, va primero el
// que registró su precio antes (columna FECHA_* del Excel). El puesto es la
// posición real en esa lista desempatada.
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

  // Cabecera (fila 1): nombre de columna → letra
  const first = rowRe.exec(sheetXml)
  const letraDe: Record<string, string> = {}
  if (first) {
    const head = parseCells(first[1])
    for (const [letra, name] of Object.entries(head)) letraDe[decode(name).trim()] = letra
  }
  const keep = new Set(needed.map((n) => letraDe[n]).filter(Boolean))

  // Filas de datos: solo las columnas necesarias.
  const rows: Record<string, string>[] = []
  let rm: RegExpExecArray | null
  while ((rm = rowRe.exec(sheetXml))) rows.push(parseCells(rm[1], keep))

  return { rows, letraDe, decode }
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

  // FECHA_*: fecha en que el grifo registró su precio. Se usa SOLO para
  // desempatar el ranking (a igual precio, gana el que lo publicó primero).
  // El nombre de la columna varía según la descarga, por eso hay candidatas.
  const FECHA_CANDIDATAS = ['FECHA_HORA', 'FECHA_PRECIO', 'FECHA_REGISTRO', 'FECHA_ACTUALIZACION', 'FECHA']
  const NEEDED = ['RUC', 'RAZON', 'DISTRITO', 'DIRECCION', 'PRODUCTO', 'PRECIO_VENTA', ...FECHA_CANDIDATAS]
  const { rows, letraDe, decode } = parseXlsx(new Uint8Array(await resp.arrayBuffer()), NEEDED)
  const cRUC = letraDe['RUC'], cRAZON = letraDe['RAZON'], cDIST = letraDe['DISTRITO']
  const cDIR = letraDe['DIRECCION'], cPROD = letraDe['PRODUCTO'], cPRECIO = letraDe['PRECIO_VENTA']
  const cFECHA = FECHA_CANDIDATAS.map((n) => letraDe[n]).find(Boolean)
  if (!cRUC || !cDIST || !cPROD || !cPRECIO) {
    return { status: 422, body: { error: 'El Excel no tiene las columnas esperadas.' } }
  }

  const norm = (v: string | undefined) => decode(v ?? '').trim()
  // Clave ordenable de la fecha de registro: acepta el serial numérico de Excel
  // o texto "dd/mm/yyyy [hh:mm[:ss]]". Sin fecha → Infinity (pierde el empate).
  const fechaClave = (raw: string | undefined): number => {
    const s = norm(raw)
    if (!s) return Infinity
    const n = Number(s)
    if (!isNaN(n) && n > 0) return n
    const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/.exec(s)
    if (m) return Date.UTC(+m[3], +m[2] - 1, +m[1], +(m[4] ?? '0'), +(m[5] ?? '0'), +(m[6] ?? '0'))
    const t = Date.parse(s)
    return isNaN(t) ? Infinity : t
  }
  // Distrito de nuestro grifo (rows = solo filas de datos, sin cabecera)
  let distrito = ''
  for (let i = 0; i < rows.length; i++) {
    if (norm(rows[i][cRUC]) === ruc) { distrito = norm(rows[i][cDIST]); break }
  }
  if (!distrito) return { status: 404, body: { error: `No se encontró el RUC ${ruc} en el Excel.` } }

  type Reg = { ruc: string; producto: string; precio: number; fecha: number }
  const enDistrito: Reg[] = []
  const rucsDistrito = new Set<string>()
  const infoPorRuc = new Map<string, { razon: string; direccion: string }>()
  for (let i = 0; i < rows.length; i++) {
    if (norm(rows[i][cDIST]) !== distrito) continue
    const rr = norm(rows[i][cRUC])
    rucsDistrito.add(rr)
    if (!infoPorRuc.has(rr)) {
      infoPorRuc.set(rr, { razon: norm(rows[i][cRAZON]), direccion: cDIR ? norm(rows[i][cDIR]) : '' })
    }
    enDistrito.push({
      ruc: rr,
      producto: norm(rows[i][cPROD]).toUpperCase(),
      precio: Number(rows[i][cPRECIO]) || 0,
      fecha: cFECHA ? fechaClave(rows[i][cFECHA]) : Infinity,
    })
  }

  const snapshot: Record<string, number | null> = {
    ranking_db5: null, precio_db5_centimos: null,
    ranking_regular: null, precio_regular_centimos: null,
    ranking_premium: null, precio_premium_centimos: null,
  }
  const top10: {
    producto: string; ranking: number; razon_social: string
    direccion: string; precio_centimos: number; es_nuestro: boolean
  }[] = []

  for (const p of productos) {
    const items = enDistrito.filter((r) => r.producto === p.nombreExcel && r.precio > 0)
    // Precio mínimo por RUC; a igual precio se conserva la fecha más antigua
    // (la que le da la preferencia en el desempate).
    const byRuc = new Map<string, { precio: number; fecha: number }>()
    for (const it of items) {
      const prev = byRuc.get(it.ruc)
      if (!prev || it.precio < prev.precio || (it.precio === prev.precio && it.fecha < prev.fecha)) {
        byRuc.set(it.ruc, { precio: it.precio, fecha: it.fecha })
      }
    }
    // Orden del ranking: precio ascendente; EMPATE → primero el que registró
    // su precio antes (fecha más antigua). Sin fecha, se respeta el orden del
    // Excel (sort estable).
    const lista = [...byRuc.entries()]
      .map(([r, v]) => ({ ruc: r, precio: v.precio, fecha: v.fecha }))
      .sort((a, b) => a.precio - b.precio || (a.fecha === b.fecha ? 0 : a.fecha - b.fecha))
    if (lista.length === 0) continue
    // Ranking = posición real en la lista desempatada (consistente con el Top 10).
    const ourIdx = lista.findIndex((x) => x.ruc === ruc)
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
      const info = infoPorRuc.get(x.ruc)
      top10.push({
        producto: p.codigo, ranking: i + 1,
        razon_social: info?.razon ?? '', direccion: info?.direccion ?? '',
        precio_centimos: toCentimos(x.precio), es_nuestro: x.ruc === ruc,
      })
    })
  }

  // Dedup por TODO el Top 10 (competencia incluida), no solo nuestros valores:
  // si la lista completa es idéntica a la del último snapshot, NO se crea fila
  // nueva (evita historial ruidoso); solo se refresca la fecha para mostrar que
  // sigue vigente. Si CUALQUIER precio/orden del Top 10 cambió → snapshot nuevo.
  type T10 = { producto: string; ranking: number; razon_social: string; precio_centimos: number; es_nuestro: boolean }
  const fp = (arr: T10[]) =>
    JSON.stringify(
      [...arr]
        .sort((a, b) => (a.producto === b.producto ? a.ranking - b.ranking : a.producto < b.producto ? -1 : 1))
        .map((t) => [t.producto, t.ranking, t.razon_social, t.precio_centimos, t.es_nuestro])
    )
  const { data: prev } = await admin
    .from('osinergmin_snapshots')
    .select('id')
    .order('fecha_consulta', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (prev) {
    const { data: prevTop } = await admin
      .from('osinergmin_top10')
      .select('producto, ranking, razon_social, precio_centimos, es_nuestro')
      .eq('snapshot_id', prev.id)
    if (fp(top10) === fp((prevTop as T10[]) ?? [])) {
      await admin
        .from('osinergmin_snapshots')
        .update({ fecha_consulta: new Date().toISOString() })
        .eq('id', prev.id)
      return { status: 200, body: { ok: true, skipped: true, distrito } }
    }
  }

  const { data: snap, error: snapErr } = await admin
    .from('osinergmin_snapshots')
    .insert({ fecha_datos_excel: new Date().toISOString().slice(0, 10), distrito, total_establecimientos: rucsDistrito.size, ...snapshot })
    .select('id')
    .single()
  if (snapErr) return { status: 500, body: { error: `Error snapshot: ${snapErr.message}` } }
  if (top10.length > 0) {
    const { error: e } = await admin.from('osinergmin_top10').insert(top10.map((t) => ({ ...t, snapshot_id: snap.id })))
    if (e) return { status: 500, body: { error: `Error top10: ${e.message}` } }
  }
  return { status: 200, body: { ok: true, distrito, total_establecimientos: rucsDistrito.size } }
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
