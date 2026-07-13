// Filtro de texto para casillas numéricas.
//
// `useHardenNumberInputs` bloquea las teclas prohibidas MIENTRAS SE ESCRIBE dentro
// de un <input type="number">, pero en un grid tipo hoja de cálculo el valor entra
// por otras dos vías que no pasan por el input: teclear sobre la celda seleccionada
// (la 1ª tecla se siembra en el estado) y pegar con Ctrl+V. Estas funciones son las
// que cierran esos dos huecos. Ver BUENAS_PRACTICAS.md §6 (inputs numéricos).

/** ¿Esta tecla suelta puede formar parte de un número? */
export function esTeclaNumerica(k: string, negativo = false): boolean {
  if (k >= '0' && k <= '9') return true
  if (k === '.' || k === ',') return true
  return negativo && k === '-'
}

/**
 * Deja solo lo que puede formar un decimal: dígitos y UN separador decimal
 * (más el signo delante si se admite). Se descarta todo lo demás: letras (`e`),
 * operadores (`+ - * /`), espacios, símbolos de moneda.
 */
export function sanearNumero(texto: string, negativo = false): string {
  const negativa = negativo && /^\s*-/.test(texto)
  const [entera, ...resto] = texto.replace(/,/g, '.').replace(/[^0-9.]/g, '').split('.')
  const num = resto.length > 0 ? `${entera}.${resto.join('')}` : entera
  return negativa && num !== '' ? `-${num}` : num
}
