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
