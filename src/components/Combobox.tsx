import { useEffect, useLayoutEffect, useRef, useState } from 'react'

export interface ComboOption {
  value: string
  label: string
}

interface ComboboxProps {
  options: ComboOption[]
  /** Valor actualmente seleccionado (debe coincidir con `option.value`). */
  value: string
  /** Se dispara al confirmar una opción válida (o al limpiar con ''). */
  onChange: (value: string) => void
  /** Se dispara tras confirmar/salir, con el valor final ya resuelto.
      Útil para guardar en línea sin depender de estado potencialmente stale. */
  onCommit?: (value: string) => void
  placeholder?: string
  className?: string
  style?: React.CSSProperties
  disabled?: boolean
  /** Permite dejarlo vacío (equivale a "ninguno"). Por defecto true. */
  allowEmpty?: boolean
  /** id del <input> interno (para enfocarlo por programación, p. ej. tras guardar). */
  id?: string
}

/**
 * Combobox editable: se escribe para filtrar, pero SOLO se guarda un valor que
 * coincida con una opción existente. Si el texto no coincide con nada al salir,
 * se revierte al último valor válido (no se persiste texto libre).
 *
 * El menú se posiciona con `position: fixed` calculado desde el input, para que
 * no lo recorte el `overflow` de las tablas donde se usa.
 */
export default function Combobox({
  options,
  value,
  onChange,
  onCommit,
  placeholder = 'Buscar…',
  className = '',
  style,
  disabled = false,
  allowEmpty = true,
  id,
}: ComboboxProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [activeIdx, setActiveIdx] = useState(0)
  const [rect, setRect] = useState<{ left: number; top: number; width: number } | null>(null)

  const inputRef = useRef<HTMLInputElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  // El estado `open` se actualiza async; este ref permite cancelar (Escape) o
  // evitar doble-commit de forma síncrona antes de que llegue el blur.
  const openRef = useRef(false)

  const selectedLabel = options.find(o => o.value === value)?.label ?? ''

  // Texto visible: al escribir muestra `query`; si no, la etiqueta seleccionada.
  const display = open ? query : selectedLabel

  const norm = (s: string) => s.trim().toLowerCase()
  const filtered =
    open && query.trim() !== ''
      ? options.filter(o => norm(o.label).includes(norm(query)))
      : options

  function updateRect() {
    const el = inputRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    setRect({ left: r.left, top: r.bottom, width: r.width })
  }

  useLayoutEffect(() => {
    if (open) updateRect()
  }, [open])

  useEffect(() => {
    if (!open) return
    const onScrollOrResize = () => updateRect()
    // capture: recalcular aunque el scroll sea de un contenedor interno (tabla)
    window.addEventListener('scroll', onScrollOrResize, true)
    window.addEventListener('resize', onScrollOrResize)
    function onDocMouseDown(e: MouseEvent) {
      const t = e.target as Node
      if (wrapRef.current?.contains(t) || menuRef.current?.contains(t)) return
      closeAndCommit()
    }
    document.addEventListener('mousedown', onDocMouseDown)
    return () => {
      window.removeEventListener('scroll', onScrollOrResize, true)
      window.removeEventListener('resize', onScrollOrResize)
      document.removeEventListener('mousedown', onDocMouseDown)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, query, options])

  function openMenu() {
    openRef.current = true
    setOpen(true)
  }
  function closeMenu() {
    openRef.current = false
    setOpen(false)
    setQuery('')
  }

  function commitValue(next: string) {
    if (next !== value) onChange(next)
    onCommit?.(next)
  }

  // Al salir sin elegir explícitamente: si el texto coincide EXACTO con una
  // opción, se toma; si está vacío y se permite, se limpia; si no, se revierte.
  function closeAndCommit() {
    // `openRef` es síncrono: evita doble-commit (blur + mousedown) y evita
    // commitear tras un Escape que ya cerró el menú.
    if (!openRef.current) return
    const q = norm(query)
    let next = value
    if (q === '') {
      next = allowEmpty ? '' : value
    } else {
      const exact = options.find(o => norm(o.label) === q)
      const single = filtered.length === 1 ? filtered[0] : undefined
      const match = exact ?? single
      next = match ? match.value : value // sin coincidencia → revertir
    }
    closeMenu()
    commitValue(next)
  }

  function selectOption(opt: ComboOption) {
    closeMenu()
    commitValue(opt.value)
    inputRef.current?.blur()
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (!open) { openMenu(); return }
      setActiveIdx(i => Math.min(i + 1, filtered.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIdx(i => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (open && filtered[activeIdx]) selectOption(filtered[activeIdx])
      else closeAndCommit()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      closeMenu() // cancelar sin persistir el texto
      inputRef.current?.blur()
    }
  }

  return (
    <div ref={wrapRef} className="relative" style={style}>
      <input
        ref={inputRef}
        id={id}
        type="text"
        disabled={disabled}
        className={className}
        placeholder={placeholder}
        value={display}
        onFocus={() => { openMenu(); setQuery(''); setActiveIdx(0) }}
        onChange={e => { setQuery(e.target.value); openMenu(); setActiveIdx(0) }}
        onKeyDown={onKeyDown}
        // Al perder foco por teclado (Tab) confirmamos/cerramos. Al hacer clic en
        // una opción no se dispara: el menú previene el blur con preventDefault.
        onBlur={() => closeAndCommit()}
        autoComplete="off"
        spellCheck={false}
      />

      {open && !disabled && rect && (
        <div
          ref={menuRef}
          className="fixed z-50 max-h-56 overflow-auto rounded border border-app-border bg-app-surface py-1 shadow-lg"
          style={{ left: rect.left, top: rect.top + 2, minWidth: rect.width }}
          // Evitar que el blur del input cierre antes de procesar el click
          onMouseDown={e => e.preventDefault()}
        >
          {filtered.length === 0 && (
            <p className="px-2 py-1 text-xs italic text-app-muted">Sin coincidencias</p>
          )}
          {filtered.map((opt, i) => (
            <button
              key={opt.value}
              type="button"
              // Fuera del orden de tabulación: si estuviera, al abrirse el menú
              // (en el focus) el Tab iría a la 1ª opción y no a la celda siguiente.
              tabIndex={-1}
              onClick={() => selectOption(opt)}
              onMouseEnter={() => setActiveIdx(i)}
              className={`block w-full cursor-pointer whitespace-nowrap px-2 py-1 text-left text-xs ${
                i === activeIdx ? 'bg-primary text-primary-text' : 'text-app-text hover:bg-app-border'
              } ${opt.value === value ? 'font-semibold' : ''}`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
