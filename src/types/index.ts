export type Role = 'grifero' | 'admin_grifo' | 'superadmin'

export interface Profile {
  id: string
  nombre: string
  rol: Role
  activo: boolean
  created_at: string
}

export interface Turno {
  id: number
  nombre: string
  hora_inicio: string | null
  hora_fin: string | null
  activo: boolean
}

export interface TipoCombustible {
  codigo: string
  nombre: string
  nombre_osinergmin: string
  activo: boolean
}

export interface Tanque {
  id: number
  nombre: string
  tipo_combustible_codigo: string
  capacidad_galones: number | null
  activo: boolean
  layout_fila: number | null
  layout_columna: number | null
}

export interface TanqueAforo {
  id: string
  tanque_id: number
  altura_cm: number
  volumen_galones: number
}

export interface VarillajeLectura {
  id: string
  tanque_id: number
  fecha: string
  tipo: 'cambio_turno' | 'control_osinergmin'
  turno_id: number | null
  colaborador_id: string
  altura_cm: number
  volumen_galones: number
  notas: string | null
  created_at: string
}

// Fila de `fn_stock_actual()` (RPC): última lectura de varillaje por tanque
// activo, en galones. Solo la puede consultar admin+ (los galones son dato de
// inventario; el grifero nunca los ve). Alimenta el "stock actual" del Cotizador.
export interface VarillajeStockRow {
  tanque_id: number
  tanque_nombre: string
  tipo_combustible_codigo: string
  altura_cm: number
  volumen_galones: number
  medido_en: string
}

export interface PrecioDiario {
  id: string
  fecha: string
  precio_db5_centimos: number
  precio_regular_centimos: number
  precio_premium_centimos: number
  registrado_por: string
  created_at: string
}

export interface CierreCaja {
  id: string
  colaborador_id: string
  turno_id: number
  fecha: string
  efectivo_centimos: number
  yape_centimos: number
  openpay_centimos: number
  deposito_transferencia_centimos: number
  serafinado_centimos: number
  redondeo_centimos: number
  contaminacion_centimos: number
  dscto_vales_centimos: number
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
  estado: 'borrador' | 'enviado' | 'revisado'
  created_at: string
  updated_at: string
}

export interface CierreVale {
  id: string
  cierre_id: string
  tipo_vale: 'licitacion' | 'corporacion' | 'citv' | 'chevron' | 'credito'
  descripcion: string | null
  monto_centimos: number
  orden: number
}

export interface CierreDenominacion {
  id: string
  cierre_id: string
  tipo: 'moneda' | 'billete'
  denominacion_centimos: number
  cantidad: number
}

export interface EmpresaCliente {
  id: string
  nombre: string
  ruc: string | null
  tipo: string
  contacto: string | null
  activo: boolean
  created_at: string
}

export interface RegistroVenta {
  id: string
  cierre_id: string | null
  fecha: string
  turno_id: number
  colaborador_id: string
  tipo_documento: 'vale' | 'factura' | 'boleta' | 'nota_credito'
  serie: string | null
  numero: string | null
  empresa_id: string | null
  tipo_atencion: 'corporativo' | 'licitacion' | 'particular' | 'chevron'
  conductor: string | null
  placa: string | null
  dni_conductor: string | null
  tipo_combustible: string
  cantidad_galones: number
  precio_unit_centimos: number
  importe_centimos: number
  empresa_facturacion: string | null
  factura_numero: string | null
  fecha_facturacion: string | null
  estado_pago: 'pagado' | 'pendiente'
  fecha_pago: string | null
  created_at: string
}

export interface Proveedor {
  id: string
  nombre: string
  contacto: string | null
  telefono: string | null
  activo: boolean
  created_at: string
}

// ─── Registro de Compras (modelo cabecera + líneas + fletes) ──────────
// Una compra puede traer 1-3 productos (líneas) y hasta 3 fletes (distintos
// transportistas), cada flete pagado/pendiente y con a qué productos aplica.
// El precio por galón lleva 4 decimales (como el Excel), por eso NO va en
// céntimos sino en soles `numeric(12,4)`; los montos (flete) sí en céntimos.
export interface Compra {
  id: string
  fecha: string
  proveedor_id: string | null
  notas: string | null
  registrado_por: string | null
  created_at: string
  updated_at: string
}

export interface CompraLinea {
  id: string
  compra_id: string
  tipo_combustible: string
  galones: number
  precio_gl: number // soles, 4 decimales
}

export interface CompraFlete {
  id: string
  compra_id: string
  transportista: string | null
  precio_gl: number // tarifa de flete por galón (soles, 4 dec). Total = precio_gl × galones aplicables
  aplica_a: string[] | null // códigos de combustible; null/vacío = todos
  estado_pago: 'pagado' | 'pendiente'
  fecha_pago: string | null
}

// Compra con sus relaciones embebidas (PostgREST) para la tabla del módulo.
export interface CompraConDetalle extends Compra {
  compra_lineas: CompraLinea[]
  compra_fletes: CompraFlete[]
  proveedores: { nombre: string } | null
}

export interface AppConfig {
  clave: string
  valor: string
  descripcion: string | null
  updated_at: string
}

export interface OsinergminSnapshot {
  id: string
  fecha_consulta: string
  fecha_datos_excel: string
  // La zona son los TRES: hay distritos homónimos (MIRAFLORES está en Arequipa
  // y en Lima). Null en snapshots anteriores a la migración 015.
  departamento: string | null
  provincia: string | null
  distrito: string
  // Establecimientos de la zona (cualquier producto).
  total_establecimientos: number
  // Establecimientos que venden ESE producto = el "de N" del puesto. Null en
  // snapshots anteriores a la migración 015.
  total_db5: number | null
  total_regular: number | null
  total_premium: number | null
  ranking_db5: number | null
  precio_db5_centimos: number | null
  ranking_regular: number | null
  precio_regular_centimos: number | null
  ranking_premium: number | null
  precio_premium_centimos: number | null
  // De qué fuente salió (migración 020). 'facilito' = en vivo; 'excel' =
  // respaldo. Null en snapshots anteriores a la 020 → fuente desconocida.
  fuente: 'facilito' | 'excel' | null
  created_at: string
}

export interface OsinergminTop10 {
  id: string
  snapshot_id: string
  producto: 'DB5' | 'REGULAR' | 'PREMIUM'
  ranking: number
  razon_social: string
  direccion: string
  /** CODIGO_OSINERG: identifica al establecimiento (un RUC puede tener varios). */
  codigo_osinerg: string | null
  precio_centimos: number
  es_nuestro: boolean
}
