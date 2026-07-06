import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import type { Tanque, TipoCombustible } from '@/types'
import { SectionHeader, AcBadge, RowActions, Field, ModalActions, Loading, ModalBox } from './_helpers'
import TanqueLayoutEditor from './TanqueLayoutEditor'
import TanqueAforoModal from './TanqueAforoModal'

type Form = { nombre: string; tipo_combustible_codigo: string; capacidad_galones: string }
const INIT: Form = { nombre: '', tipo_combustible_codigo: '', capacidad_galones: '' }

export default function TanquesSection() {
  const [rows, setRows] = useState<Tanque[]>([])
  const [tipos, setTipos] = useState<TipoCombustible[]>([])
  const [loading, setLoading] = useState(true)
  const [show, setShow] = useState(false)
  const [editId, setEditId] = useState<number | null>(null)
  const [form, setForm] = useState<Form>(INIT)
  const [saving, setSaving] = useState(false)
  const [aforoTanque, setAforoTanque] = useState<Tanque | null>(null)

  async function load() {
    const [{ data: t }, { data: tc }] = await Promise.all([
      supabase.from('tanques').select('*').order('id'),
      supabase.from('tipos_combustible').select('*').eq('activo', true).order('codigo'),
    ])
    setRows(t ?? [])
    setTipos(tc ?? [])
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  function openNew() {
    setForm({ ...INIT, tipo_combustible_codigo: tipos[0]?.codigo ?? '' })
    setEditId(null)
    setShow(true)
  }

  function openEdit(t: Tanque) {
    setForm({
      nombre: t.nombre,
      tipo_combustible_codigo: t.tipo_combustible_codigo,
      capacidad_galones: t.capacidad_galones?.toString() ?? '',
    })
    setEditId(t.id)
    setShow(true)
  }

  async function save() {
    if (!form.nombre.trim() || !form.tipo_combustible_codigo) return
    setSaving(true)
    const body = {
      nombre: form.nombre.trim(),
      tipo_combustible_codigo: form.tipo_combustible_codigo,
      capacidad_galones: form.capacidad_galones ? parseFloat(form.capacidad_galones) : null,
    }
    if (editId === null) await supabase.from('tanques').insert({ ...body, activo: true })
    else await supabase.from('tanques').update(body).eq('id', editId)
    setSaving(false); setShow(false); load()
  }

  async function toggle(t: Tanque) {
    await supabase.from('tanques').update({ activo: !t.activo }).eq('id', t.id)
    load()
  }

  const tipoNombre = (cod: string) => tipos.find((t) => t.codigo === cod)?.nombre ?? cod

  return (
    <div className="max-w-2xl">
      {!loading && rows.length > 0 && (
        <TanqueLayoutEditor tanques={rows} onChanged={load} />
      )}
      <SectionHeader title="Tanques" onAdd={openNew} />
      {loading ? <Loading /> : (
        <table className="table-excel">
          <thead>
            <tr>
              <th>Nombre</th>
              <th>Combustible</th>
              <th className="text-right" style={{ width: 100 }}>Cap. (gal)</th>
              <th style={{ width: 60 }}>Activo</th>
              <th style={{ width: 190 }} />
            </tr>
          </thead>
          <tbody>
            {rows.map((t) => (
              <tr key={t.id} className={!t.activo ? 'opacity-40' : ''}>
                <td className="font-medium">{t.nombre}</td>
                <td>{tipoNombre(t.tipo_combustible_codigo)}</td>
                <td className="text-right font-mono">
                  {t.capacidad_galones != null
                    ? t.capacidad_galones.toLocaleString('es-PE')
                    : '—'}
                </td>
                <td><AcBadge v={t.activo} /></td>
                <td>
                  <div className="flex gap-1">
                    <RowActions
                      onEdit={() => openEdit(t)}
                      onToggle={() => toggle(t)}
                      activo={t.activo}
                    />
                    <button className="btn-ghost text-xs" onClick={() => setAforoTanque(t)}>
                      Aforo
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {show && (
        <ModalBox onClose={() => setShow(false)}>
          <h3 className="mb-4 text-sm font-semibold">
            {editId === null ? 'Nuevo Tanque' : 'Editar Tanque'}
          </h3>
          <div className="space-y-3">
            <Field label="Nombre del tanque">
              <input
                className="input"
                value={form.nombre}
                autoFocus
                onChange={(e) => setForm({ ...form, nombre: e.target.value })}
                placeholder="Ej: Tanque 1 — Diesel"
              />
            </Field>
            <Field label="Tipo de Combustible">
              <select
                className="input"
                value={form.tipo_combustible_codigo}
                onChange={(e) => setForm({ ...form, tipo_combustible_codigo: e.target.value })}
              >
                <option value="">— Seleccionar —</option>
                {tipos.map((tc) => (
                  <option key={tc.codigo} value={tc.codigo}>{tc.nombre}</option>
                ))}
              </select>
            </Field>
            <Field label="Capacidad (galones)">
              <input
                type="number"
                min="0"
                step="1"
                className="input"
                value={form.capacidad_galones}
                onChange={(e) => setForm({ ...form, capacidad_galones: e.target.value })}
                placeholder="Ej: 5000"
              />
            </Field>
          </div>
          <ModalActions
            onCancel={() => setShow(false)}
            onSave={save}
            saving={saving}
            disabled={!form.nombre.trim() || !form.tipo_combustible_codigo}
          />
        </ModalBox>
      )}

      {aforoTanque && (
        <TanqueAforoModal tanque={aforoTanque} onClose={() => setAforoTanque(null)} />
      )}
    </div>
  )
}
