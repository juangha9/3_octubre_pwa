import { useEffect, useRef, useState } from 'react'

interface Option {
  value: string
  label: string
}

interface MultiSelectDropdownProps {
  options: Option[]
  selected: string[]
  onChange: (values: string[]) => void
  placeholder: string
  className?: string
  style?: React.CSSProperties
  showChevron?: boolean
  disabled?: boolean
}

/**
 * Dropdown de selección múltiple con checkboxes (a diferencia de un
 * <select multiple>, que exige Ctrl/Cmd+click y no muestra casillas).
 */
export default function MultiSelectDropdown({
  options,
  selected,
  onChange,
  placeholder,
  className = '',
  style,
  showChevron = true,
  disabled = false,
}: MultiSelectDropdownProps) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onClickOutside(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [open])

  function toggle(value: string) {
    if (selected.includes(value)) {
      onChange(selected.filter(v => v !== value))
    } else {
      onChange([...selected, value])
    }
  }

  const label =
    selected.length === 0
      ? placeholder
      : selected.length === 1
      ? options.find(o => o.value === selected[0])?.label ?? placeholder
      : `${selected.length} seleccionados`

  return (
    <div ref={rootRef} className="relative" style={style}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(o => !o)}
        className={`input flex items-center justify-between gap-1 text-left disabled:opacity-50 disabled:cursor-not-allowed ${className}`}
      >
        <span className={`truncate ${selected.length === 0 ? 'text-app-muted' : ''}`}>{label}</span>
        {showChevron && (
          <svg width="10" height="10" viewBox="0 0 10 6" className="shrink-0 opacity-60">
            <path d="M1 1l4 4 4-4" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </button>

      {open && !disabled && (
        <div className="absolute z-20 mt-1 max-h-56 min-w-full overflow-auto rounded border border-app-border bg-white py-1 shadow-lg">
          {options.length === 0 && (
            <p className="px-2 py-1 text-xs text-app-muted italic">Sin opciones</p>
          )}
          {options.map(opt => (
            <label
              key={opt.value}
              className="flex cursor-pointer items-center gap-2 whitespace-nowrap px-2 py-1 text-xs hover:bg-slate-50"
            >
              <input
                type="checkbox"
                checked={selected.includes(opt.value)}
                onChange={() => toggle(opt.value)}
                className="h-3.5 w-3.5 rounded border-app-border"
              />
              {opt.label}
            </label>
          ))}
        </div>
      )}
    </div>
  )
}
