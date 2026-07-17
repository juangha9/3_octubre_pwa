// ─────────────────────────────────────────────────────────────────
// Repo local-first: la UI de Ventas/Seguimiento pasa por aquí.
//
// Escrituras: aplican el cambio en Dexie (instantáneo, funciona sin
// internet) y encolan la mutación al outbox EN LA MISMA transacción;
// el worker de sync la envía a Supabase en cuanto puede.
// Lecturas: consultas a Dexie pensadas para `useLiveQuery` (la UI se
// re-renderiza sola cuando cambia lo local, sea por el usuario o por
// un pull del servidor).
// ─────────────────────────────────────────────────────────────────
import {
  dbLocal,
  claveCierre,
  type RegistroVentaLocal,
  type CierreCajaLocal,
  type PrecioDiarioLocal,
  type OutboxEntry,
} from './db'
import { despuesDeEncolar } from './sync'
import type { Turno, EmpresaCliente, TipoCombustible } from '@/types'

const ahoraISO = () => new Date().toISOString()

/** Columnas que existen solo en el espejo local, nunca se envían. */
function sinCamposLocales(row: object, omit: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(row)) {
    if (!omit.includes(k)) out[k] = v
  }
  return out
}

async function encolar(entry: Omit<OutboxEntry, 'id' | 'creado_en' | 'intentos'>) {
  await dbLocal.outbox.add({ ...entry, creado_en: ahoraISO(), intentos: 0 })
}

// ═════════════════════ REGISTRO_VENTAS ═══════════════════════════

export type NuevoRegistroVenta = Omit<
  RegistroVentaLocal,
  'id' | 'created_at' | 'updated_at' | 'deleted_at' | 'deleted_by' | 'cierre_id' | 'estado_pago' | 'fecha_pago' |
  'empresa_facturacion' | 'factura_numero' | 'fecha_facturacion'
> & Partial<Pick<RegistroVentaLocal, 'estado_pago' | 'fecha_pago' | 'empresa_facturacion' | 'factura_numero' | 'fecha_facturacion'>>

export async function insertRegistroVenta(datos: NuevoRegistroVenta): Promise<string> {
  const id = crypto.randomUUID()
  const ahora = ahoraISO()
  const fila: RegistroVentaLocal = {
    empresa_facturacion: null,
    factura_numero: null,
    fecha_facturacion: null,
    estado_pago: 'pendiente',
    fecha_pago: null,
    ...datos,
    id,
    cierre_id: null,
    deleted_at: null,
    deleted_by: null,
    created_at: ahora,
    updated_at: ahora,
  }
  await dbLocal.transaction('rw', dbLocal.registro_ventas, dbLocal.outbox, async () => {
    await dbLocal.registro_ventas.add(fila)
    // created/updated_at no viajan: los pone el servidor (su reloj manda
    // en el LWW); el pull posterior trae la fila con la hora oficial.
    await encolar({
      tabla: 'registro_ventas',
      op: 'insert',
      pk: id,
      payload: sinCamposLocales(fila, ['created_at', 'updated_at']),
    })
  })
  void despuesDeEncolar()
  return id
}

export async function updateRegistroVenta(
  id: string,
  patch: Partial<Omit<RegistroVentaLocal, 'id' | 'created_at' | 'updated_at'>>
): Promise<void> {
  await dbLocal.transaction('rw', dbLocal.registro_ventas, dbLocal.outbox, async () => {
    await dbLocal.registro_ventas.update(id, { ...patch, updated_at: ahoraISO() })
    await encolar({ tabla: 'registro_ventas', op: 'update', pk: id, payload: patch })
  })
  void despuesDeEncolar()
}

export async function softDeleteRegistroVenta(id: string, userId: string | null): Promise<void> {
  await updateRegistroVenta(id, { deleted_at: ahoraISO(), deleted_by: userId })
}

export async function restaurarRegistroVenta(id: string): Promise<void> {
  await updateRegistroVenta(id, { deleted_at: null, deleted_by: null })
}

