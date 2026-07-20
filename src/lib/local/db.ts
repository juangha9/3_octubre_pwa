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

/** Cabecera de un reporte de consola (espejo de consola_reportes). */
export interface ConsolaReporteLocal {
  id: string
  fecha: string
  tipo: ConsolaTipo
  imagen_path: string | null
  /** Salida cruda del OCR: incluye las líneas por producto / por tanque. */
  extraido: Record<string, unknown> | null
  ventas_total: number | null
  volumen_total_gl: number | null
  importe_total_centimos: number | null
  /** Σ(productos) = RSM. false ⇒ el OCR leyó mal; no autoconfirmar. */
  validacion_ok: boolean | null
  /** Periodo que declara el encabezado del reporte (migración 019). */
  periodo_inicio: string | null
  periodo_fin: string | null
  solicitud: string | null
  /**
   * Día deducido del periodo. Si difiere de `fecha`, el reporte se archivó
   * en un día distinto al que parece cubrir: o se pegó la imagen que no
   * era, o el OCR leyó mal la fecha. Ambas cosas interesan al superadmin.
   */
  fecha_detectada: string | null
  estado: 'pendiente' | 'confirmado'
  fuente: 'ocr_local' | 'llm' | 'manual'
  editado_manual: boolean
  created_at: string
  updated_at: string
  deleted_at: string | null
}

export type ConsolaTipo = 'ventas_dia' | 'stock_dia'

/**
 * Imagen pegada, en binario. Vive en su propia tabla para que la cola no
 * cargue blobs: el outbox solo guarda la `clave` con la que buscarla aquí.
 * Se conserva tras subirla (copia local para auditoría sin red).
 */
export interface ImagenLocal {
  /** `fecha|tipo`, la misma identidad natural del reporte. */
  clave: string
  blob: Blob
  contentType: string
  creado_en: string
}

// ── Cola de mutaciones pendientes de enviar a Supabase ───────────
// Se procesa en orden estricto (FIFO): un update que sigue a un insert
// de la misma fila debe llegar después. `pk` identifica la fila local;
// para los upsert por clave natural es esa clave (p. ej. "fecha|turno").
export interface OutboxEntry {
  id?: number
  tabla: 'registro_ventas' | 'cierres_caja' | 'precios_diarios' | 'consola_reportes'
  /**
   * `upload` sube un binario a Storage (el blob se busca en `imagenes` por
   * `payload.clave`); `rpc` invoca una función que escribe varias tablas de
   * una sola vez. Ambas se encolan como cualquier otra mutación, así que
   * una imagen pegada sin conexión sale sola al reconectar.
   */
  op: 'insert' | 'update' | 'upsert' | 'upload' | 'rpc'
  pk: string
  /** Columnas de conflicto del upsert (p. ej. 'fecha,turno_id'). */
  onConflict?: string
  /** Nombre de la función para `op: 'rpc'`. */
  fn?: string
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
  consola_reportes!: Table<ConsolaReporteLocal, string>
  imagenes!: Table<ImagenLocal, string>
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
    // v2 (migración 017): reportes de consola + blobs de las imágenes.
    // Dexie conserva los stores no mencionados, así que no hay que
    // repetir los de la v1 ni se pierde nada de lo ya guardado.
    this.version(2).stores({
      consola_reportes: 'id, [fecha+tipo], fecha, updated_at',
      imagenes: 'clave',
    })
  }
}

export const dbLocal = new GrifoLocalDB()

/** Clave natural de un cierre de caja (única por migración 016). */
export const claveCierre = (fecha: string, turnoId: number) => `${fecha}|${turnoId}`

/** Clave natural de un reporte de consola (única por migración 017). */
export const claveReporte = (fecha: string, tipo: ConsolaTipo) => `${fecha}|${tipo}`

/**
 * Ruta determinista en el bucket. Al conocerse antes de subir, la fila
 * puede guardar su `imagen_path` sin esperar a que termine la carga.
 */
export const rutaImagen = (fecha: string, tipo: ConsolaTipo) => `${fecha}/${tipo}.webp`
