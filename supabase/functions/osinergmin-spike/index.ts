// ============================================================
// Edge Function: osinergmin-spike  (DIAGNÓSTICO — solo superadmin)
// ============================================================
// Compara, LADO A LADO, el ranking calculado desde la fuente EN VIVO de
// Facilito AHORA contra el último snapshot publicado (que desde la migración 20
// suele ser también Facilito, pero puede ser el Excel de respaldo). NO escribe
// nada: solo lee y devuelve el diff en JSON. Herramienta de control para que el
// superadmin verifique que el snapshot publicado sigue cuadrando con lo que hay
// en vivo, y detecte a ojo si la fuente en vivo se desvió o quedó vieja.
//
// Contexto (sesión 2026-07-14):
//  · La web de Facilito consulta la base VIVA. Su buscador POST lleva reCAPTCHA
//    v3, pero el MISMO action por GET devuelve los datos SIN token. Es un GET a
//    datos públicos: no se bypassea ninguna barrera.
//  · La página ya viene ORDENADA por precio ascendente = el orden canónico de
//    OSINERGMIN (incluye su desempate). Se respeta ese orden: nuestro puesto =
//    la posición de nuestro código. Facilito no trae RUC ni fecha de registro.
//
// Config: la zona (códigos INEI) y nuestro CODIGO_OSINERG se leen de app_config
// —las MISMAS claves que usa osinergmin-cron— para que el diagnóstico compare
// con exactamente los parámetros de producción y no diverja.
//
// Slug en Supabase: osinergmin-spike  ·  Verify JWT: DESACTIVADO.
// ============================================================
import { serve } from 'https://deno.land/std@0.208.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

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

// La zona (códigos INEI×10000) y nuestro CODIGO_OSINERG se leen de app_config
// en run(); estos son solo los defaults por si la clave estuviera vacía.
type Zona = { departamento: string; provincia: string; distrito: string }
const ZONA_DEFAULT: Zona = { departamento: '40000', provincia: '40100', distrito: '40110' }
const CODIGO_DEFAULT = '21728' // GRIFO ALEXMATH (verificado por precios vs snapshot 14/07)
const PRODUCTOS = [
  { codigo: 'DB5', facilito: '40' },
  { codigo: 'REGULAR', facilito: '126' },
  { codigo: 'PREMIUM', facilito: '127' },
] as const
type ProdCodigo = (typeof PRODUCTOS)[number]['codigo']

// Fila del buscador de Facilito:
//   <tr onclick="...irMapa('CODIGO',N)..."> <th>DISTRITO</th>
//     <td>RAZON</td> <td>DIRECCION</td> <td>TELEFONO</td>
//     <td><strong><div align="center">PRECIO</div></strong></td> </tr>
const ROW =
  /irMapa\('(\d+)'[^>]*>[\s\S]*?<td>([\s\S]*?)<\/td>[\s\S]*?<td>([\s\S]*?)<\/td>[\s\S]*?<td>([\s\S]*?)<\/td>[\s\S]*?align="center">\s*([\d.]+)/g

const limpiar = (s: string) =>
  s.replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/\s+/g, ' ')
    .trim()

type FilaLive = { codigo: string; razon: string; direccion: string; precio: number }

// Descarga el buscador de un producto y devuelve sus filas EN EL ORDEN de la
// página (ascendente por precio = orden canónico de OSINERGMIN).
async function traerFacilito(zona: Zona, facilitoProd: string): Promise<FilaLive[]> {
  const url =
    `https://www.facilito.gob.pe/facilito/actions/PreciosCombustibleAutomotorAction.do` +
    `?method=cambiarProducto&departamento=${zona.departamento}&departamentoAux=${zona.departamento}` +
    `&provincia=${zona.provincia}&distrito=${zona.distrito}&producto=${facilitoProd}`
  const resp = await fetch(url, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
      Accept: 'text/html,*/*',
    },
    redirect: 'follow',
  })
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
  return filas
}

type TopRow = {
  ranking: number; codigo: string | null; razon: string
  precio_centimos: number; es_nuestro: boolean
}
type LadoFacilito = {
  our_ranking: number | null; our_precio_centimos: number | null
  total: number; ordenado_por_precio: boolean; top: TopRow[]
}
type LadoExcel = {
  our_ranking: number | null; our_precio_centimos: number | null
  total: number | null; top: TopRow[]
}

function rankFacilito(filas: FilaLive[], nuestroCodigo: string): LadoFacilito {
  // ¿La página realmente viene ascendente? (sanity check del supuesto clave.)
  let ordenado = true
  for (let i = 1; i < filas.length; i++) if (filas[i].precio < filas[i - 1].precio) ordenado = false

  const idxNuestro = filas.findIndex((f) => f.codigo === nuestroCodigo)
  const hasta = idxNuestro >= 10 ? idxNuestro + 1 : 10
  const top: TopRow[] = filas.slice(0, hasta).map((f, i) => ({
    ranking: i + 1,
    codigo: f.codigo,
    razon: f.razon,
    precio_centimos: toCentimos(f.precio),
    es_nuestro: f.codigo === nuestroCodigo,
  }))
  return {
    our_ranking: idxNuestro >= 0 ? idxNuestro + 1 : null,
    our_precio_centimos: idxNuestro >= 0 ? toCentimos(filas[idxNuestro].precio) : null,
    total: filas.length,
    ordenado_por_precio: ordenado,
    top,
  }
}

