import { useState, useEffect, useMemo } from 'react'
import { supabase } from '@/lib/supabase'
import { formatSoles, toCentimos } from '@/lib/money'
import { hoyLocal } from '@/lib/date'
import { usePersistedState } from '@/lib/usePersistedState'
import type { EmpresaCliente, Turno, TipoCombustible } from '@/types'

// ─── Tipos ────────────────────────────────────────────────────────

interface RegistroRow {
  id: string
  fecha: string
  turno_id: number
  turno_nombre: string | null
  empresa_id: string | null
  empresa_nombre: string | null
  tipo_atencion: string
  tipo_documento: string
  serie: string | null
  numero: string | null
  conductor: string | null
  placa: string | null
  dni_conductor: string | null
  tipo_combustible: string
  cantidad_galones: number
  precio_unit_centimos: number
  importe_centimos: number
  empresa_facturacion: string | null
  factura_numero: string | null
  fecha_facturacion: string | null
  estado_pago: 'pagado' | 'pendiente'
  fecha_pago: string | null
}

interface PreciosDia {
  precio_db5_centimos: number
  precio_regular_centimos: number
  precio_premium_centimos: number
}

interface FormState {
  fecha: string
  empresa_id: string
  tipo_atencion: string
  tipo_documento: string
  serie: string
  numero: string
  turno_id: string
  conductor: string
  placa: string
  dni_conductor: string
  tipo_combustible: string
  cantidad_galones: string
  precio_unit: string
  estado_pago: 'pendiente' | 'pagado'
  factura_numero: string
  empresa_facturacion: string
  fecha_facturacion: string
  fecha_pago: string
}

type Tab = 'registros' | 'resumen'
type FiltroTipo = 'todos' | 'corporativo' | 'licitacion' | 'particular' | 'chevron'
type FiltroEstado = 'todos' | 'pendiente' | 'pagado'

const TIPOS_ATENCION = ['corporativo', 'licitacion', 'particular', 'chevron'] as const
const TIPOS_DOC = ['vale', 'factura', 'boleta', 'nota_credito'] as const

const TIPO_LABELS: Record<string, string> = {
  corporativo: 'Corporación',
  licitacion: 'Licitación',
  particular: 'Particular',
  chevron: 'Chevron',
}

const FORM_INIT: FormState = {
  fecha: '', empresa_id: '', tipo_atencion: 'corporativo', tipo_documento: 'vale',
  serie: '', numero: '', turno_id: '', conductor: '', placa: '', dni_conductor: '',
  tipo_combustible: '', cantidad_galones: '', precio_unit: '', estado_pago: 'pendiente',
  factura_numero: '', empresa_facturacion: '', fecha_facturacion: '', fecha_pago: '',
}

