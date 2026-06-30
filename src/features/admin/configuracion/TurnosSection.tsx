import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import type { Turno } from '@/types'
import { SectionHeader, AcBadge, RowActions, Field, ModalActions, Loading, ModalBox } from './_helpers'

type Form = { nombre: string; hora_inicio: string; hora_fin: string }
const INIT: Form = { nombre: '', hora_inicio: '', hora_fin: '' }

export default function TurnosSection() {
  const [rows, setRows] = useState<Turno[]>([])
  const [loading, setLoading] = useState(true)
  const [show, setShow] = useState(false)
  const [editId, setEditId] = useState<number | null>(null)
  const [form, setForm] = useState<Form>(INIT)
  const [saving, setSaving] = useState(false)

  async function load() {
    const { data } = await supabase.from('turnos').select('*').order('id')
    setRows(data ?? [])
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  function openNew() { setForm(INIT); setEditId(null); setShow(true) }

  function openEdit(t: Turno) {
    setForm({
      nombre: t.nombre,
      hora_inicio: (t.hora_inicio ?? '').slice(0, 5),
      hora_fin: (t.hora_fin ?? '').slice(0, 5),
    })
    setEditId(t.id)
    setShow(true)
  }

  async function save() {
    if (!form.nombre.trim()) return
    setSaving(true)
    const body = {
      nombre: form.nombre.trim(),
      hora_inicio: form.hora_inicio || null,
      hora_fin: form.hora_fin || null,
    }
    if (editId === null) await supabase.from('turnos').insert({ ...body, activo: true })
    else await supabase.from('turnos').update(body).eq('id', editId)
    setSaving(false); setShow(false); load()
  }

  async function toggle(t: Turno) {
    await supabase.from('turnos').update({ activo: !t.activo }).eq('id', t.id)
    load()
  }

  return (
    <div className="max-w-2xl">
      <SectionHeader title="Turnos" onAdd={openNew} />
      {loading ? <Loading /> : (
        <table className="table-excel">
          <thead>
            <tr>
              <th>Nombre</th>
              <th style={{ width: 80 }}>Inicio</th>
              <th style={{ width: 80 }}>Fin</th>
              <th style={{ width: 60 }}>Activo</th>
              <th style={{ width: 140 }} />
            </tr>
          </thead>
          <tbody>
            {rows.map((t) => (
              <tr key={t.id} className={!t.activo ? 'opacity-40' : ''}>
                <td className="font-medium">{t.nombre}</td>
                <td className="font-mono">{t.hora_inicio ? t.hora_inicio.slice(0, 5) : '—'}</td>
                <td className="font-mono">{t.hora_fin ? t.hora_fin.slice(0, 5) : '—'}</td>
                <td><AcBadge v={t.activo} /></td>
                <td>
                  <RowActions
                    onEdit={() => openEdit(t)}
                    onToggle={() => toggle(t)}
                    activo={t.activo}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {show && (
        <ModalBox onClose={() => setShow(false)}>
          <h3 className="mb-4 text-sm font-semibold">
            {editId === null ? 'Nuevo Turno' : 'Editar Turno'}
          </h3>
          <div className="space-y-3">
            <Field label="Nombre">
              <input
                className="input"
                value={form.nombre}
                autoFocus
                onChange={(e) => setForm({ ...form, nombre: e.target.value })}
                placeholder="Ej: Mañana"
              />
            </Field>
            <div className="flex gap-2">
              <Field label="Hora inicio" className="flex-1">
                <input
                  type="time"
                  className="input"
                  value={form.hora_inicio}
                  onChange={(e) => setForm({ ...form, hora_inicio: e.target.value })}
                />
              </Field>
              <Field label="Hora fin" className="flex-1">
                <input
                  type="time"
                  className="input"
                  value={form.hora_fin}
                  onChange={(e) => setForm({ ...form, hora_fin: e.target.value })}
                />
              </Field>
            </div>
          </div>
          <ModalActions
            onCancel={() => setShow(false)}
            onSave={save}
            saving={saving}
            disabled={!form.nombre.trim()}
          />
        </ModalBox>
      )}
    </div>
  )
}
