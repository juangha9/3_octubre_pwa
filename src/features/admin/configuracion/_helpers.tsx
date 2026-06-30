import { type ReactNode } from 'react'

export function SectionHeader({ title, onAdd }: { title: string; onAdd: () => void }) {
  return (
    <div className="mb-3 flex items-center justify-between">
      <h2 className="text-sm font-semibold text-app-text">{title}</h2>
      <button className="btn-primary text-xs" onClick={onAdd}>+ Agregar</button>
    </div>
  )
}

export function AcBadge({ v }: { v: boolean }) {
  return <span className={v ? 'badge-success' : 'badge-danger'}>{v ? 'Sí' : 'No'}</span>
}

export function RowActions({
  onEdit,
  onToggle,
  activo,
}: {
  onEdit: () => void
  onToggle: () => void
  activo: boolean
}) {
  return (
    <div className="flex gap-1">
      <button className="btn-ghost text-xs" onClick={onEdit}>Editar</button>
      <button className="btn-ghost text-xs" onClick={onToggle}>
        {activo ? 'Desactivar' : 'Activar'}
      </button>
    </div>
  )
}

export function Field({
  label,
  children,
  className,
}: {
  label: string
  children: ReactNode
  className?: string
}) {
  return (
    <div className={className}>
      <label className="mb-1 block text-xs text-app-muted">{label}</label>
      {children}
    </div>
  )
}

export function ModalActions({
  onCancel,
  onSave,
  saving,
  disabled,
}: {
  onCancel: () => void
  onSave: () => void
  saving: boolean
  disabled?: boolean
}) {
  return (
    <div className="mt-4 flex justify-end gap-2">
      <button className="btn-ghost text-xs" onClick={onCancel}>Cancelar</button>
      <button
        className="btn-primary text-xs"
        onClick={onSave}
        disabled={saving || disabled}
      >
        {saving ? 'Guardando…' : 'Guardar'}
      </button>
    </div>
  )
}

export function Loading() {
  return <p className="py-4 text-sm text-app-muted">Cargando…</p>
}

export function ModalBox({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box p-5" onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  )
}
