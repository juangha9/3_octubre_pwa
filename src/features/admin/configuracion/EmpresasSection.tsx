import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import type { EmpresaCliente } from '@/types'
import { SectionHeader, AcBadge, RowActions, Field, ModalActions, Loading, ModalBox } from './_helpers'

type Form = { nombre: string; ruc: string; tipo: string; contacto: string }
// El VALOR debe coincidir con el check constraint de empresas_clientes.tipo
// ('corporativo', no 'corporacion'). La etiqueta es solo para mostrar.
const TIPOS: { value: string; label: string }[] = [
  { value: 'corporativo', label: 'Corporación' },
  { value: 'licitacion', label: 'Licitación' },
  { value: 'chevron', label: 'Chevron' },
  { value: 'particular', label: 'Particular' },
]
const TIPO_LABEL = (t: string) => TIPOS.find((x) => x.value === t)?.label ?? t
const INIT: Form = { nombre: '', ruc: '', tipo: 'corporativo', contacto: '' }

export default function EmpresasSection() {
  const [rows, setRows] = useState<EmpresaCliente[]>([])
  const [loading, setLoading] = useState(true)
  const [show, setShow] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [form, setForm] = useState<Form>(INIT)
  const [saving, setSaving] = useState(false)

  async function load() {
    const { data } = await supabase.from('empresas_clientes').select('*').order('nombre')
    setRows(data ?? [])
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  function openNew() { setForm(INIT); setEditId(null); setShow(true) }

  function openEdit(e: EmpresaCliente) {
    setForm({
      nombre: e.nombre,
      ruc: e.ruc ?? '',
      tipo: e.tipo,
      contacto: e.contacto ?? '',
    })
    setEditId(e.id)
    setShow(true)
  }

  async function save() {
    if (!form.nombre.trim()) return
    setSaving(true)
    const body = {
      nombre: form.nombre.trim(),
      ruc: form.ruc.trim() || null,
      tipo: form.tipo,
      contacto: form.contacto.trim() || null,
    }
    if (editId === null) await supabase.from('empresas_clientes').insert({ ...body, activo: true })
    else await supabase.from('empresas_clientes').update(body).eq('id', editId)
    setSaving(false); setShow(false); load()
  }

  async function toggle(e: EmpresaCliente) {
    await supabase.from('empresas_clientes').update({ activo: !e.activo }).eq('id', e.id)
    load()
  }

  return (
    <div className="max-w-3xl">
      <SectionHeader title="Empresas Clientes" onAdd={openNew} />
      {loading ? <Loading /> : (
        <table className="table-excel">
          <thead>
            <tr>
              <th>Nombre / Razón Social</th>
              <th style={{ width: 120 }}>RUC</th>
              <th style={{ width: 100 }}>Tipo</th>
              <th>Contacto</th>
              <th style={{ width: 60 }}>Activo</th>
              <th style={{ width: 140 }} />
            </tr>
          </thead>
          <tbody>
            {rows.map((e) => (
              <tr key={e.id} className={!e.activo ? 'opacity-40' : ''}>
                <td className="font-medium">{e.nombre}</td>
                <td className="font-mono text-xs">{e.ruc ?? '—'}</td>
                <td>
                  <span className="badge-primary">{TIPO_LABEL(e.tipo)}</span>
                </td>
                <td>{e.contacto ?? '—'}</td>
                <td><AcBadge v={e.activo} /></td>
                <td>
                  <RowActions
                    onEdit={() => openEdit(e)}
                    onToggle={() => toggle(e)}
                    activo={e.activo}
                  />
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="py-6 text-center text-app-muted">
                  Sin empresas registradas — agrega la primera
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}

      {show && (
        <ModalBox onClose={() => setShow(false)}>
          <h3 className="mb-4 text-sm font-semibold">
            {editId === null ? 'Nueva Empresa' : 'Editar Empresa'}
          </h3>
          <div className="space-y-3">
            <Field label="Nombre / Razón Social">
              <input
                className="input"
                value={form.nombre}
                autoFocus
                onChange={(e) => setForm({ ...form, nombre: e.target.value })}
                placeholder="Ej: Municipalidad de Arequipa"
              />
            </Field>
            <div className="flex gap-2">
              <Field label="RUC" className="flex-1">
                <input
                  className="input font-mono"
                  value={form.ruc}
                  onChange={(e) => setForm({ ...form, ruc: e.target.value })}
                  placeholder="20123456789"
                  maxLength={11}
                />
              </Field>
              <Field label="Tipo" className="flex-1">
                <select
                  className="input"
                  value={form.tipo}
                  onChange={(e) => setForm({ ...form, tipo: e.target.value })}
                >
                  {TIPOS.map((t) => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
              </Field>
            </div>
            <Field label="Contacto">
              <input
                className="input"
                value={form.contacto}
                onChange={(e) => setForm({ ...form, contacto: e.target.value })}
                placeholder="Nombre o teléfono del contacto"
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
