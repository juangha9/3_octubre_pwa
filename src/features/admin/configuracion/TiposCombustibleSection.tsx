import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import type { TipoCombustible } from '@/types'
import { SectionHeader, AcBadge, RowActions, Field, ModalActions, Loading, ModalBox } from './_helpers'

type Form = { codigo: string; nombre: string; nombre_osinergmin: string }
const INIT: Form = { codigo: '', nombre: '', nombre_osinergmin: '' }

export default function TiposCombustibleSection() {
  const [rows, setRows] = useState<TipoCombustible[]>([])
  const [loading, setLoading] = useState(true)
  const [show, setShow] = useState(false)
  const [editCodigo, setEditCodigo] = useState<string | null>(null)
  const [form, setForm] = useState<Form>(INIT)
  const [saving, setSaving] = useState(false)

  async function load() {
    const { data } = await supabase.from('tipos_combustible').select('*').order('codigo')
    setRows(data ?? [])
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  function openNew() { setForm(INIT); setEditCodigo(null); setShow(true) }

  function openEdit(t: TipoCombustible) {
    setForm({ codigo: t.codigo, nombre: t.nombre, nombre_osinergmin: t.nombre_osinergmin })
    setEditCodigo(t.codigo)
    setShow(true)
  }

  async function save() {
    const isValid = form.nombre.trim() && form.nombre_osinergmin.trim() &&
      (editCodigo !== null || form.codigo.trim())
    if (!isValid) return
    setSaving(true)
    if (editCodigo === null) {
      await supabase.from('tipos_combustible').insert({
        codigo: form.codigo.trim().toUpperCase(),
        nombre: form.nombre.trim(),
        nombre_osinergmin: form.nombre_osinergmin.trim(),
        activo: true,
      })
    } else {
      await supabase.from('tipos_combustible').update({
        nombre: form.nombre.trim(),
        nombre_osinergmin: form.nombre_osinergmin.trim(),
      }).eq('codigo', editCodigo)
    }
    setSaving(false); setShow(false); load()
  }

  async function toggle(t: TipoCombustible) {
    await supabase.from('tipos_combustible').update({ activo: !t.activo }).eq('codigo', t.codigo)
    load()
  }

  const isValid = form.nombre.trim() && form.nombre_osinergmin.trim() &&
    (editCodigo !== null || form.codigo.trim())

  return (
    <div className="max-w-3xl">
      <SectionHeader title="Tipos de Combustible" onAdd={openNew} />
      {loading ? <Loading /> : (
        <table className="table-excel">
          <thead>
            <tr>
              <th style={{ width: 90 }}>Código</th>
              <th>Nombre</th>
              <th>Nombre OSINERGMIN</th>
              <th style={{ width: 60 }}>Activo</th>
              <th style={{ width: 140 }} />
            </tr>
          </thead>
          <tbody>
            {rows.map((t) => (
              <tr key={t.codigo} className={!t.activo ? 'opacity-40' : ''}>
                <td className="font-mono font-semibold">{t.codigo}</td>
                <td>{t.nombre}</td>
                <td className="font-mono text-xs text-app-muted">{t.nombre_osinergmin}</td>
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
          <h3 className="mb-1 text-sm font-semibold">
            {editCodigo === null ? 'Nuevo Tipo de Combustible' : 'Editar Combustible'}
          </h3>
          {editCodigo === null && (
            <p className="mb-4 text-xs text-app-muted">El código no puede cambiarse después de crearlo.</p>
          )}
          <div className="mt-4 space-y-3">
            <Field label="Código (interno)">
              <input
                className="input font-mono uppercase"
                value={form.codigo}
                disabled={editCodigo !== null}
                autoFocus={editCodigo === null}
                onChange={(e) => setForm({ ...form, codigo: e.target.value })}
                placeholder="Ej: DB5"
              />
            </Field>
            <Field label="Nombre para mostrar">
              <input
                className="input"
                value={form.nombre}
                autoFocus={editCodigo !== null}
                onChange={(e) => setForm({ ...form, nombre: e.target.value })}
                placeholder="Ej: Diesel B5"
              />
            </Field>
            <Field label="Nombre OSINERGMIN (campo PRODUCTO del Excel)">
              <input
                className="input font-mono text-xs"
                value={form.nombre_osinergmin}
                onChange={(e) => setForm({ ...form, nombre_osinergmin: e.target.value })}
                placeholder="Ej: Diesel B5 S-50 UV"
              />
              <p className="mt-1 text-xs text-warning-text">
                Debe coincidir exactamente con el texto en la columna PRODUCTO del Excel OSINERGMIN.
              </p>
            </Field>
          </div>
          <ModalActions
            onCancel={() => setShow(false)}
            onSave={save}
            saving={saving}
            disabled={!isValid}
          />
        </ModalBox>
      )}
    </div>
  )
}
