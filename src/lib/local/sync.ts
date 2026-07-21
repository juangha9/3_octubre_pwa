// ─────────────────────────────────────────────────────────────────
// Worker de sincronización local ⇄ Supabase
//
// Escrituras: la UI escribe en Dexie y encola en `outbox`; aquí se
// vacía la cola (FIFO) contra Supabase en cuanto hay conexión.
// Lecturas: hidratación inicial (~35 días) + pull incremental por
// `updated_at` (migración 016). El servidor manda (LWW), salvo filas
// con cambios locales aún en cola, que no se pisan hasta enviarse.
// ─────────────────────────────────────────────────────────────────
import { supabase } from '@/lib/supabase'
import {
  dbLocal,
  claveCierre,
  claveReporte,
  type OutboxEntry,
  type RegistroVentaLocal,
  type CierreCajaLocal,
  type PrecioDiarioLocal,
  type ConsolaReporteLocal,
} from './db'

// ── Estado observable del sync (para el indicador de la UI) ──────

export interface SyncStatus {
  online: boolean
  sincronizando: boolean
  /** Mutaciones locales aún no confirmadas por Supabase. */
  pendientes: number
  /** Error de la primera entrada bloqueada de la cola (no-red). */
  error: string | null
  ultimaSync: string | null
}

let status: SyncStatus = {
  online: typeof navigator === 'undefined' ? true : navigator.onLine,
  sincronizando: false,
  pendientes: 0,
  error: null,
  ultimaSync: null,
}

const listeners = new Set<() => void>()

function setStatus(patch: Partial<SyncStatus>) {
  status = { ...status, ...patch }
  listeners.forEach(l => l())
}

export function getSyncStatus(): SyncStatus {
  return status
}