function getMes(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function getPrecioDelDia(precios: PreciosDia | undefined, codigo: string): number {
  if (!precios) return 0
  if (codigo === 'DB5') return precios.precio_db5_centimos
  if (codigo === 'REGULAR') return precios.precio_regular_centimos
  if (codigo === 'PREMIUM') return precios.precio_premium_centimos
  return 0
}

function tipoBadgeClass(tipo: string): string {
  switch (tipo) {
    case 'corporativo': return 'badge-primary'
    case 'licitacion':  return 'badge-accent'
    case 'chevron':     return 'badge-warning'
    default:            return 'badge'
  }
}

const fs = (v: number | null | undefined) => v != null ? formatSoles(v) : '—'

// ─── Componente principal ─────────────────────────────────────────

export default function CorporativoPage() {
  const [tab, setTab] = useState<Tab>('registros')
  // Filtros persistidos: se recuerdan al cambiar de módulo o recargar.
  const [mes, setMes] = usePersistedState('seguimiento.mes', getMes)
  const [filtroTipo, setFiltroTipo] = usePersistedState<FiltroTipo>('seguimiento.filtroTipo', 'todos')
  const [filtroEmpresa, setFiltroEmpresa] = usePersistedState('seguimiento.filtroEmpresa', '')
  const [filtroEstado, setFiltroEstado] = usePersistedState<FiltroEstado>('seguimiento.filtroEstado', 'todos')

  const [rows, setRows] = useState<RegistroRow[]>([])
  const [preciosMap, setPreciosMap] = useState<Record<string, PreciosDia>>({})
  const [loading, setLoading] = useState(false)

  const [empresas, setEmpresas] = useState<EmpresaCliente[]>([])
  const [turnos, setTurnos] = useState<Turno[]>([])
  const [combustibles, setCombustibles] = useState<TipoCombustible[]>([])

  const [showModal, setShowModal] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [form, setForm] = useState<FormState>({ ...FORM_INIT })
  const [saving, setSaving] = useState(false)
  const [deleteId, setDeleteId] = useState<string | null>(null)

  // Carga catálogos una vez
  useEffect(() => {
    Promise.all([
      supabase.from('empresas_clientes').select('*').eq('activo', true).order('nombre'),
      supabase.from('turnos').select('*').eq('activo', true).order('id'),
      supabase.from('tipos_combustible').select('*').eq('activo', true).order('nombre'),
    ]).then(([e, t, c]) => {
      setEmpresas(e.data ?? [])
      setTurnos(t.data ?? [])
      setCombustibles(c.data ?? [])
    })
  }, [])

  // Carga registros del mes seleccionado
  async function loadMes() {
    setLoading(true)
    const [y, m] = mes.split('-')
    const from = `${y}-${m}-01`
    const lastDay = new Date(+y, +m, 0).getDate()
    const to = `${y}-${m}-${String(lastDay).padStart(2, '0')}`

    try {
      const [regRes, precRes] = await Promise.all([
        supabase
          .from('registro_ventas')
          .select(
            'id, fecha, turno_id, empresa_id, tipo_atencion, tipo_documento, ' +
            'serie, numero, conductor, placa, dni_conductor, ' +
            'tipo_combustible, cantidad_galones, precio_unit_centimos, importe_centimos, ' +
            'empresa_facturacion, factura_numero, fecha_facturacion, estado_pago, fecha_pago, ' +
            'empresas_clientes(nombre), turnos(nombre)'
          )
          .gte('fecha', from).lte('fecha', to)
          .order('fecha', { ascending: false })
          .order('created_at', { ascending: false }),
        supabase
          .from('precios_diarios')
          .select('fecha, precio_db5_centimos, precio_regular_centimos, precio_premium_centimos')
          .gte('fecha', from).lte('fecha', to),
      ])

      setRows(
        ((Array.isArray(regRes.data) ? regRes.data : []) as Record<string, any>[]).map(r => ({
          ...r,
          empresa_nombre: (r.empresas_clientes as any)?.nombre ?? null,
          turno_nombre: (r.turnos as any)?.nombre ?? null,
        })) as RegistroRow[]
      )

      const pm: Record<string, PreciosDia> = {}
      for (const p of (Array.isArray(precRes.data) ? precRes.data : [])) pm[p.fecha] = p
      setPreciosMap(pm)
    } catch (err) {
      console.error('Error al cargar registros del mes:', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadMes() }, [mes]) // eslint-disable-line react-hooks/exhaustive-deps

  function calcVariacion(row: RegistroRow): number | null {
    const precioDelDia = getPrecioDelDia(preciosMap[row.fecha], row.tipo_combustible)
    if (!precioDelDia) return null
    return Math.round((precioDelDia - row.precio_unit_centimos) * row.cantidad_galones)
  }

  const rowsFiltradas = useMemo(() => rows.filter(r => {
    if (filtroTipo !== 'todos' && r.tipo_atencion !== filtroTipo) return false
    if (filtroEmpresa && r.empresa_id !== filtroEmpresa) return false
    if (filtroEstado !== 'todos' && r.estado_pago !== filtroEstado) return false
    return true
  }), [rows, filtroTipo, filtroEmpresa, filtroEstado])

  const totales = useMemo(() => {
    let galones = 0, importe = 0, pendiente = 0, variacion = 0, hasVar = false
    for (const r of rowsFiltradas) {
      galones += r.cantidad_galones
      importe += r.importe_centimos
      if (r.estado_pago === 'pendiente') pendiente += r.importe_centimos
      const v = getPrecioDelDia(preciosMap[r.fecha], r.tipo_combustible)
      if (v) {
        variacion += Math.round((v - r.precio_unit_centimos) * r.cantidad_galones)
        hasVar = true
      }
    }
    return { galones, importe, pendiente, variacion, hasVar }
  }, [rowsFiltradas, preciosMap])

  // Agrupado por empresa + tipo (para la tab Resumen)
  const resumenEmpresas = useMemo(() => {
    const map: Record<string, {
      nombre: string; tipo: string
      count: number; galones: number; importe: number; pendiente: number; pagado: number
    }> = {}
    for (const r of rows) {
      const key = `${r.empresa_id ?? '__none__'}__${r.tipo_atencion}`
      if (!map[key]) map[key] = {
        nombre: r.empresa_nombre ?? '(Sin empresa)',
        tipo: r.tipo_atencion,
        count: 0, galones: 0, importe: 0, pendiente: 0, pagado: 0,
      }
      map[key].count++
      map[key].galones += r.cantidad_galones
      map[key].importe += r.importe_centimos
      if (r.estado_pago === 'pendiente') map[key].pendiente += r.importe_centimos
      else map[key].pagado += r.importe_centimos
    }
    return Object.values(map).sort((a, b) => b.importe - a.importe)
  }, [rows])

  function openNew() {
    setForm({
      ...FORM_INIT,
      fecha: hoyLocal(),
      turno_id: turnos[0] ? String(turnos[0].id) : '',
      tipo_combustible: combustibles[0]?.codigo ?? '',
    })
    setEditId(null)
    setShowModal(true)
  }

  function openEdit(row: RegistroRow) {
    setForm({
      fecha: row.fecha,
      empresa_id: row.empresa_id ?? '',
      tipo_atencion: row.tipo_atencion,
      tipo_documento: row.tipo_documento,
      serie: row.serie ?? '',
      numero: row.numero ?? '',
      turno_id: String(row.turno_id),
      conductor: row.conductor ?? '',
      placa: row.placa ?? '',
      dni_conductor: row.dni_conductor ?? '',
      tipo_combustible: row.tipo_combustible,
      cantidad_galones: String(row.cantidad_galones),
      precio_unit: (row.precio_unit_centimos / 100).toFixed(2),
      estado_pago: row.estado_pago,
      factura_numero: row.factura_numero ?? '',
      empresa_facturacion: row.empresa_facturacion ?? '',
      fecha_facturacion: row.fecha_facturacion ?? '',
      fecha_pago: row.fecha_pago ?? '',
    })
    setEditId(row.id)
    setShowModal(true)
  }

  async function handleSave() {
    const galones = parseFloat(form.cantidad_galones) || 0
    if (!galones || !form.precio_unit || !form.tipo_combustible) return
    setSaving(true)
    const precioCentimos = toCentimos(form.precio_unit)
    const importeCentimos = Math.round(galones * precioCentimos)
    const body = {
      fecha: form.fecha,
      empresa_id: form.empresa_id || null,
      tipo_atencion: form.tipo_atencion,
      tipo_documento: form.tipo_documento,
      serie: form.serie.trim() || null,
      numero: form.numero.trim() || null,
      turno_id: parseInt(form.turno_id) || null,
      conductor: form.conductor.trim() || null,
      placa: form.placa.trim() || null,
      dni_conductor: form.dni_conductor.trim() || null,
      tipo_combustible: form.tipo_combustible,
      cantidad_galones: galones,
      precio_unit_centimos: precioCentimos,
      importe_centimos: importeCentimos,
      empresa_facturacion: form.empresa_facturacion.trim() || null,
      factura_numero: form.factura_numero.trim() || null,
      fecha_facturacion: form.fecha_facturacion || null,
      estado_pago: form.estado_pago,
      fecha_pago: form.fecha_pago || null,
    }
    if (editId === null) {
      await supabase.from('registro_ventas').insert(body)
    } else {
      await supabase.from('registro_ventas').update(body).eq('id', editId)
    }
    setSaving(false)
    setShowModal(false)
    loadMes()
  }

  async function togglePago(row: RegistroRow) {
    const nuevo = row.estado_pago === 'pagado' ? 'pendiente' : 'pagado'
    const upd: Record<string, string | null> = { estado_pago: nuevo }
    if (nuevo === 'pagado') upd.fecha_pago = hoyLocal()
    else upd.fecha_pago = null
    await supabase.from('registro_ventas').update(upd).eq('id', row.id)
    loadMes()
  }

  async function confirmDelete() {
    if (!deleteId) return
    await supabase.from('registro_ventas').delete().eq('id', deleteId)
    setDeleteId(null)
    loadMes()
  }

  const formImporte = useMemo(() => {
    const g = parseFloat(form.cantidad_galones) || 0
    return Math.round(g * toCentimos(form.precio_unit))
  }, [form.cantidad_galones, form.precio_unit])

  const canSave = !!(
    form.fecha && form.tipo_combustible &&
    parseFloat(form.cantidad_galones) > 0 && toCentimos(form.precio_unit) > 0
  )

  // ─── Render ───────────────────────────────────────────────────

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col overflow-hidden">

      {/* ── Barra superior ── */}
      <div className="border-b border-app-border bg-white px-4 py-2">
        <div className="flex flex-wrap items-center gap-2">

          {/* Tabs */}
          <div className="flex gap-1">
            {([['registros', 'Registros'], ['resumen', 'Por Empresa']] as [Tab, string][]).map(([k, l]) => (
              <button key={k} onClick={() => setTab(k)}
                className={`rounded px-2.5 py-1 text-xs transition-colors duration-150 ${
                  tab === k
                    ? 'bg-primary text-primary-text font-medium'
                    : 'text-app-muted hover:bg-app-border hover:text-app-text'
                }`}
              >{l}</button>
            ))}
          </div>

          <div className="mx-1 h-4 w-px bg-app-border" />

          <input
            type="month" value={mes}
            onChange={e => setMes(e.target.value)}
            className="input text-xs" style={{ width: 128 }}
          />

          {tab === 'registros' && (
            <>
              <select
                value={filtroTipo}
                onChange={e => setFiltroTipo(e.target.value as FiltroTipo)}
                className="input text-xs" style={{ width: 130 }}
              >
                <option value="todos">Todos los tipos</option>
                {TIPOS_ATENCION.map(t => (
                  <option key={t} value={t}>{TIPO_LABELS[t]}</option>
                ))}
              </select>

              <select
                value={filtroEmpresa}
                onChange={e => setFiltroEmpresa(e.target.value)}
                className="input text-xs" style={{ width: 170 }}
              >
                <option value="">Todas las empresas</option>
                {empresas.map(e => (
                  <option key={e.id} value={e.id}>{e.nombre}</option>
                ))}
              </select>

              <select
                value={filtroEstado}
                onChange={e => setFiltroEstado(e.target.value as FiltroEstado)}
                className="input text-xs" style={{ width: 110 }}
              >
                <option value="todos">Todos</option>
                <option value="pendiente">Pendiente</option>
                <option value="pagado">Pagado</option>
              </select>
            </>
          )}

          <button className="btn-primary ml-auto text-xs" onClick={openNew}>
            + Nuevo registro
          </button>
        </div>
      </div>

      {/* ── Contenido ── */}
      <div className="flex-1 overflow-auto">
        {loading ? (
          <p className="p-6 text-sm text-app-muted">Cargando…</p>
        ) : tab === 'registros' ? (
          <table className="table-excel">
            <thead>
              <tr>
                <th>FECHA</th>
                <th>EMPRESA</th>
                <th>TIPO</th>
                <th>DOC</th>
                <th>VALE / N°</th>
                <th>PLACA</th>
                <th>CONDUCTOR</th>
                <th>TURNO</th>
                <th>PRODUCTO</th>
                <th className="text-right">GALONES</th>
                <th className="text-right">PRECIO/GL</th>
                <th className="text-right">IMPORTE</th>
                <th className="text-right">VARIACIÓN</th>
                <th>FACTURA</th>
                <th>ESTADO</th>
                <th style={{ width: 84 }} />
              </tr>
            </thead>
            <tbody>
              {rowsFiltradas.map(row => {
                const variacion = calcVariacion(row)
                const valeNum = [row.serie, row.numero].filter(Boolean).join('-')
                return (
                  <tr key={row.id}>
                    <td className="font-mono text-xs">{row.fecha}</td>
                    <td>{row.empresa_nombre ?? <span className="text-app-muted">—</span>}</td>
                    <td>
                      <span className={`badge ${tipoBadgeClass(row.tipo_atencion)}`}>
                        {TIPO_LABELS[row.tipo_atencion] ?? row.tipo_atencion}
                      </span>
                    </td>
                    <td className="text-xs capitalize">{row.tipo_documento}</td>
                    <td className="font-mono text-xs">{valeNum || '—'}</td>
                    <td className="font-mono text-xs">{row.placa ?? '—'}</td>
                    <td className="text-xs">{row.conductor ?? '—'}</td>
                    <td className="text-xs">{row.turno_nombre ?? `T${row.turno_id}`}</td>
                    <td className="text-xs font-medium">{row.tipo_combustible}</td>
                    <td className="text-right font-mono text-xs">{row.cantidad_galones.toFixed(3)}</td>
                    <td className="text-right font-mono text-xs">{fs(row.precio_unit_centimos)}</td>
                    <td className="text-right font-mono text-xs font-medium">{fs(row.importe_centimos)}</td>
                    <td className={`text-right font-mono text-xs ${
                      variacion == null ? 'text-app-muted' : variacion !== 0 ? 'text-orange-600 font-medium' : 'text-app-muted'
                    }`}>
                      {variacion != null ? fs(variacion) : '—'}
                    </td>
                    <td className="font-mono text-xs">{row.factura_numero ?? '—'}</td>
                    <td>
                      <button
                        onClick={() => togglePago(row)}
                        className={`badge cursor-pointer transition-opacity hover:opacity-75 ${
                          row.estado_pago === 'pagado' ? 'badge-success' : 'badge-danger'
                        }`}
                      >
                        {row.estado_pago === 'pagado' ? 'Pagado' : 'Pendiente'}
                      </button>
                    </td>
                    <td>
                      <div className="flex gap-1">
                        <button className="btn-ghost text-xs" onClick={() => openEdit(row)}>
                          Editar
                        </button>
                        <button
                          className="btn-ghost text-xs text-danger-text"
                          onClick={() => setDeleteId(row.id)}
                        >
                          ✕
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}

              {rowsFiltradas.length === 0 && (
                <tr>
                  <td colSpan={16} className="py-10 text-center text-sm text-app-muted">
                    Sin registros para los filtros seleccionados
                  </td>
                </tr>
              )}
            </tbody>

            {rowsFiltradas.length > 0 && (
              <tfoot>
                <tr className="bg-slate-100 font-semibold">
                  <td colSpan={9} className="px-2 py-1 text-xs text-app-muted">
                    TOTALES — {rowsFiltradas.length} registros
                  </td>
                  <td className="px-2 py-1 text-right font-mono text-xs">{totales.galones.toFixed(3)}</td>
                  <td />
                  <td className="px-2 py-1 text-right font-mono text-xs">{fs(totales.importe)}</td>
                  <td className={`px-2 py-1 text-right font-mono text-xs ${
                    totales.hasVar && totales.variacion !== 0 ? 'text-orange-600' : 'text-app-muted'
                  }`}>
                    {totales.hasVar ? fs(totales.variacion) : '—'}
                  </td>
                  <td colSpan={3} />
                </tr>
                {totales.pendiente > 0 && (
                  <tr className="bg-red-50">
                    <td colSpan={11} className="px-2 py-1 text-xs font-medium text-danger-text">
                      PENDIENTE DE COBRO
                    </td>
                    <td className="px-2 py-1 text-right font-mono text-xs font-semibold text-danger-text">
                      {fs(totales.pendiente)}
                    </td>
                    <td colSpan={4} />
                  </tr>
                )}
              </tfoot>
            )}
          </table>

        ) : (
          /* ── Tab: Por Empresa ── */
          <div className="p-4">
            <table className="table-excel max-w-4xl">
              <thead>
                <tr>
                  <th>EMPRESA</th>
                  <th>TIPO</th>
                  <th className="text-right">REGISTROS</th>
                  <th className="text-right">GALONES</th>
                  <th className="text-right">IMPORTE TOTAL</th>
                  <th className="text-right">PENDIENTE</th>
                  <th className="text-right">PAGADO</th>
                </tr>
              </thead>
              <tbody>
                {resumenEmpresas.map((e, i) => (
                  <tr key={i}>
                    <td className="font-medium">{e.nombre}</td>
                    <td>
                      <span className={`badge ${tipoBadgeClass(e.tipo)}`}>
                        {TIPO_LABELS[e.tipo] ?? e.tipo}
                      </span>
                    </td>
                    <td className="text-right font-mono text-xs">{e.count}</td>
                    <td className="text-right font-mono text-xs">{e.galones.toFixed(3)}</td>
                    <td className="text-right font-mono text-xs font-medium">{fs(e.importe)}</td>
                    <td className={`text-right font-mono text-xs ${
                      e.pendiente > 0 ? 'font-semibold text-danger-text' : 'text-app-muted'
                    }`}>
                      {e.pendiente > 0 ? fs(e.pendiente) : '—'}
                    </td>
                    <td className={`text-right font-mono text-xs ${
                      e.pagado > 0 ? 'text-success-text' : 'text-app-muted'
                    }`}>
                      {e.pagado > 0 ? fs(e.pagado) : '—'}
                    </td>
                  </tr>
                ))}
                {resumenEmpresas.length === 0 && (
                  <tr>
                    <td colSpan={7} className="py-10 text-center text-sm text-app-muted">
                      Sin registros este mes
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Modal agregar / editar ── */}
      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div
            className="modal-box max-h-[90vh] max-w-2xl overflow-y-auto p-5"
            onClick={e => e.stopPropagation()}
          >
            <h3 className="mb-4 text-sm font-semibold">
              {editId === null ? 'Nuevo Registro' : 'Editar Registro'}
            </h3>

            <div className="space-y-3">
              {/* Fecha + Turno */}
              <div className="flex gap-2">
                <div className="flex-1">
                  <label className="mb-1 block text-xs text-app-muted">Fecha</label>
                  <input
                    type="date" className="input" value={form.fecha}
                    onChange={e => setForm(p => ({ ...p, fecha: e.target.value }))}
                  />
                </div>
                <div className="flex-1">
                  <label className="mb-1 block text-xs text-app-muted">Turno</label>
                  <select
                    className="input" value={form.turno_id}
                    onChange={e => setForm(p => ({ ...p, turno_id: e.target.value }))}
                  >
                    <option value="">— Sin turno —</option>
                    {turnos.map(t => (
                      <option key={t.id} value={t.id}>{t.nombre}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Empresa + Tipo */}
              <div className="flex gap-2">
                <div style={{ flex: 2 }}>
                  <label className="mb-1 block text-xs text-app-muted">Empresa cliente</label>
                  <select
                    className="input" value={form.empresa_id}
                    onChange={e => setForm(p => ({ ...p, empresa_id: e.target.value }))}
                  >
                    <option value="">— Sin empresa —</option>
                    {empresas.map(e => (
                      <option key={e.id} value={e.id}>{e.nombre}</option>
                    ))}
                  </select>
                </div>
                <div className="flex-1">
                  <label className="mb-1 block text-xs text-app-muted">Tipo de atención</label>
                  <select
                    className="input" value={form.tipo_atencion}
                    onChange={e => setForm(p => ({ ...p, tipo_atencion: e.target.value }))}
                  >
                    {TIPOS_ATENCION.map(t => (
                      <option key={t} value={t}>{TIPO_LABELS[t]}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Tipo doc + Serie + Número */}
              <div className="flex gap-2">
                <div className="flex-1">
                  <label className="mb-1 block text-xs text-app-muted">Tipo documento</label>
                  <select
                    className="input capitalize" value={form.tipo_documento}
                    onChange={e => setForm(p => ({ ...p, tipo_documento: e.target.value }))}
                  >
                    {TIPOS_DOC.map(t => (
                      <option key={t} value={t}>{t.replace('_', ' ')}</option>
                    ))}
                  </select>
                </div>
                <div className="flex-1">
                  <label className="mb-1 block text-xs text-app-muted">Serie</label>
                  <input
                    className="input font-mono" value={form.serie} placeholder="001"
                    onChange={e => setForm(p => ({ ...p, serie: e.target.value }))}
                  />
                </div>
                <div className="flex-1">
                  <label className="mb-1 block text-xs text-app-muted">Número</label>
                  <input
                    className="input font-mono" value={form.numero} placeholder="00001"
                    onChange={e => setForm(p => ({ ...p, numero: e.target.value }))}
                  />
                </div>
              </div>

              {/* Conductor + Placa + DNI */}
              <div className="flex gap-2">
                <div style={{ flex: 2 }}>
                  <label className="mb-1 block text-xs text-app-muted">Conductor</label>
                  <input
                    className="input" value={form.conductor}
                    onChange={e => setForm(p => ({ ...p, conductor: e.target.value }))}
                  />
                </div>
                <div className="flex-1">
                  <label className="mb-1 block text-xs text-app-muted">Placa</label>
                  <input
                    className="input font-mono uppercase" value={form.placa}
                    onChange={e => setForm(p => ({ ...p, placa: e.target.value.toUpperCase() }))}
                  />
                </div>
                <div className="flex-1">
                  <label className="mb-1 block text-xs text-app-muted">DNI conductor</label>
                  <input
                    className="input font-mono" value={form.dni_conductor} maxLength={8}
                    onChange={e => setForm(p => ({ ...p, dni_conductor: e.target.value }))}
                  />
                </div>
              </div>

              {/* Combustible + Galones + Precio + Importe */}
              <div className="flex gap-2">
                <div className="flex-1">
                  <label className="mb-1 block text-xs text-app-muted">Combustible</label>
                  <select
                    className="input" value={form.tipo_combustible}
                    onChange={e => setForm(p => ({ ...p, tipo_combustible: e.target.value }))}
                  >
                    <option value="">— —</option>
                    {combustibles.map(c => (
                      <option key={c.codigo} value={c.codigo}>{c.nombre}</option>
                    ))}
                  </select>
                </div>
                <div className="flex-1">
                  <label className="mb-1 block text-xs text-app-muted">Galones</label>
                  <input
                    className="input-money" type="number" min="0" step="0.001"
                    value={form.cantidad_galones}
                    onChange={e => setForm(p => ({ ...p, cantidad_galones: e.target.value }))}
                  />
                </div>
                <div className="flex-1">
                  <label className="mb-1 block text-xs text-app-muted">Precio / galón (S/)</label>
                  <input
                    className="input-money" type="number" min="0" step="0.01"
                    value={form.precio_unit}
                    onChange={e => setForm(p => ({ ...p, precio_unit: e.target.value }))}
                  />
                </div>
                <div className="flex-1">
                  <label className="mb-1 block text-xs text-app-muted">Importe</label>
                  <div className="input bg-slate-50 text-right font-mono text-sm font-semibold text-app-text">
                    {fs(formImporte)}
                  </div>
                </div>
              </div>

              {/* Factura + Empresa facturación + Fecha facturación */}
              <div className="flex gap-2">
                <div className="flex-1">
                  <label className="mb-1 block text-xs text-app-muted">N° Factura</label>
                  <input
                    className="input font-mono" value={form.factura_numero} placeholder="F001-000001"
                    onChange={e => setForm(p => ({ ...p, factura_numero: e.target.value }))}
                  />
                </div>
                <div className="flex-1">
                  <label className="mb-1 block text-xs text-app-muted">Empresa facturación</label>
                  <input
                    className="input" value={form.empresa_facturacion}
                    onChange={e => setForm(p => ({ ...p, empresa_facturacion: e.target.value }))}
                  />
                </div>
                <div className="flex-1">
                  <label className="mb-1 block text-xs text-app-muted">Fecha facturación</label>
                  <input
                    type="date" className="input" value={form.fecha_facturacion}
                    onChange={e => setForm(p => ({ ...p, fecha_facturacion: e.target.value }))}
                  />
                </div>
              </div>

              {/* Estado de pago + Fecha pago */}
              <div className="flex gap-2 items-end">
                <div className="flex-1">
                  <label className="mb-1 block text-xs text-app-muted">Estado de pago</label>
                  <div className="flex gap-2">
                    {(['pendiente', 'pagado'] as const).map(s => (
                      <button
                        key={s} type="button"
                        onClick={() => setForm(p => ({ ...p, estado_pago: s }))}
                        className={`flex-1 rounded border py-1 text-xs font-medium capitalize transition-colors ${
                          form.estado_pago === s
                            ? s === 'pagado'
                              ? 'border-success bg-success text-success-text'
                              : 'border-danger bg-danger text-danger-text'
                            : 'border-app-border text-app-muted hover:bg-app-border'
                        }`}
                      >{s}</button>
                    ))}
                  </div>
                </div>
                {form.estado_pago === 'pagado' && (
                  <div className="flex-1">
                    <label className="mb-1 block text-xs text-app-muted">Fecha de pago</label>
                    <input
                      type="date" className="input" value={form.fecha_pago}
                      onChange={e => setForm(p => ({ ...p, fecha_pago: e.target.value }))}
                    />
                  </div>
                )}
              </div>
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <button className="btn-ghost text-xs" onClick={() => setShowModal(false)}>
                Cancelar
              </button>
              <button
                className="btn-primary text-xs"
                onClick={handleSave}
                disabled={saving || !canSave}
              >
                {saving ? 'Guardando…' : 'Guardar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal confirmar eliminación ── */}
      {deleteId && (
        <div className="modal-overlay" onClick={() => setDeleteId(null)}>
          <div className="modal-box p-5" onClick={e => e.stopPropagation()}>
            <p className="mb-1 text-sm font-medium text-app-text">¿Eliminar este registro?</p>
            <p className="mb-4 text-xs text-app-muted">Esta acción no se puede deshacer.</p>
            <div className="flex justify-end gap-2">
              <button className="btn-ghost text-xs" onClick={() => setDeleteId(null)}>
                Cancelar
              </button>
              <button className="btn-danger text-xs" onClick={confirmDelete}>
                Eliminar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
