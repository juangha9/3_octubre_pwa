import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import type { AppConfig } from '@/types'
import { useAuth } from '@/features/auth/useAuth'
import { Field, ModalActions, Loading, ModalBox } from './_helpers'

const LABELS: Record<string, string> = {
  igv_porcentaje:         'IGV',
  moneda:                 'Moneda',
  nombre_grifo_display:   'Nombre Grifo',
  osinergmin_nombre_grifo:'Nombre Osinergmin',
}

export default function AppConfigSection() {
  const { role } = useAuth()
  const [rows, setRows] = useState<AppConfig[]>([])
  const [loading, setLoading] = useState(true)
  const [editRow, setEditRow] = useState<AppConfig | null>(null)
  const [valor, setValor] = useState('')
  const [saving, setSaving] = useState(false)

  async function load() {
    const { data } = await supabase.from('app_config').select('*').order('clave')
    setRows(data ?? [])
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  function openEdit(row: AppConfig) {
    setEditRow(row)
    setValor(row.valor)
  }

  async function save() {
    if (!editRow) return
    setSaving(true)
    await supabase.from('app_config').update({ valor: valor.trim() }).eq('clave', editRow.clave)
    setSaving(false)
    setEditRow(null)
    load()
  }

  const canEdit = role === 'admin_grifo' || role === 'superadmin'

  return (
    <div className="max-w-3xl">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-app-text">Configuración del Sistema</h2>
        {!canEdit && (
          <span className="badge-warning">Sin permiso de edición</span>
        )}
      </div>

      {loading ? <Loading /> : (
        <table className="table-excel w-full">
          <thead>
            <tr>
              <th style={{ width: 140 }}>Elemento</th>
              <th>Descripción</th>
              <th style={{ width: 1, whiteSpace: 'nowrap' }}>Valor actual</th>
              {canEdit && <th style={{ width: 64 }} />}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.clave}>
                <td className="font-medium">{LABELS[r.clave] ?? r.clave}</td>
                <td className="text-app-muted" style={{ maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {r.descripcion ?? '—'}
                </td>
                <td style={{ whiteSpace: 'nowrap' }} className="font-medium">{r.valor}</td>
                {canEdit && (
                  <td>
                    <button className="btn-ghost text-xs" onClick={() => openEdit(r)}>
                      Editar
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {editRow && (
        <ModalBox onClose={() => setEditRow(null)}>
          <h3 className="mb-1 text-sm font-semibold">
            Editar — {LABELS[editRow.clave] ?? editRow.clave}
          </h3>
          {editRow.descripcion && (
            <p className="mb-4 text-xs text-app-muted">{editRow.descripcion}</p>
          )}
          <Field label="Nuevo valor">
            <input
              className="input"
              value={valor}
              autoFocus
              onChange={(e) => setValor(e.target.value)}
            />
          </Field>
          <ModalActions
            onCancel={() => setEditRow(null)}
            onSave={save}
            saving={saving}
            disabled={!valor.trim()}
          />
        </ModalBox>
      )}
    </div>
  )
}
