import { useState, useRef, useEffect } from 'react'
import { toCentimos, formatSoles, sumCentimos } from '@/lib/money'

export interface ValeItem {
  id: string // id local para React keys
  descripcion: string
  montoStr: string
}

export function nuevaValeItem(): ValeItem {
  return { id: crypto.randomUUID(), descripcion: '', montoStr: '' }
}

interface ValeModalProps {
  titulo: string
  items: ValeItem[]
  onGuardar: (items: ValeItem[]) => void
  onCerrar: () => void
}

export default function ValeModal({ titulo, items, onGuardar, onCerrar }: ValeModalProps) {
  // Borrador local; arranca con los items existentes o una fila vacía
  const [draft, setDraft] = useState<ValeItem[]>(
    items.length > 0 ? items.map((i) => ({ ...i })) : [nuevaValeItem()]
  )
  const [focusId, setFocusId] = useState<string | null>(null)

  const total = sumCentimos(draft.map((d) => toCentimos(d.montoStr)))

  function updateItem(id: string, patch: Partial<ValeItem>) {
    setDraft((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)))
  }

  function addRow() {
    const nueva = nuevaValeItem()
    setDraft((prev) => [...prev, nueva])
    setFocusId(nueva.id)
  }

  function removeRow(id: string) {
    setDraft((prev) => (prev.length === 1 ? [nuevaValeItem()] : prev.filter((it) => it.id !== id)))
  }

  function handleGuardar() {
    // Solo guarda filas con monto > 0
    const limpias = draft.filter((d) => toCentimos(d.montoStr) > 0)
    onGuardar(limpias)
  }

  // Cerrar con Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCerrar()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCerrar])

  return (
    <div className="modal-overlay" onClick={onCerrar}>
      <div className="modal-box max-w-md" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between border-b border-app-border px-4 py-3">
          <h2 className="text-base font-semibold text-app-text">{titulo}</h2>
          <button onClick={onCerrar} className="btn-ghost h-7 w-7 !p-0 text-lg">
            ×
          </button>
        </div>

        {/* Mini-tabla */}
        <div className="max-h-[55vh] overflow-y-auto px-4 py-3">
          <div className="mb-1 grid grid-cols-[1fr_120px_32px] gap-2 px-1 text-xs font-medium uppercase tracking-wide text-app-muted">
            <span>Cliente / Descripción</span>
            <span className="text-right">Monto S/</span>
            <span></span>
          </div>

          <div className="flex flex-col gap-1.5">
            {draft.map((item, idx) => (
              <ValeRow
                key={item.id}
                item={item}
                autoFocus={item.id === focusId}
                onChange={(patch) => updateItem(item.id, patch)}
                onRemove={() => removeRow(item.id)}
                onEnter={idx === draft.length - 1 ? addRow : undefined}
              />
            ))}
          </div>

          <button onClick={addRow} className="btn-ghost mt-2 w-full border border-dashed border-app-border text-sm">
            + Agregar fila
          </button>
        </div>

        {/* Footer */}
        <div className="border-t border-app-border px-4 py-3">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-sm font-medium text-app-muted">Total {titulo}</span>
            <span className="text-xl font-bold text-success-text">{formatSoles(total)}</span>
          </div>
          <div className="flex gap-2">
            <button onClick={onCerrar} className="btn-ghost flex-1">
              Cancelar
            </button>
            <button onClick={handleGuardar} className="btn-success flex-[1.5]">
              Guardar
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

interface ValeRowProps {
  item: ValeItem
  autoFocus: boolean
  onChange: (patch: Partial<ValeItem>) => void
  onRemove: () => void
  onEnter?: () => void
}

function ValeRow({ item, autoFocus, onChange, onRemove, onEnter }: ValeRowProps) {
  const montoRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (autoFocus) montoRef.current?.focus()
  }, [autoFocus])

  return (
    <div className="grid grid-cols-[1fr_120px_32px] items-center gap-2">
      <input
        type="text"
        className="input"
        placeholder="Opcional"
        value={item.descripcion}
        onChange={(e) => onChange({ descripcion: e.target.value })}
      />
      <input
        ref={montoRef}
        type="number"
        inputMode="decimal"
        step="0.01"
        min="0"
        className="input-money"
        placeholder="0.00"
        value={item.montoStr}
        onChange={(e) => onChange({ montoStr: e.target.value })}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && onEnter) {
            e.preventDefault()
            onEnter()
          }
        }}
      />
      <button
        onClick={onRemove}
        className="flex h-7 w-7 items-center justify-center rounded text-danger-text transition-colors duration-200 hover:bg-danger"
        title="Eliminar fila"
      >
        ×
      </button>
    </div>
  )
}
