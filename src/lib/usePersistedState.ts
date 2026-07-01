import { useEffect, useState } from 'react'

/**
 * Igual que `useState`, pero persiste el valor en `localStorage`.
 *
 * Ideal para recordar filtros (mes, tipo, empresa…) al cambiar de módulo o al
 * recargar la página. Pesa unos pocos bytes por clave, así que NO satura el
 * navegador (localStorage ronda 5-10 MB por dominio; un filtro son bytes).
 *
 * Usar claves con prefijo del módulo, ej. `'seguimiento.mes'`.
 */
export function usePersistedState<T>(key: string, initial: T | (() => T)) {
  const [state, setState] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key)
      if (raw != null) return JSON.parse(raw) as T
    } catch {
      /* localStorage no disponible o JSON inválido → usar inicial */
    }
    return typeof initial === 'function' ? (initial as () => T)() : initial
  })

  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(state))
    } catch {
      /* modo privado / cuota llena → ignorar, no romper la UI */
    }
  }, [key, state])

  return [state, setState] as const
}