async function run(): Promise<{ status: number; body: unknown }> {
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE)

  // Zona y código desde app_config (mismas claves que osinergmin-cron).
  const { data: cfgRows } = await admin
    .from('app_config')
    .select('clave, valor')
    .in('clave', [
      'osinergmin_facilito_departamento', 'osinergmin_facilito_provincia',
      'osinergmin_facilito_distrito', 'osinergmin_codigo_establecimiento',
    ])
  const cfg = Object.fromEntries((cfgRows ?? []).map((r) => [r.clave, (r.valor ?? '').trim()]))
  const zona: Zona = {
    departamento: cfg['osinergmin_facilito_departamento'] || ZONA_DEFAULT.departamento,
    provincia: cfg['osinergmin_facilito_provincia'] || ZONA_DEFAULT.provincia,
    distrito: cfg['osinergmin_facilito_distrito'] || ZONA_DEFAULT.distrito,
  }
  const nuestroCodigo = cfg['osinergmin_codigo_establecimiento'] || CODIGO_DEFAULT

  // ── Lado FACILITO (en vivo) ──
  const facilito: Record<string, LadoFacilito> = {}
  for (const p of PRODUCTOS) {
    const filas = await traerFacilito(zona, p.facilito)
    facilito[p.codigo] = rankFacilito(filas, nuestroCodigo)
  }

  // ── Lado EXCEL (último snapshot que ya mantiene osinergmin-cron) ──
  const { data: snap } = await admin
    .from('osinergmin_snapshots')
    .select('*')
    .order('fecha_consulta', { ascending: false })
    .limit(1)
    .maybeSingle()
  let exTop: Record<string, unknown>[] = []
  if (snap) {
    const { data } = await admin
      .from('osinergmin_top10')
      .select('producto, ranking, codigo_osinerg, razon_social, precio_centimos, es_nuestro')
      .eq('snapshot_id', snap.id as string)
    exTop = (data as Record<string, unknown>[]) ?? []
  }
  const excelLado = (prod: ProdCodigo): LadoExcel => {
    const s = (snap ?? {}) as Record<string, number | null>
    const rk = prod === 'DB5' ? s.ranking_db5 : prod === 'REGULAR' ? s.ranking_regular : s.ranking_premium
    const pr = prod === 'DB5' ? s.precio_db5_centimos : prod === 'REGULAR' ? s.precio_regular_centimos : s.precio_premium_centimos
    const tot = prod === 'DB5' ? s.total_db5 : prod === 'REGULAR' ? s.total_regular : s.total_premium
    const top = exTop
      .filter((t) => t.producto === prod)
      .sort((a, b) => (a.ranking as number) - (b.ranking as number))
      .map((t) => ({
        ranking: t.ranking as number,
        codigo: (t.codigo_osinerg as string) ?? null,
        razon: (t.razon_social as string) ?? '',
        precio_centimos: t.precio_centimos as number,
        es_nuestro: Boolean(t.es_nuestro),
      }))
    return {
      our_ranking: rk ?? null,
      our_precio_centimos: pr ?? null,
      total: (tot ?? s.total_establecimientos) ?? null,
      top,
    }
  }

  // ── Diff por producto ──
  const productos: Record<string, unknown> = {}
  const notasGlobal: string[] = []
  let todoCoincide = true
  for (const p of PRODUCTOS) {
    const f = facilito[p.codigo]
    const e = excelLado(p.codigo)
    const notas: string[] = []
    const rankOk = f.our_ranking === e.our_ranking
    const precioOk = f.our_precio_centimos === e.our_precio_centimos
    if (!f.ordenado_por_precio) notas.push('La página de Facilito NO vino ordenada ascendente (revisar supuesto).')
    if (!rankOk) notas.push(`Puesto distinto: Facilito #${f.our_ranking ?? '—'} vs Excel #${e.our_ranking ?? '—'}.`)
    if (!precioOk) {
      const s = (c: number | null) => (c == null ? '—' : (c / 100).toFixed(2))
      notas.push(`Precio distinto: Facilito S/${s(f.our_precio_centimos)} vs Excel S/${s(e.our_precio_centimos)}.`)
    }
    if (f.total !== (e.total ?? f.total)) notas.push(`Total distinto: Facilito ${f.total} vs Excel ${e.total ?? '—'}.`)
    if (!rankOk || !precioOk) todoCoincide = false
    productos[p.codigo] = { facilito: f, excel: e, veredicto: { ranking_coincide: rankOk, precio_coincide: precioOk, notas } }
    if (notas.length) notasGlobal.push(`${p.codigo}: ${notas.join(' ')}`)
  }

  const snapFecha = snap ? ((snap as Record<string, string>).fecha_consulta ?? null) : null
  const snapFuente = snap ? ((snap as Record<string, string>).fuente ?? '—') : null
  if (snapFecha) {
    const horas = Math.round((Date.now() - new Date(snapFecha).getTime()) / 3600000)
    notasGlobal.unshift(`Último snapshot publicado (fuente: ${snapFuente}): hace ~${horas} h (${snapFecha}).`)
  } else {
    notasGlobal.unshift('No hay snapshot publicado todavía; solo se muestra el lado Facilito.')
  }

  return {
    status: 200,
    body: {
      ok: true,
      zona,
      nuestro_codigo: nuestroCodigo,
      fetched_at: new Date().toISOString(),
      excel_snapshot_fecha: snapFecha,
      productos,
      resumen: { todo_coincide: todoCoincide, notas: notasGlobal },
    },
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  try {
    // Misma autorización que osinergmin-cron: secreto propio del cron o sesión
    // de un superadmin (para el botón manual del panel de validación).
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