export function subscribeSyncStatus(cb: () => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

async function refrescarPendientes() {
  const n = await dbLocal.outbox.count()
  if (n !== status.pendientes) setStatus({ pendientes: n })
}

// ── Outbox: encolar y vaciar ─────────────────────────────────────

/** Error de Supabase con su metadato: SQLSTATE de Postgres y/o HTTP status. */
interface ErrorSupabase extends Error {
  code?: string
  status?: number
}

/**
 * Convierte el `error` que devuelve supabase-js en un Error que CONSERVA su
 * código. Sin esto (`new Error(error.message)`) se pierde justo el dato que
 * distingue un rechazo definitivo de un tropiezo temporal.
 */
function comoError(error: { message: string; code?: string; status?: number; statusCode?: number }): ErrorSupabase {
  const e: ErrorSupabase = new Error(error.message)
  e.code = error.code
  e.status = error.status ?? error.statusCode
  return e
}

/**
 * ¿El fallo al enviar es un rechazo DEFINITIVO del servidor, o un tropiezo
 * temporal que se arregla reintentando?
 *
 * Reintentar NO lo arregla: violación de constraint, RLS, dato mal formado,
 * un `RAISE` nuestro ("No autorizado"). El servidor entendió y dijo que no.
 * Lo delata el SQLSTATE de Postgres (22xxx dato · 23xxx integridad · 28/42
 * acceso · P0001 raise) o un HTTP 4xx. Solo esto enciende el punto ROJO.
 *
 * Reintentar SÍ ayuda (o es cuestión de esperar): sin internet, Supabase
 * caído (5xx), timeout, cualquier fallo de red. Ante la duda se reintenta:
 * es lo seguro, porque el dato sigue a salvo en la cola y no se pierde.
 * (Antes se clasificaba por el texto del mensaje y un 5xx podía colarse
 * como rechazo → punto rojo injustificado durante una caída de Supabase.)
 */
function esRechazoDefinitivo(err: unknown): boolean {
  const e = err as ErrorSupabase
  if (typeof e?.status === 'number') return e.status >= 400 && e.status < 500
  if (typeof e?.code === 'string') return /^(22|23|28|42|P0)/.test(e.code)
  return false
}

/**
 * Aviso de que el repo encoló mutaciones por su cuenta (dentro de una
 * transacción Dexie junto con la escritura local, para que nunca quede
 * una fila local sin su entrada en la cola ni al revés).
 */
export async function despuesDeEncolar(): Promise<void> {
  await refrescarPendientes()
  void flush()
}

/**
 * Sube a Storage el blob que la entrada referencia. El binario NO viaja en
 * la cola: se guarda en `imagenes` y aquí se recupera por su clave. Si ya
 * no está (se limpió la caché local), la entrada se descarta en vez de
 * bloquear la cola para siempre: la fila del reporte, que es el dato que
 * importa, ya se envió por su cuenta.
 */
async function subirImagen(entry: OutboxEntry): Promise<{ error: { message: string } | null }> {
  const clave = String(entry.payload.clave)
  const img = await dbLocal.imagenes.get(clave)
  if (!img) {
    console.warn('[sync] imagen ausente en local, se omite la subida:', clave)
    return { error: null }
  }
  const { error } = await supabase.storage
    .from(String(entry.payload.bucket))
    .upload(String(entry.payload.path), img.blob, {
      contentType: img.contentType,
      upsert: true, // volver a pegar la imagen del día reemplaza la anterior
    })
  return { error: error ? { message: error.message } : null }
}

let flushing = false

/**
 * Vacía la cola en orden. Ante un fallo de red se detiene (se reintenta
 * al reconectar o en el próximo tick); ante un rechazo del servidor la
 * entrada queda bloqueando la cola (el orden importa: un update de una
 * fila no puede adelantar a su insert) y el error se muestra en la UI.
 */
export async function flush(): Promise<boolean> {
  if (flushing) return false
  flushing = true
  setStatus({ sincronizando: true })
  try {
    for (;;) {
      const entry = await dbLocal.outbox.orderBy('id').first()
      if (!entry) {
        setStatus({ error: null })
        break
      }
      try {
        const { error } =
          entry.op === 'insert'
            ? await supabase.from(entry.tabla).insert(entry.payload)
            : entry.op === 'update'
              ? await supabase.from(entry.tabla).update(entry.payload).eq('id', entry.pk)
              : entry.op === 'upload'
                ? await subirImagen(entry)
                : entry.op === 'rpc'
                  ? await supabase.rpc(entry.fn!, { p: entry.payload })
                  : await supabase
                      .from(entry.tabla)
                      .upsert(entry.payload, { onConflict: entry.onConflict })
        if (error) throw comoError(error)
        await dbLocal.outbox.delete(entry.id!)
        await refrescarPendientes()
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        await dbLocal.outbox.update(entry.id!, {
          intentos: entry.intentos + 1,
          ultimo_error: msg,
        })
        if (esRechazoDefinitivo(err)) {
          // El servidor entendió y rechazó (RLS, constraint, dato inválido):
          // reintentar no lo arregla → visible en la UI para que alguien lo vea.
          console.error('[sync] entrada rechazada por el servidor:', entry, msg)
          setStatus({ error: msg })
        } else {
          // Sin conexión, Supabase caído (5xx) o timeout: se reintenta más
          // tarde sin alarmar. La cola sigue en ámbar, no en rojo.
          setStatus({ error: null })
        }
        return false
      }
    }
    return true
  } finally {
    flushing = false
    setStatus({ sincronizando: false })
    await refrescarPendientes()
  }
}

// ── Pull: servidor → Dexie ───────────────────────────────────────

/** Días de historial que se hidratan al iniciar sesión. */
const DIAS_VENTANA = 35
const PAGE = 1000

function fechaVentana(): string {
  const d = new Date()
  d.setDate(d.getDate() - DIAS_VENTANA)
  return d.toISOString().slice(0, 10)
}

async function getMeta(clave: string): Promise<string | null> {
  return (await dbLocal.meta.get(clave))?.valor ?? null
}
async function setMeta(clave: string, valor: string) {
  await dbLocal.meta.put({ clave, valor })
}

/** PKs con cambios locales sin enviar: el pull no debe pisarlos. */
async function pksPendientes(tabla: OutboxEntry['tabla']): Promise<Set<string>> {
  const rows = await dbLocal.outbox.where('tabla').equals(tabla).toArray()
  return new Set(rows.map(r => r.pk))
}

/** Mezcla filas de registro_ventas del servidor respetando la cola local. */
// Nota: solo se escribe lo que de verdad cambió (updated_at distinto).
// Escribir filas idénticas re-dispararía los useLiveQuery de la UI y
// podría reconstruir buffers de edición mientras el usuario tipea.
async function mergeRegistros(rows: RegistroVentaLocal[]) {
  if (rows.length === 0) return
  const pendientes = await pksPendientes('registro_ventas')
  const aplicables = rows.filter(r => !pendientes.has(r.id))
  const locales = await dbLocal.registro_ventas.bulkGet(aplicables.map(r => r.id))
  const cambiadas = aplicables.filter((r, i) => {
    const loc = locales[i]
    return !loc || loc.updated_at !== r.updated_at
  })
  if (cambiadas.length > 0) await dbLocal.registro_ventas.bulkPut(cambiadas)
}

/**
 * Mezcla cierres por su clave natural (fecha+turno). Si el servidor trae
 * un cierre cuyo id difiere del local para la misma fecha+turno (nació
 * offline con id propio y el upsert conservó el id del servidor), se
 * reemplaza la fila local para no duplicar.
 */
async function mergeCierres(rows: CierreCajaLocal[]) {
  if (rows.length === 0) return
  const pendientes = await pksPendientes('cierres_caja')
  await dbLocal.transaction('rw', dbLocal.cierres_caja, async () => {
    for (const r of rows) {
      if (pendientes.has(claveCierre(r.fecha, r.turno_id))) continue
      const local = await dbLocal.cierres_caja
        .where('[fecha+turno_id]')
        .equals([r.fecha, r.turno_id])
        .first()
      if (local && local.id === r.id && local.updated_at === r.updated_at) continue
      if (local && local.id !== r.id) await dbLocal.cierres_caja.delete(local.id)
      await dbLocal.cierres_caja.put(r)
    }
  })
}

/** Igual que los cierres, pero la clave natural del precio es la fecha. */
async function mergePrecios(rows: PrecioDiarioLocal[]) {
  if (rows.length === 0) return
  const pendientes = await pksPendientes('precios_diarios')
  await dbLocal.transaction('rw', dbLocal.precios_diarios, async () => {
    for (const r of rows) {
      if (pendientes.has(r.fecha)) continue
      const local = await dbLocal.precios_diarios.where('fecha').equals(r.fecha).first()
      if (local && local.id === r.id && local.updated_at === r.updated_at) continue
      if (local && local.id !== r.id) await dbLocal.precios_diarios.delete(local.id)
      await dbLocal.precios_diarios.put(r)
    }
  })
}

/**
 * Reportes de consola: clave natural (fecha+tipo), igual que los cierres.
 * El id puede diferir del local si el reporte nació sin conexión y la RPC
 * conservó el id que ya existía en el servidor.
 */
async function mergeReportes(rows: ConsolaReporteLocal[]) {
  if (rows.length === 0) return
  const pendientes = await pksPendientes('consola_reportes')
  await dbLocal.transaction('rw', dbLocal.consola_reportes, async () => {
    for (const r of rows) {
      // Se comprueban las dos formas de pk que usa esta tabla: clave
      // natural (alta por RPC y subida de imagen) e id (borrado). Si no,
      // un borrado aún en cola se desharía al llegar el pull.
      if (pendientes.has(claveReporte(r.fecha, r.tipo)) || pendientes.has(r.id)) continue
      const local = await dbLocal.consola_reportes
        .where('[fecha+tipo]')
        .equals([r.fecha, r.tipo])
        .first()
      if (local && local.id === r.id && local.updated_at === r.updated_at) continue
      if (local && local.id !== r.id) await dbLocal.consola_reportes.delete(local.id)
      await dbLocal.consola_reportes.put(r)
    }
  })
}

/** Pull incremental de una tabla por updated_at (paginado). */
async function pullIncremental<T extends { updated_at: string }>(
  tabla: 'registro_ventas' | 'cierres_caja' | 'precios_diarios' | 'consola_reportes',
  merge: (rows: T[]) => Promise<void>
) {
  const metaKey = `lastPull.${tabla}`
  const desde = await getMeta(metaKey)
  let cursor = desde ?? '1970-01-01T00:00:00Z'
  for (;;) {
    const { data, error } = await supabase
      .from(tabla)
      .select('*')
      .gt('updated_at', cursor)
      .order('updated_at', { ascending: true })
      .limit(PAGE)
    if (error) throw new Error(error.message)
    const rows = (data ?? []) as T[]
    if (rows.length === 0) break
    await merge(rows)
    cursor = rows[rows.length - 1].updated_at
    await setMeta(metaKey, cursor)
    if (rows.length < PAGE) break
  }
}

/**
 * Catálogos: pequeños → reemplazo completo, pero SOLO si algo cambió.
 * Reescribirlos idénticos cada tick re-dispararía los useLiveQuery.
 */
async function reemplazarSiCambio<T>(tabla: { toArray(): Promise<T[]>; clear(): Promise<void>; bulkPut(rows: T[]): Promise<unknown> }, rows: T[]) {
  const actuales = await tabla.toArray()
  if (JSON.stringify(actuales) === JSON.stringify(rows)) return
  await dbLocal.transaction('rw', tabla as never, async () => {
    await tabla.clear()
    await tabla.bulkPut(rows)
  })
}

async function pullCatalogos() {
  const [t, e, c, p] = await Promise.all([
    supabase.from('turnos').select('*').order('id'),
    supabase.from('empresas_clientes').select('*').order('nombre'),
    supabase.from('tipos_combustible').select('*').order('nombre'),
    supabase.from('profiles').select('id, nombre, activo').order('nombre'),
  ])
  // Si alguna falla (p. ej. offline a mitad), se conserva el catálogo previo.
  if (!t.error && t.data) await reemplazarSiCambio(dbLocal.turnos, t.data)
  if (!e.error && e.data) await reemplazarSiCambio(dbLocal.empresas_clientes, e.data)
  if (!c.error && c.data) await reemplazarSiCambio(dbLocal.tipos_combustible, c.data)
  if (!p.error && p.data) await reemplazarSiCambio(dbLocal.profiles, p.data)
}

/**
 * Hidratación inicial: baja la ventana de ~35 días de las tablas de
 * datos. Solo corre la primera vez (o si se borró IndexedDB); después
 * el pull incremental mantiene todo al día.
 */
async function hidratar() {
  if ((await getMeta('hidratado')) === '1') return
  const desde = fechaVentana()
  const [reg, cie, pre] = await Promise.all([
    supabase.from('registro_ventas').select('*').gte('fecha', desde),
    supabase.from('cierres_caja').select('*').gte('fecha', desde),
    supabase.from('precios_diarios').select('*'),
  ])
  if (reg.error || cie.error || pre.error) {
    throw new Error((reg.error ?? cie.error ?? pre.error)!.message)
  }
  await mergeRegistros(reg.data ?? [])
  await mergeCierres(cie.data ?? [])
  await mergePrecios(pre.data ?? [])
  // El incremental arranca desde "ahora": lo anterior ya está en la ventana.
  const ahora = new Date().toISOString()
  await setMeta('lastPull.registro_ventas', ahora)
  await setMeta('lastPull.cierres_caja', ahora)
  await setMeta('lastPull.precios_diarios', ahora)
  await setMeta('hidratado', '1')
}

/** Un ciclo completo: vaciar cola → traer cambios remotos. */
export async function sincronizarAhora(): Promise<void> {
  if (!navigator.onLine) return
  try {
    await pullCatalogos()
    await hidratar()
    const colaVacia = await flush()
    await pullIncremental('registro_ventas', mergeRegistros)
    await pullIncremental('cierres_caja', mergeCierres)
    await pullIncremental('precios_diarios', mergePrecios)
    // Sin entrada en `hidratado`: arranca desde 1970 y baja el historial
    // completo. Son ~2 filas al día, así que no hace falta ventana.
    await pullIncremental('consola_reportes', mergeReportes)
    if (colaVacia) setStatus({ ultimaSync: new Date().toISOString() })
  } catch (err) {
    if (esRechazoDefinitivo(err)) console.error('[sync] pull falló:', err)
  }
}

/**
 * Rango histórico bajo demanda (Seguimiento / historial mensual fuera
 * de la ventana hidratada): trae del servidor y lo deja cacheado en
 * Dexie. Sin conexión no hace nada: la UI muestra lo que haya local.
 */
export async function asegurarRango(desde: string, hasta: string): Promise<void> {
  if (!navigator.onLine) return
  try {
    const [reg, cie] = await Promise.all([
      supabase.from('registro_ventas').select('*').gte('fecha', desde).lte('fecha', hasta),
      supabase.from('cierres_caja').select('*').gte('fecha', desde).lte('fecha', hasta),
    ])
    if (!reg.error) await mergeRegistros(reg.data ?? [])
    if (!cie.error) await mergeCierres(cie.data ?? [])
  } catch (err) {
    if (esRechazoDefinitivo(err)) console.error('[sync] asegurarRango falló:', err)
  }
}

// ── Arranque ─────────────────────────────────────────────────────

let iniciado = false
const INTERVALO_MS = 45_000

/**
 * Arranca el worker (idempotente). Llamar cuando ya hay sesión de un
 * usuario admin (las tablas espejo tienen RLS de admin).
 */
export function iniciarSync(): void {
  if (iniciado) return
  iniciado = true

  // Blindaje del almacenamiento local: pide al navegador que marque el
  // origen como PERSISTENTE, para que IndexedDB (datos + outbox) no sea
  // candidato a desalojo si el disco se llena. Si el navegador lo niega
  // (depende de su heurística de "sitio importante"), todo sigue
  // funcionando igual — solo sin esa garantía extra.
  if (navigator.storage?.persist) {
    void navigator.storage.persisted().then(ya => {
      if (ya) return
      return navigator.storage.persist().then(ok => {
        console.info(ok ? '[sync] almacenamiento marcado persistente' : '[sync] persistencia denegada por el navegador')
      })
    })
  }

  window.addEventListener('online', () => {
    setStatus({ online: true })
    void sincronizarAhora()
  })
  window.addEventListener('offline', () => setStatus({ online: false }))

  setInterval(() => void sincronizarAhora(), INTERVALO_MS)
  void refrescarPendientes()
  void sincronizarAhora()
}