// ═════════════════════ CIERRES_CAJA ══════════════════════════════

export interface CamposCierre {
  colaborador_id: string
  total_consola_centimos: number | null
  yape_centimos: number
  openpay_centimos: number
  deposito_transferencia_centimos: number
  dscto_vales_centimos: number
  serafinado_centimos: number
  redondeo_centimos: number
  entregado_grifero_centimos: number | null
  contabilizado_admin_centimos: number | null
}

/**
 * Upsert por clave natural (fecha, turno): así dos guardados offline del
 * mismo turno no crean cierres duplicados (UNIQUE de la migración 016).
 * El id local es provisional si el servidor ya tenía uno: el pull lo
 * reconcilia por fecha+turno.
 */
export async function upsertCierreCaja(
  fecha: string,
  turnoId: number,
  campos: CamposCierre
): Promise<void> {
  const ahora = ahoraISO()
  await dbLocal.transaction('rw', dbLocal.cierres_caja, dbLocal.outbox, async () => {
    const existente = await dbLocal.cierres_caja
      .where('[fecha+turno_id]')
      .equals([fecha, turnoId])
      .first()
    if (existente) {
      await dbLocal.cierres_caja.update(existente.id, { ...campos, updated_at: ahora })
    } else {
      await dbLocal.cierres_caja.add({
        id: crypto.randomUUID(),
        fecha,
        turno_id: turnoId,
        efectivo_centimos: 0,
        contaminacion_centimos: 0,
        corporacion_centimos: 0,
        licitaciones_centimos: 0,
        particulares_centimos: 0,
        chevron_centimos: 0,
        diferencia_centimos: null,
        ingreso_completado: false,
        notas: null,
        estado: 'borrador',
        created_at: ahora,
        updated_at: ahora,
        ...campos,
      })
    }
    // El payload NO lleva id: si el servidor ya tiene un cierre para esta
    // fecha+turno, el upsert debe actualizarlo sin intentar cambiarle el pk.
    await encolar({
      tabla: 'cierres_caja',
      op: 'upsert',
      pk: claveCierre(fecha, turnoId),
      onConflict: 'fecha,turno_id',
      payload: { fecha, turno_id: turnoId, ...campos },
    })
  })
  void despuesDeEncolar()
}

// ═════════════════════ PRECIOS_DIARIOS ═══════════════════════════

export async function upsertPrecioDiario(
  fecha: string,
  campos: {
    precio_db5_centimos: number
    precio_regular_centimos: number
    precio_premium_centimos: number
    registrado_por: string | null
  }
): Promise<void> {
  const ahora = ahoraISO()
  await dbLocal.transaction('rw', dbLocal.precios_diarios, dbLocal.outbox, async () => {
    const existente = await dbLocal.precios_diarios.where('fecha').equals(fecha).first()
    if (existente) {
      await dbLocal.precios_diarios.update(existente.id, { ...campos, updated_at: ahora })
    } else {
      await dbLocal.precios_diarios.add({
        id: crypto.randomUUID(),
        fecha,
        created_at: ahora,
        updated_at: ahora,
        ...campos,
      })
    }
    await encolar({
      tabla: 'precios_diarios',
      op: 'upsert',
      pk: fecha,
      onConflict: 'fecha',
      payload: { fecha, ...campos },
    })
  })
  void despuesDeEncolar()
}

// ═════════════════════ LECTURAS (para useLiveQuery) ══════════════

export interface Catalogos {
  turnos: Turno[]
  empresas: EmpresaCliente[]
  combustibles: TipoCombustible[]
  colaboradores: { id: string; nombre: string }[]
}

