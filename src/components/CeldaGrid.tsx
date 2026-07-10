import { useEffect, useRef } from 'react'

/** Dónde queda el cursor al entrar en edición. */
export type Caret =
  | 'todo'     // selecciona el contenido: al teclear se reemplaza (F2, doble clic)
  | 'fin'      // cursor al final: se acaba de sembrar el primer carácter tecleado
  | 'ninguno'  // el editor gestiona su propio foco (p. ej. Combobox)

interface CeldaGridProps {
  /** Coordenadas dentro de la tabla; se exponen como `data-celda="f-c"`. */
  f: number
  c: number
  activa: boolean
  editando: boolean
  /** Si es false, la celda solo se puede seleccionar y copiar. */
  editable?: boolean
  /** Roving tabindex: solo una celda de la tabla entra en el orden de tabulación. */
  tabbable?: boolean
  /** Marca la celda cuyo contenido está en el portapapeles (borde animado). */
  copiada?: boolean
  /** Lo que se ve cuando NO está en edición. Su texto es lo que copia Ctrl+C. */
  contenido: React.ReactNode
  /** El input real; solo se monta mientras la celda está en edición. */
  editor?: React.ReactNode
  caret?: Caret
  align?: 'left' | 'right' | 'center'
  className?: string
  style?: React.CSSProperties
  onSeleccionar: () => void
  onEditar: () => void
}

/**
 * Celda de tabla con comportamiento de hoja de cálculo: un clic la selecciona
 * (sin entrar en edición, para poder copiarla), y solo Enter / F2 / doble clic
 * o teclear encima montan el editor.
 *
 * El `<td>` es el elemento enfocable mientras no se edita: así las flechas y
 * Ctrl+C/Ctrl+V llegan al manejador de la tabla en vez de moverse dentro de un
 * input.
 */
export default function CeldaGrid({
  f,
  c,
  activa,
  editando,
  editable = false,
  tabbable = false,
  copiada = false,
  contenido,
  editor,
  caret = 'todo',
  align = 'left',
  className = '',
  style,
  onSeleccionar,
  onEditar,
}: CeldaGridProps) {
  const tdRef = useRef<HTMLTableCellElement>(null)
  const enEdicion = activa && editando && editable && !!editor

  useEffect(() => {
    if (!enEdicion) return
    const el = tdRef.current?.querySelector<HTMLElement>('input, select, textarea')
    if (!el) return
    el.focus()
    // 'ninguno': el editor coloca el cursor por su cuenta (p. ej. el Combobox
    // selecciona su texto en onFocus).
    if (caret === 'ninguno' || !(el instanceof HTMLInputElement)) return
    if (caret === 'todo') {
      el.select()
    } else {
      // `setSelectionRange` lanza en <input type="number">; reasignar el valor
      // deja el cursor al final en todos los tipos.
      const v = el.value
      el.value = ''
      el.value = v
    }
  }, [enEdicion, caret])

  const alineacion =
    align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left'

  return (
    <td
      ref={tdRef}
      data-celda={`${f}-${c}`}
      // Enfocable solo cuando no edita: el foco pertenece entonces al input.
      tabIndex={!enEdicion && tabbable ? 0 : -1}
      onMouseDown={onSeleccionar}
      onDoubleClick={() => { if (editable) onEditar() }}
      className={`outline-none ${activa && !enEdicion ? 'celda-activa' : ''} ${copiada && !enEdicion ? 'celda-copiada' : ''} ${className}`}
      style={style}
    >
      {enEdicion ? editor : <div className={`truncate ${alineacion}`}>{contenido}</div>}
    </td>
  )
}
