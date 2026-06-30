// Dinero siempre en céntimos (enteros bigint). Nunca operar con floats.

/** S/ 10.50 → 1050 */
export function toCentimos(soles: string | number): number {
  const n = typeof soles === 'string' ? parseFloat(soles.replace(',', '.')) : soles
  if (isNaN(n)) return 0
  return Math.round(n * 100)
}

/** 1050 → "S/ 10.50" */
export function formatSoles(centimos: number | null | undefined): string {
  if (centimos == null) return 'S/ 0.00'
  return 'S/ ' + (centimos / 100).toFixed(2)
}

/** 1050 → "10.50" (sin símbolo, para inputs) */
export function formatSolesRaw(centimos: number | null | undefined): string {
  if (centimos == null) return '0.00'
  return (centimos / 100).toFixed(2)
}

/** Suma un array de centimos con seguridad */
export function sumCentimos(arr: (number | null | undefined)[]): number {
  return arr.reduce<number>((acc, v) => acc + (v ?? 0), 0)
}

/** Diferencia: positivo = sobrante, negativo = faltante */
export function diferencia(a: number, b: number): number {
  return a - b
}

/** Clase CSS según si hay diferencia o no */
export function diferenciaClass(centimos: number): string {
  if (centimos > 0) return 'text-success-text'
  if (centimos < 0) return 'text-danger-text'
  return 'text-app-muted'
}