export async function leerCatalogos(): Promise<Catalogos> {
  const [turnos, empresas, combustibles, perfiles] = await Promise.all([
    dbLocal.turnos.toArray(),
    dbLocal.empresas_clientes.toArray(),
    dbLocal.tipos_combustible.toArray(),
    dbLocal.profiles.toArray(),
  ])
  return {
    turnos: turnos.filter(t => t.activo).sort((a, b) => a.id - b.id),
    empresas: empresas.filter(e => e.activo).sort((a, b) => a.nombre.localeCompare(b.nombre)),
    combustibles: combustibles.filter(c => c.activo).sort((a, b) => a.nombre.localeCompare(b.nombre)),
    colaboradores: perfiles
      .filter(p => p.activo)
      .sort((a, b) => a.nombre.localeCompare(b.nombre))
      .map(p => ({ id: p.id, nombre: p.nombre })),
  }
}

export interface DiaVentas {
  cierres: CierreCajaLocal[]
  registros: (RegistroVentaLocal & { empresa_nombre: string | null })[]
  /** Precio del día exacto, o el más reciente anterior (heredado). */
  precioRow: PrecioDiarioLocal | null
  esPrecioHeredado: boolean
}

export async function leerDia(fecha: string): Promise<DiaVentas> {
  const [cierres, registrosRaw, precioExacto, empresas] = await Promise.all([
    dbLocal.cierres_caja.where('fecha').equals(fecha).toArray(),
    dbLocal.registro_ventas.where('fecha').equals(fecha).toArray(),
    dbLocal.precios_diarios.where('fecha').equals(fecha).first(),
    dbLocal.empresas_clientes.toArray(),
  ])
  let precioRow = precioExacto ?? null
  let esPrecioHeredado = false
  if (!precioRow) {
    // Heredar el precio más reciente anterior (no cambia todos los días).
    precioRow = (await dbLocal.precios_diarios.where('fecha').below(fecha).last()) ?? null
    esPrecioHeredado = !!precioRow
  }
  const nombreEmpresa = new Map(empresas.map(e => [e.id, e.nombre]))
  // Orden por instante real: el created_at local (ISO "…Z") y el del
  // servidor ("…+00:00") no son comparables como texto.
  const registros = registrosRaw
    .filter(r => !r.deleted_at)
    .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at))
    .map(r => ({ ...r, empresa_nombre: r.empresa_id ? (nombreEmpresa.get(r.empresa_id) ?? null) : null }))
  return { cierres, registros, precioRow, esPrecioHeredado }
}

export async function leerCierresRango(
  desde: string,
  hasta: string
): Promise<(CierreCajaLocal & { colaborador_nombre: string })[]> {
  const [cierres, perfiles] = await Promise.all([
    dbLocal.cierres_caja.where('fecha').between(desde, hasta, true, true).toArray(),
    dbLocal.profiles.toArray(),
  ])
  const nombre = new Map(perfiles.map(p => [p.id, p.nombre]))
  return cierres
    .sort((a, b) => a.fecha.localeCompare(b.fecha) || a.turno_id - b.turno_id)
    .map(c => ({ ...c, colaborador_nombre: nombre.get(c.colaborador_id) ?? '—' }))
}

export async function leerRegistrosRango(
  desde: string,
  hasta: string,
  vista: 'activos' | 'papelera'
): Promise<(RegistroVentaLocal & { empresa_nombre: string | null; turno_nombre: string | null })[]> {
  const [rows, empresas, turnos] = await Promise.all([
    dbLocal.registro_ventas.where('fecha').between(desde, hasta, true, true).toArray(),
    dbLocal.empresas_clientes.toArray(),
    dbLocal.turnos.toArray(),
  ])
  const nombreEmpresa = new Map(empresas.map(e => [e.id, e.nombre]))
  const nombreTurno = new Map(turnos.map(t => [t.id, t.nombre]))
  return rows
    .filter(r => (vista === 'papelera' ? !!r.deleted_at : !r.deleted_at))
    .sort(
      (a, b) =>
        b.fecha.localeCompare(a.fecha) || Date.parse(b.created_at) - Date.parse(a.created_at)
    )
    .map(r => ({
      ...r,
      empresa_nombre: r.empresa_id ? (nombreEmpresa.get(r.empresa_id) ?? null) : null,
      turno_nombre: nombreTurno.get(r.turno_id) ?? null,
    }))
}
