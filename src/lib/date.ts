/**
 * Valida que una cadena sea una fecha completa y real en formato YYYY-MM-DD.
 * Al escribir a mano en un <input type="date"> el valor queda vacío o
 * incompleto hasta terminar; consultar Supabase con `fecha=eq.` (vacío) o una
 * fecha imposible provoca un 400 Bad Request. Este guard evita esas consultas.
 */
export function esFechaValida(s: string | null | undefined): s is string {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false
  const [y, m, d] = s.split('-').map(Number)
  if (m < 1 || m > 12 || d < 1 || d > 31) return false
  const dt = new Date(y, m - 1, d)
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d
}

/** Fecha local en formato YYYY-MM-DD (respeta zona horaria, ej. Perú UTC-5) */
export function hoyLocal(): string {
  const d = new Date()
  const off = d.getTimezoneOffset() * 60000
  return new Date(d.getTime() - off).toISOString().slice(0, 10)
}

/** Date → "29/06/2026" */
export function formatFecha(d: Date = new Date()): string {
  return d.toLocaleDateString('es-PE', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

/** Date → "14:30" */
export function formatHora(d: Date = new Date()): string {
  return d.toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' })
}
