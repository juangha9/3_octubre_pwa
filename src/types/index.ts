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
  distrito: string
  total_establecimientos: number
  ranking_db5: number | null
  precio_db5_centimos: number | null
  ranking_regular: number | null
  precio_regular_centimos: number | null
  ranking_premium: number | null
  precio_premium_centimos: number | null
  created_at: string
}

export interface OsinergminTop10 {
  id: string
  snapshot_id: string
  producto: 'DB5' | 'REGULAR' | 'PREMIUM'
  ranking: number
  razon_social: string
  direccion: string
  precio_centimos: number
  es_nuestro: boolean
}
