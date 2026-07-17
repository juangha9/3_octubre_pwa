// ─────────────────────────────────────────────────────────────────
// Base local (IndexedDB vía Dexie) — fundación local-first (fases 1-2)
//
// La UI de Ventas y Seguimiento lee y escribe SIEMPRE aquí; una cola
// (outbox) replica los cambios a Supabase cuando hay conexión y un
// worker de sync trae los cambios remotos (pull incremental por
// updated_at). Supabase sigue siendo la fuente de verdad: en cada pull
// el dato del servidor pisa al local, salvo que el local tenga cambios
// aún no enviados (están en el outbox).
// ─────────────────────────────────────────────────────────────────
import Dexie, { type Table } from 'dexie'
import type { Turno, EmpresaCliente, TipoCombustible } from '@/types'

// ── Filas locales (espejo 1:1 de las tablas de Supabase) ─────────

export interface RegistroVentaLocal {
  id: string
  cierre_id: string | null
  fecha: string
  turno_id: number
  colaborador_id: string
  tipo_documento: string
  serie: string | null
  numero: string | null
  empresa_id: string | null
  tipo_atencion: string
  conductor: string | null
  placa: string | null
  dni_conductor: string | null
  tipo_combustible: string
  cantidad_galones: number
  precio_unit_centimos: number
  importe_centimos: number
  importe_declarado_centimos: number | null
  empresa_facturacion: string | null
  factura_numero: string | null
  fecha_facturacion: string | null
  estado_pago: 'pagado' | 'pendiente'
  fecha_pago: string | null
  deleted_at: string | null
  deleted_by: string | null
  created_at: string
  updated_at: string
}

export interface CierreCajaLocal {
  id: string
  colaborador_id: string
  turno_id: number
  fecha: string
  efectivo_centimos: number
  yape_centimos: number
  openpay_centimos: number
  deposito_transferencia_centimos: number
  dscto_vales_centimos: number
  serafinado_centimos: number
  redondeo_centimos: number
  contaminacion_centimos: number
  total_consola_centimos: number | null
  diferencia_centimos: number | null
  entregado_grifero_centimos: number | null
  corporacion_centimos: number
  licitaciones_centimos: number
  particulares_centimos: number
  chevron_centimos: number
  contabilizado_admin_centimos: number | null
  ingreso_completado: boolean
  notas: string | null
  estado: string
  created_at: string
  updated_at: string
}

export interface PrecioDiarioLocal {
  id: string
  fecha: string
  precio_db5_centimos: number
  precio_regular_centimos: number
  precio_premium_centimos: number
  registrado_por: string | null
  created_at: string
  updated_at: string
}

export interface PerfilLocal {
  id: string
  nombre: string
  activo: boolean
}

// ── Cola de mutaciones pendientes de enviar a Supabase ───────────
// Se procesa en orden estricto (FIFO): un update que sigue a un insert
// de la misma fila debe llegar después. `pk` identifica la fila local;
// para los upsert por clave natural es esa clave (p. ej. "fecha|turno").
export interface OutboxEntry {
  id?: number
  tabla: 'registro_ventas' | 'cierres_caja' | 'precios_diarios'
  op: 'insert' | 'update' | 'upsert'
  pk: string
  /** Columnas de conflicto del upsert (p. ej. 'fecha,turno_id'). */
  onConflict?: string
  payload: Record<string, unknown>
  creado_en: string
  intentos: number
  ultimo_error?: string
}

export interface MetaEntry {
  clave: string
  valor: string
}

class GrifoLocalDB extends Dexie {
  registro_ventas!: Table<RegistroVentaLocal, string>
  cierres_caja!: Table<CierreCajaLocal, string>
  precios_diarios!: Table<PrecioDiarioLocal, string>
  turnos!: Table<Turno, number>
  empresas_clientes!: Table<EmpresaCliente, string>
  tipos_combustible!: Table<TipoCombustible, string>
  profiles!: Table<PerfilLocal, string>
  outbox!: Table<OutboxEntry, number>
  meta!: Table<MetaEntry, string>

  constructor() {
    super('grifo-local')
    this.version(1).stores({
      // Solo se indexa lo que se consulta; el resto de columnas viaja
      // dentro del objeto sin declararse.
      registro_ventas: 'id, fecha, updated_at',
      cierres_caja: 'id, [fecha+turno_id], fecha, updated_at',
      precios_diarios: 'id, fecha',
      turnos: 'id',
      empresas_clientes: 'id',
      tipos_combustible: 'codigo',
      profiles: 'id',
      outbox: '++id, tabla',
      meta: 'clave',
    })
  }
}

export const dbLocal = new GrifoLocalDB()

/** Clave natural de un cierre de caja (única por migración 016). */
export const claveCierre = (fecha: string, turnoId: number) => `${fecha}|${turnoId}`
