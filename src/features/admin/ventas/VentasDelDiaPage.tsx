import { useState, useEffect, useCallback } from 'react'
import type { ChangeEvent } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/features/auth/useAuth'
import { hoyLocal } from '@/lib/date'
import { formatSoles, toCentimos } from '@/lib/money'
import type { Turno, EmpresaCliente, TipoCombustible } from '@/types'

// ─── Tipos locales ────────────────────────────────────────────────

interface CierreRow {
  id: string
  turno_id: number
  total_consola_centimos: number | null
  yape_centimos: number
  openpay_centimos: number
  corporacion_centimos: number
  licitaciones_centimos: number
  particulares_centimos: number
  chevron_centimos: number
  serafinado_centimos: number   // = PRUEBA (combustible devuelto al tanque)
  redondeo_centimos: number
  vales_total_centimos: number  // suma de cierre_vales
}

interface RegistroRow {
  id: string
  turno_id: number
  tipo_atencion: string
  empresa_nombre: string | null
  conductor: string | null
  placa: string | null
  serie: string | null
  numero: string | null
  dni_conductor: string | null
  tipo_combustible: string
  cantidad_galones: number
  precio_unit_centimos: number
  importe_centimos: number
}

interface NuevoReg {
  turno_id: string
  empresa_id: string
  tipo_atencion: string
  tipo_documento: string
  serie: string
  numero: string
  conductor: string
  placa: string
  dni_conductor: string
  tipo_combustible: string
  cantidad_galones: string
}

type Modo = 'abreviado' | 'completo'

const NUEVO_VACIO: NuevoReg = {
  turno_id: '',
  empresa_id: '',
  tipo_atencion: 'particular',
  tipo_documento: 'vale',
  serie: '',
  numero: '',
  conductor: '',
  placa: '',
  dni_conductor: '',
  tipo_combustible: '',
  cantidad_galones: '',
}

// ─── Helpers ──────────────────────────────────────────────────────

function calcEfectivoFinal(c: CierreRow): number {
  const creditos =
    c.corporacion_centimos + c.licitaciones_centimos +
    c.particulares_centimos + c.chevron_centimos
  return (
    (c.total_consola_centimos ?? 0) -
    c.yape_centimos -
    c.openpay_centimos -
    c.vales_total_centimos -
    creditos -
    c.serafinado_centimos +
    c.redondeo_centimos
  )
}

const fs = (v: number) => formatSoles(v)

// ─── Componente principal ─────────────────────────────────────────

