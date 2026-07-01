import { useEffect } from 'react'

// Teclas que NO se admiten en ninguna caja numérica de la app.
const BLOCKED_KEYS = ['e', 'E', '+', '-', '*', '/']

/**
 * Endurece de forma GLOBAL todos los `<input type="number">` de la app:
 *  - Bloquea teclear  e / E / + / - / * / /
 *  - El scroll del ratón NO cambia el valor (se quita el foco al hacer wheel)
 *
 * Las flechas (spinners) se ocultan por CSS en `index.css`.
 * Se llama UNA sola vez en la raíz (`App.tsx`); cubre inputs actuales y futuros
 * sin tener que tocar cada uno. Ver BUENAS_PRACTICAS.md §6 (inputs numéricos).
 */
export function useHardenNumberInputs() {
  useEffect(() => {
    const isNumberInput = (el: EventTarget | null): el is HTMLInputElement =>
      el instanceof HTMLInputElement && el.type === 'number'

    const onKeyDown = (e: KeyboardEvent) => {
      if (isNumberInput(e.target) && BLOCKED_KEYS.includes(e.key)) {
        e.preventDefault()
      }
    }

    // Solo interviene si el input está enfocado (que es cuando el wheel
    // cambiaría el número). Al quitar el foco, el scroll pasa a la página.
    const onWheel = (e: WheelEvent) => {
      const el = e.target
      if (isNumberInput(el) && document.activeElement === el) {
        el.blur()
      }
    }

    document.addEventListener('keydown', onKeyDown, true)
    document.addEventListener('wheel', onWheel, { passive: true, capture: true })
    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
      document.removeEventListener('wheel', onWheel, true)
    }
  }, [])
}
