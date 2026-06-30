// Denominaciones en céntimos (valor entero). Nunca floats.

export interface DenomDef {
  key: string
  label: string
  centimos: number
}

export const COIN_DEFS: DenomDef[] = [
  { key: 'c10', label: '10 céntimos', centimos: 10 },
  { key: 'c20', label: '20 céntimos', centimos: 20 },
  { key: 'c50', label: '50 céntimos', centimos: 50 },
  { key: 'c100', label: '1 sol', centimos: 100 },
  { key: 'c200', label: '2 soles', centimos: 200 },
  { key: 'c500', label: '5 soles', centimos: 500 },
]

export const BILL_DEFS: DenomDef[] = [
  { key: 'b1000', label: 'S/ 10', centimos: 1000 },
  { key: 'b2000', label: 'S/ 20', centimos: 2000 },
  { key: 'b5000', label: 'S/ 50', centimos: 5000 },
  { key: 'b10000', label: 'S/ 100', centimos: 10000 },
  { key: 'b20000', label: 'S/ 200', centimos: 20000 },
]

export type TipoVale = 'licitacion' | 'corporacion' | 'citv' | 'chevron' | 'credito'

export interface ValeTypeDef {
  tipo: TipoVale
  label: string
}

export const VALE_TYPES: ValeTypeDef[] = [
  { tipo: 'licitacion', label: 'Licitaciones' },
  { tipo: 'corporacion', label: 'Corporación' },
  { tipo: 'citv', label: 'CITV' },
  { tipo: 'chevron', label: 'Chevron' },
  { tipo: 'credito', label: 'Crédito' },
]
