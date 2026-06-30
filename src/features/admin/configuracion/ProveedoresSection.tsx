import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import type { Proveedor } from '@/types'
import { SectionHeader, AcBadge, RowActions, Field, ModalActions, Loading, ModalBox } from './_helpers'

type Form = { nombre: string; contacto: string; telefono: string }
const INIT: Form = { nombre: '', contacto: '', telefono: '' }

export default function ProveedoresSection() {
  const [rows, setRows] = useState<Proveedor[]>([])
  const [loading, setLoading] = useState(true)
  const [show, setShow] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [form, setForm] = useState<Form>(INIT)
  const [saving, setSaving] = useState(false)

  async function load() {
    const { data } = await supabase.from('proveedores').select('*').order('nombre')
    setRows(data ?? [])
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  function openNew() { setForm(INIT); setEditId(null); setShow(true) }

  function openEdit(p: Proveedor) {
    setForm({ nombre: p.nombre, contacto: p.contacto ?? '', telefono: p.telefono ?? '' })
    setEditId(p.id)
    setShow(true)
  }

  async function save() {
    if (!form.nombre.trim()) return
    setSaving(true)
    const body = {
      nombre: form.nombre.trim(),
      contacto: form.contacto.trim() || null,
      telefono: form.telefono.trim() || null,
    }
    if (editId === null) await supabase.from('proveedores').insert({ ...body, activo: true })
    else await supabase.from('proveedores').update(body).eq('id', editId)
    setSaving(false); setShow(false); load()
  }

  async function toggle(p: Proveedor) {
    await supabase.from('proveedores').update({ activo: !p.activo }).eq('id', p.id)
    load()
  }

  return (
    <div className="max-w-2xl">
      <SectionHeader title="Proveedores de Combustible" onAdd={openNew} />
      {loading ? <Loading /> : (
        <table className="table-excel">
          <thead>
            <tr>
              <th>Nombre</th>
              <th>Contacto</th>
              <th style={{ width: 120 }}>Teléfono</th>
              <th style={{ width: 60 }}>Activo</th>
              <th style={{ width: 140 }} />
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.id} className={!p.activo ? 'opacity-40' : ''}>
                <td className="font-medium">{p.nombre}</td>
                <td>{p.contacto ?? '—'}</td>
                <td className="font-mono">{p.telefono ?? '—'}</td>
                <td><AcBadge v={p.activo} /></td>
                <td>
                  <RowActions
                    onEdit={() => openEdit(p)}
                    onToggle={() => toggle(p)}
                    activo={p.activo}
                  />
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="py-6 text-center text-app-muted">
                  Sin proveedores registrados — agrega el primero
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}

      {show && (
        <ModalBox onClose={() => setShow(false)}>
          <h3 className="mb-4 text-sm font-semibold">
            {editId === null ? 'Nuevo Proveedor' : 'Editar Proveedor'}
          </h3>
          <div className="space-y-3">
            <Field label="Nombre del proveedor">
              <input
                className="input"
                value={form.nombre}
                autoFocus
                onChange={(e) => setForm({ ...form, nombre: e.target.value })}
                placeholder="Ej: Primax, Petroperú…"
              />
            </Field>
            <Field label="Contacto">
              <input
                className="input"
                value={form.contacto}
                onChange={(e) => setForm({ ...form, contacto: e.target.value })}
                placeholder="Ejecutivo comercial o área"
              />
            </Field>
            <Field label="Teléfono">
              <input
                className="input font-mono"
                value={form.telefono}
                onChange={(e) => setForm({ ...form, telefono: e.target.value })}
                placeholder="Ej: 054-123456"
              />
            </Field>
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