export default function VentasDelDiaPage() {
  const { profile } = useAuth()

  const [fecha, setFecha] = useState(hoyLocal())
  const [modo, setModo] = useState<Modo>('abreviado')

  // Datos de referencia (cargan una vez)
  const [turnos, setTurnos] = useState<Turno[]>([])
  const [empresas, setEmpresas] = useState<EmpresaCliente[]>([])
  const [combustibles, setCombustibles] = useState<TipoCombustible[]>([])

  // Datos del día
  const [cierresMap, setCierresMap] = useState<Record<number, CierreRow>>({})
  const [precios, setPrecios] = useState({ db5: '', regular: '', premium: '' })
  const [precioId, setPrecioId] = useState<string | null>(null)
  const [registros, setRegistros] = useState<RegistroRow[]>([])

  // Flags
  const [loadingDia, setLoadingDia] = useState(false)
  const [savingPrecios, setSavingPrecios] = useState(false)
  const [savingReg, setSavingReg] = useState(false)
  const [confirmReinicio, setConfirmReinicio] = useState(false)

  // Formulario nuevo registro
  const [nuevo, setNuevo] = useState<NuevoReg>({ ...NUEVO_VACIO })

  // ── Carga de referencia (una vez) ────────────────────────────
  useEffect(() => {
    Promise.all([
      supabase.from('turnos').select('*').eq('activo', true).order('id'),
      supabase.from('empresas_clientes').select('*').eq('activo', true).order('nombre'),
      supabase.from('tipos_combustible').select('*').eq('activo', true).order('nombre'),
    ]).then(([t, e, c]) => {
      const ts = t.data ?? []
      setTurnos(ts)
      setEmpresas(e.data ?? [])
      setCombustibles(c.data ?? [])
      if (ts.length > 0) {
        setNuevo(prev => ({ ...prev, turno_id: String(ts[0].id) }))
      }
    })
  }, [])

  // ── Carga de datos del día ────────────────────────────────────
  const loadDia = useCallback(async () => {
    setLoadingDia(true)

    const [cierresRes, preciosRes, regRes] = await Promise.all([
      supabase
        .from('cierres_caja')
        .select(
          'id, turno_id, total_consola_centimos, yape_centimos, openpay_centimos, ' +
          'corporacion_centimos, licitaciones_centimos, particulares_centimos, ' +
          'chevron_centimos, serafinado_centimos, redondeo_centimos, ' +
          'cierre_vales(monto_centimos)'
        )
        .eq('fecha', fecha),
      supabase.from('precios_diarios').select('*').eq('fecha', fecha).maybeSingle(),
      supabase
        .from('registro_ventas')
        .select(
          'id, turno_id, tipo_atencion, empresa_id, conductor, placa, serie, numero, ' +
          'dni_conductor, tipo_combustible, cantidad_galones, precio_unit_centimos, ' +
          'importe_centimos, empresas_clientes(nombre)'
        )
        .eq('fecha', fecha)
        .order('created_at'),
    ])

    // Armar mapa turno_id → CierreRow
    const map: Record<number, CierreRow> = {}
    for (const raw of (cierresRes.data ?? [])) {
      const vales = (raw.cierre_vales as { monto_centimos: number }[]) ?? []
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { cierre_vales: _cv, ...rest } = raw as typeof raw & { cierre_vales: unknown }
      map[raw.turno_id] = {
        ...(rest as Omit<CierreRow, 'vales_total_centimos'>),
        vales_total_centimos: vales.reduce((s, v) => s + v.monto_centimos, 0),
      }
    }
    setCierresMap(map)

    // Precios del día
    const pd = preciosRes.data
    if (pd) {
      setPrecioId(pd.id)
      setPrecios({
        db5: (pd.precio_db5_centimos / 100).toFixed(2),
        regular: (pd.precio_regular_centimos / 100).toFixed(2),
        premium: (pd.precio_premium_centimos / 100).toFixed(2),
      })
    } else {
      setPrecioId(null)
      setPrecios({ db5: '', regular: '', premium: '' })
    }

    // Registros de ventas
    setRegistros(
      ((regRes.data ?? []) as Record<string, unknown>[]).map(r => ({
        ...(r as unknown as RegistroRow),
        empresa_nombre: (r.empresas_clientes as { nombre: string } | null)?.nombre ?? null,
      }))
    )

    setLoadingDia(false)
  }, [fecha])

  useEffect(() => { loadDia() }, [loadDia])

  // ── Guardar precios (al salir del campo) ──────────────────────
  async function savePrecios() {
    const db5 = toCentimos(precios.db5)
    const regular = toCentimos(precios.regular)
    const premium = toCentimos(precios.premium)
    if (!db5 && !regular && !premium) return
    setSavingPrecios(true)
    const payload = {
      fecha,
      precio_db5_centimos: db5,
      precio_regular_centimos: regular,
      precio_premium_centimos: premium,
      registrado_por: profile?.id,
    }
    if (precioId) {
      await supabase.from('precios_diarios').update(payload).eq('id', precioId)
    } else {
      const { data } = await supabase
        .from('precios_diarios').insert(payload).select('id').single()
      if (data) setPrecioId(data.id)
    }
    setSavingPrecios(false)
  }

  // ── Precio diario por código de combustible ───────────────────
  function precioDiario(codigo: string): number {
    if (codigo === 'DB5') return toCentimos(precios.db5)
    if (codigo === 'REGULAR') return toCentimos(precios.regular)
    if (codigo === 'PREMIUM') return toCentimos(precios.premium)
    return 0
  }

  // ── Guardar nuevo registro ────────────────────────────────────
  async function saveRegistro() {
    const galones = parseFloat(nuevo.cantidad_galones)
    if (!nuevo.tipo_combustible || !(galones > 0) || !profile) return
    setSavingReg(true)
    const precioUnit = precioDiario(nuevo.tipo_combustible)
    await supabase.from('registro_ventas').insert({
      fecha,
      turno_id: parseInt(nuevo.turno_id),
      colaborador_id: profile.id,
      empresa_id: nuevo.empresa_id || null,
      tipo_atencion: nuevo.tipo_atencion,
      tipo_documento: nuevo.tipo_documento,
      serie: nuevo.serie || null,
      numero: nuevo.numero || null,
      conductor: nuevo.conductor || null,
      placa: nuevo.placa || null,
      dni_conductor: nuevo.dni_conductor || null,
      tipo_combustible: nuevo.tipo_combustible,
      cantidad_galones: galones,
      precio_unit_centimos: precioUnit,
      importe_centimos: Math.round(galones * precioUnit),
    })
    // Limpiar campos pero mantener turno, tipo y combustible para entrada rápida
    setNuevo(p => ({
      ...NUEVO_VACIO,
      turno_id: p.turno_id,
      tipo_atencion: p.tipo_atencion,
      tipo_combustible: p.tipo_combustible,
    }))
    setSavingReg(false)
    loadDia()
  }

  // ── Render ────────────────────────────────────────────────────
  return (
    <div className="flex h-full flex-col overflow-hidden">

      {/* ── Toolbar ─────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-3 border-b border-app-border bg-white px-4 py-2 shadow-sm">

        {/* Fecha */}
        <input
          type="date"
          className="input w-36 text-sm"
          value={fecha}
          onChange={e => setFecha(e.target.value)}
        />

        {/* Precios combustible */}
        <div className="flex items-center gap-2 rounded border border-app-border bg-slate-50 px-2.5 py-1">
          {([
            { k: 'db5'     as const, label: 'DIESEL'   },
            { k: 'regular' as const, label: 'REGULAR'  },
            { k: 'premium' as const, label: 'PREMIUM'  },
          ] as const).map(({ k, label }) => (
            <label key={k} className="flex items-center gap-1">
              <span className="text-xs font-semibold text-app-muted">{label}:</span>
              <input
                type="number"
                step="0.01"
                min="0"
                className="input w-20 text-right font-mono text-xs"
                placeholder="0.00"
                value={precios[k]}
                onChange={e => setPrecios(p => ({ ...p, [k]: e.target.value }))}
                onBlur={savePrecios}
              />
            </label>
          ))}
          {savingPrecios && (
            <span className="animate-pulse text-xs text-app-muted">guardando…</span>
          )}
        </div>

        {/* Modo ABREVIADO / COMPLETO / BASE DATOS */}
        <div className="ml-auto flex overflow-hidden rounded border border-app-border">
          {([
            ['abreviado', 'ABREVIADO'],
            ['completo',  'COMPLETO' ],
          ] as [Modo, string][]).map(([m, label]) => (
            <button
              key={m}
              onClick={() => setModo(m)}
              className={`px-3 py-1.5 text-xs font-semibold transition-colors ${
                modo === m
                  ? 'bg-primary text-primary-text'
                  : 'bg-white text-app-muted hover:bg-slate-50'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Reiniciar día */}
        {!confirmReinicio ? (
          <button className="btn-danger text-xs" onClick={() => setConfirmReinicio(true)}>
            REINICIAR DÍA
          </button>
        ) : (
          <div className="flex items-center gap-1.5 rounded border border-red-300 bg-red-50 px-2.5 py-1">
            <span className="text-xs font-medium text-red-700">¿Borrar registros del día?</span>
            <button
              className="btn-danger py-0.5 px-2 text-xs"
              onClick={() => { /* TODO: lógica de reinicio */ setConfirmReinicio(false) }}
            >
              Sí
            </button>
            <button
              className="btn-ghost py-0.5 px-2 text-xs"
              onClick={() => setConfirmReinicio(false)}
            >
              No
            </button>
          </div>
        )}
      </div>

      {/* ── Contenido ───────────────────────────────────────── */}
      <div className="flex-1 space-y-4 overflow-auto p-4">
        {loadingDia ? (
          <div className="flex items-center justify-center py-16">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          </div>
        ) : (
          <>
            {/* ── Tabla de turnos ── */}
            <div className="overflow-x-auto rounded border border-app-border bg-white">
              <table className="table-excel">
                <thead>
                  <tr>
                    <th style={{ width: 56 }}>TURNO</th>
                    <th style={{ width: 112 }}>TOTAL CONSOLA</th>
                    <th style={{ width: 96 }}>YAPE</th>
                    <th style={{ width: 96 }}>OPEN PAY</th>
                    <th style={{ width: 108 }}>DSCTOS VALES</th>
                    {modo === 'abreviado' ? (
                      <th style={{ width: 118, background: '#fef9c3' }}>TOTAL CRÉDITOS</th>
                    ) : (
                      <>
                        <th style={{ width: 108, background: '#f1f5f9' }}>CORPORACIÓN</th>
                        <th style={{ width: 110, background: '#f1f5f9' }}>LICITACIONES</th>
                        <th style={{ width: 108, background: '#f1f5f9' }}>PARTICULARES</th>
                        <th style={{ width: 90,  background: '#f1f5f9' }}>CHEVRON</th>
                      </>
                    )}
                    <th style={{ width: 80 }}>PRUEBA</th>
                    <th style={{ width: 116 }}>REDONDEO X EF.</th>
                    <th style={{ width: 116 }}>EFECTIVO FINAL</th>
                  </tr>
                </thead>
                <tbody>
                  {turnos.map((t, idx) => {
                    const c = cierresMap[t.id]
                    const creditos = c
                      ? c.corporacion_centimos + c.licitaciones_centimos +
                        c.particulares_centimos + c.chevron_centimos
                      : 0
                    const efectivo = c ? calcEfectivoFinal(c) : 0

                    return (
                      <tr key={t.id}>
                        <td className="text-center text-sm font-bold text-primary-text">
                          {idx + 1}
                        </td>
                        <td className="text-right font-mono text-xs">
                          {c ? fs(c.total_consola_centimos ?? 0) : ''}
                        </td>
                        <td className="text-right font-mono text-xs">
                          {c ? fs(c.yape_centimos) : ''}
                        </td>
                        <td className="text-right font-mono text-xs">
                          {c ? fs(c.openpay_centimos) : ''}
                        </td>
                        <td className="text-right font-mono text-xs">
                          {c ? fs(c.vales_total_centimos) : ''}
                        </td>

                        {modo === 'abreviado' ? (
                          <td
                            className="text-right font-mono text-xs font-semibold"
                            style={{ background: '#fef9c3' }}
                          >
                            {fs(creditos)}
                          </td>
                        ) : (
                          <>
                            <td className="text-right font-mono text-xs" style={{ background: '#f1f5f9' }}>
                              {fs(c?.corporacion_centimos ?? 0)}
                            </td>
                            <td className="text-right font-mono text-xs" style={{ background: '#f1f5f9' }}>
                              {fs(c?.licitaciones_centimos ?? 0)}
                            </td>
                            <td className="text-right font-mono text-xs" style={{ background: '#f1f5f9' }}>
                              {fs(c?.particulares_centimos ?? 0)}
                            </td>
                            <td className="text-right font-mono text-xs" style={{ background: '#f1f5f9' }}>
                              {fs(c?.chevron_centimos ?? 0)}
                            </td>
                          </>
                        )}

                        <td className="text-right font-mono text-xs">
                          {c ? fs(c.serafinado_centimos) : ''}
                        </td>
                        <td className="text-right font-mono text-xs">
                          {c ? fs(c.redondeo_centimos) : ''}
                        </td>
                        <td className="text-right font-mono text-xs font-semibold">
                          {fs(efectivo)}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {/* ── Tabla de registros (modo COMPLETO) ── */}
            {modo === 'completo' && (
              <div className="overflow-x-auto rounded border border-app-border bg-white">
                <table className="table-excel">
                  <thead>
                    <tr>
                      <th style={{ width: 86 }}>FECHA</th>
                      <th style={{ width: 150 }}>CLIENTE</th>
                      <th style={{ width: 72 }}>VALE</th>
                      <th style={{ width: 80 }}>PLACA</th>
                      <th style={{ width: 64 }}>TICKET</th>
                      <th style={{ width: 120 }}>CONDUCTOR</th>
                      <th style={{ width: 84 }}>DNI</th>
                      <th style={{ width: 58 }}>TURNO</th>
                      <th style={{ width: 82 }}>PRODUCTO</th>
                      <th style={{ width: 76 }}>GALONES</th>
                      <th style={{ width: 108 }}>PRECIO TOTAL</th>
                      <th style={{ width: 100, background: '#fff7ed', color: '#ea580c' }}>
                        VARIACIÓN
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {/* Fila de entrada */}
                    <FilaEntrada
                      fecha={fecha}
                      turnos={turnos}
                      empresas={empresas}
                      combustibles={combustibles}
                      value={nuevo}
                      onChange={setNuevo}
                      onSave={saveRegistro}
                      saving={savingReg}
                      precioDiario={precioDiario}
                    />

                    {/* Registros existentes */}
                    {registros.map(r => {
                      const precioRef = precioDiario(r.tipo_combustible)
                      const variacion = Math.round(
                        (precioRef - r.precio_unit_centimos) * r.cantidad_galones
                      )
                      return (
                        <tr key={r.id}>
                          <td className="text-xs">{fecha}</td>
                          <td className="text-xs" style={{ maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {r.empresa_nombre ?? '—'}
                          </td>
                          <td className="text-xs">{r.numero ?? '—'}</td>
                          <td className="text-xs">{r.placa ?? '—'}</td>
                          <td className="text-xs">{r.serie ?? '—'}</td>
                          <td className="text-xs">{r.conductor ?? '—'}</td>
                          <td className="text-xs">{r.dni_conductor ?? '—'}</td>
                          <td className="text-center text-xs">{r.turno_id}</td>
                          <td className="text-xs font-medium">{r.tipo_combustible}</td>
                          <td className="text-right font-mono text-xs">
                            {r.cantidad_galones.toFixed(3)}
                          </td>
                          <td className="text-right font-mono text-xs">{fs(r.importe_centimos)}</td>
                          <td
                            className="text-right font-mono text-xs font-semibold"
                            style={{
                              background: '#fff7ed',
                              color: variacion > 0 ? '#16a34a' : variacion < 0 ? '#dc2626' : '#ea580c',
                            }}
                          >
                            {fs(Math.abs(variacion))}
                          </td>
                        </tr>
                      )
                    })}

                    {registros.length === 0 && (
                      <tr>
                        <td colSpan={12} className="py-4 text-center text-xs text-app-muted">
                          No hay registros para esta fecha
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}

          </>
        )}
      </div>
    </div>
  )
}

// ─── Fila de entrada para nuevo registro ─────────────────────────

interface FilaEntradaProps {
  fecha: string
  turnos: Turno[]
  empresas: EmpresaCliente[]
  combustibles: TipoCombustible[]
  value: NuevoReg
  onChange: (v: NuevoReg) => void
  onSave: () => void
  saving: boolean
  precioDiario: (codigo: string) => number
}

function FilaEntrada({
  fecha, turnos, empresas, combustibles,
  value, onChange, onSave, saving, precioDiario,
}: FilaEntradaProps) {
  function set(k: keyof NuevoReg) {
    return (e: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
      const next = { ...value, [k]: e.target.value }
      // Al seleccionar empresa, derivar tipo_atencion automáticamente
      if (k === 'empresa_id' && e.target.value) {
        const emp = empresas.find(x => x.id === e.target.value)
        if (emp) next.tipo_atencion = emp.tipo
      }
      onChange(next)
    }
  }

  const galones = parseFloat(value.cantidad_galones) || 0
  const precioUnit = precioDiario(value.tipo_combustible)
  const importe = Math.round(galones * precioUnit)
  const canSave = !!value.tipo_combustible && galones > 0 && !saving

  const inp = 'input py-0 h-6 text-xs'

  return (
    <tr style={{ background: '#eff6ff' }}>
      <td className="text-xs text-app-muted">{fecha}</td>

      {/* CLIENTE */}
      <td>
        <select className={`${inp} w-full`} value={value.empresa_id} onChange={set('empresa_id')}>
          <option value="">Buscar…</option>
          {empresas.map(e => (
            <option key={e.id} value={e.id}>{e.nombre}</option>
          ))}
        </select>
      </td>

      {/* VALE */}
      <td>
        <input
          className={`${inp} w-full`}
          placeholder="Nº vale"
          value={value.numero}
          onChange={set('numero')}
        />
      </td>

      {/* PLACA */}
      <td>
        <input
          className={`${inp} w-full`}
          placeholder="Placa"
          value={value.placa}
          onChange={set('placa')}
          style={{ textTransform: 'uppercase' }}
        />
      </td>

      {/* TICKET (serie) */}
      <td>
        <input
          className={`${inp} w-full`}
          placeholder="Serie"
          value={value.serie}
          onChange={set('serie')}
        />
      </td>

      {/* CONDUCTOR */}
      <td>
        <input
          className={`${inp} w-full`}
          placeholder="Conductor"
          value={value.conductor}
          onChange={set('conductor')}
        />
      </td>

      {/* DNI */}
      <td>
        <input
          className={`${inp} w-full`}
          placeholder="DNI"
          value={value.dni_conductor}
          onChange={set('dni_conductor')}
          maxLength={8}
        />
      </td>

      {/* TURNO */}
      <td>
        <select className={`${inp} w-full`} value={value.turno_id} onChange={set('turno_id')}>
          {turnos.map((t, i) => (
            <option key={t.id} value={String(t.id)}>{i + 1}</option>
          ))}
        </select>
      </td>

      {/* PRODUCTO */}
      <td>
        <select className={`${inp} w-full`} value={value.tipo_combustible} onChange={set('tipo_combustible')}>
          <option value="">—</option>
          {combustibles.map(c => (
            <option key={c.codigo} value={c.codigo}>{c.codigo}</option>
          ))}
        </select>
      </td>

      {/* GALONES */}
      <td>
        <input
          type="number"
          step="0.001"
          min="0"
          className={`${inp} w-full text-right font-mono`}
          placeholder="0.000"
          value={value.cantidad_galones}
          onChange={set('cantidad_galones')}
          onKeyDown={e => { if (e.key === 'Enter' && canSave) onSave() }}
        />
      </td>

      {/* PRECIO TOTAL (calculado) */}
      <td className="text-right font-mono text-xs font-medium text-primary-text">
        {importe > 0 ? fs(importe) : '—'}
      </td>

      {/* VARIACIÓN → botón Agregar */}
      <td style={{ background: '#fff7ed' }}>
        <button
          className="btn-primary h-6 w-full py-0 text-xs"
          disabled={!canSave}
          onClick={onSave}
        >
          {saving ? '…' : '+ Agregar'}
        </button>
      </td>
    </tr>
  )
}
