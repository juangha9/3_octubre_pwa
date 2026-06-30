import { useState, useEffect, useCallback, useMemo, Fragment } from 'react'
import type { ChangeEvent } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/features/auth/useAuth'
import { hoyLocal } from '@/lib/date'
import { formatSoles, toCentimos, sumCentimos } from '@/lib/money'
import type { Turno, EmpresaCliente, TipoCombustible } from '@/types'

// ─── Tipos Locales ────────────────────────────────────────────────

interface CierreRow {
  id: string
  turno_id: number
  total_consola_centimos: number | null
  yape_centimos: number
  openpay_centimos: number
  deposito_transferencia_centimos: number
  corporacion_centimos: number
  licitaciones_centimos: number
  particulares_centimos: number
  chevron_centimos: number
  serafinado_centimos: number   // = PRUEBA (combustible devuelto al tanque)
  redondeo_centimos: number
  contaminacion_centimos: number
  entregado_grifero_centimos: number | null
  contabilizado_admin_centimos: number | null
  colaborador_id: string
  vales_total_centimos: number  // suma de cierre_vales
}

interface RegistroRow {
  id: string
  turno_id: number
  tipo_atencion: string
  empresa_id: string | null
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

// Para la tabla editable de turnos
interface ShiftInputs {
  total_consola: string
  yape: string
  openpay: string
  deposito: string
  serafinado: string
  redondeo: string
  entregado_grifero: string
  contabilizado_admin: string
  colaborador_id: string
}

// Para el historial mensual
interface CierreRowCalculated {
  id: string
  turno_id: number
  fecha: string
  colaborador_nombre: string
  total_consola_centimos: number
  yape_centimos: number
  openpay_centimos: number
  deposito_transferencia_centimos: number
  vales_total_centimos: number
  corporacion_centimos: number
  licitaciones_centimos: number
  particulares_centimos: number
  chevron_centimos: number
  serafinado_centimos: number
  contaminacion_centimos: number
  redondeo_centimos: number
  entregado_grifero_centimos: number | null
  contabilizado_admin_centimos: number | null
  efectivo_final_centimos: number
  faltante_sobrante_centimos: number | null
}

interface EditRowState {
  empresa_id: string
  numero: string
  placa: string
  serie: string
  conductor: string
  dni_conductor: string
  turno_id: string
  tipo_combustible: string
  cantidad_galones: string
  importe: string
}

type Tab = 'registro' | 'historial'
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

function calcEfectivoFinal(
  c: CierreRow,
  creditos: { corporacion: number; licitaciones: number; particulares: number; chevron: number }
): number {
  const totalCreditos = creditos.corporacion + creditos.licitaciones + creditos.particulares + creditos.chevron
  return (
    (c.total_consola_centimos ?? 0) -
    c.yape_centimos -
    c.openpay_centimos -
    c.deposito_transferencia_centimos -
    c.vales_total_centimos -
    totalCreditos -
    c.serafinado_centimos +
    c.redondeo_centimos
  )
}

const fs = (v: number | null | undefined) => (v != null ? formatSoles(v) : '—')

export default function VentasPage() {
  const { profile } = useAuth()

  // Control de vista
  const [activeTab, setActiveTab] = useState<Tab>('registro')
  const [modo, setModo] = useState<Modo>('abreviado')

  // ─── ESTADO: REGISTRO DIARIO ────────────────────────────────────
  const [fecha, setFecha] = useState(hoyLocal())
  const [cierresMap, setCierresMap] = useState<Record<number, CierreRow>>({})
  const [precios, setPrecios] = useState({ db5: '', regular: '', premium: '' })
  const [precioId, setPrecioId] = useState<string | null>(null)
  const [registros, setRegistros] = useState<RegistroRow[]>([])
  const [loadingDia, setLoadingDia] = useState(false)
  const [savingPrecios, setSavingPrecios] = useState(false)
  const [savingReg, setSavingReg] = useState(false)
  const [confirmReinicio, setConfirmReinicio] = useState(false)
  const [nuevo, setNuevo] = useState<NuevoReg>({ ...NUEVO_VACIO })

  // Inputs editables de los turnos
  const [inputsMap, setInputsMap] = useState<Record<number, ShiftInputs>>({})

  // Registro rápido de créditos (Abreviado)
  const [quickTurno, setQuickTurno] = useState('1')
  const [quickMonto, setQuickMonto] = useState('')
  const [savingQuick, setSavingQuick] = useState(false)

  // Edición en línea para registros (Completo)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState<EditRowState | null>(null)

  // Catálogos de referencia
  const [turnos, setTurnos] = useState<Turno[]>([])
  const [empresas, setEmpresas] = useState<EmpresaCliente[]>([])
  const [combustibles, setCombustibles] = useState<TipoCombustible[]>([])
  const [colaboradores, setColaboradores] = useState<{ id: string; nombre: string }[]>([])

  // ─── ESTADO: HISTORIAL MENSUAL ──────────────────────────────────
  const [selectedMonth, setSelectedMonth] = useState(() => {
    const d = new Date()
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    return `${y}-${m}`
  })
  const [loadingHistorial, setLoadingHistorial] = useState(false)
  const [cierresHistorial, setCierresHistorial] = useState<CierreRowCalculated[]>([])

  // ── Carga de referencias (una vez) ────────────────────────────
  useEffect(() => {
    Promise.all([
      supabase.from('turnos').select('*').eq('activo', true).order('id'),
      supabase.from('empresas_clientes').select('*').eq('activo', true).order('nombre'),
      supabase.from('tipos_combustible').select('*').eq('activo', true).order('nombre'),
      supabase.from('profiles').select('id, nombre').eq('activo', true).order('nombre'),
    ]).then(([t, e, c, p]) => {
      const ts = t.data ?? []
      setTurnos(ts)
      setEmpresas(e.data ?? [])
      setCombustibles(c.data ?? [])
      setColaboradores(p.data ?? [])
      if (ts.length > 0) {
        setNuevo(prev => ({ ...prev, turno_id: String(ts[0].id) }))
      }
    })
  }, [])

  // ── Carga de datos del día (Registro Diario) ──────────────────
  const loadDia = useCallback(async () => {
    setLoadingDia(true)
    const [cierresRes, preciosRes, regRes] = await Promise.all([
      supabase
        .from('cierres_caja')
        .select(
          'id, turno_id, total_consola_centimos, yape_centimos, openpay_centimos, ' +
          'deposito_transferencia_centimos, corporacion_centimos, licitaciones_centimos, ' +
          'particulares_centimos, chevron_centimos, serafinado_centimos, redondeo_centimos, ' +
          'contaminacion_centimos, entregado_grifero_centimos, contabilizado_admin_centimos, ' +
          'colaborador_id, cierre_vales(monto_centimos)'
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
    const dbCierres = cierresRes.data ?? []
    for (const raw of dbCierres) {
      const vales = (raw.cierre_vales as { monto_centimos: number }[]) ?? []
      const { cierre_vales: _cv, ...rest } = raw as any
      map[raw.turno_id] = {
        ...rest,
        vales_total_centimos: vales.reduce((s, v) => s + v.monto_centimos, 0),
      }
    }
    setCierresMap(map)

    // Inicializar inputs editables locales
    const newInputsMap: Record<number, ShiftInputs> = {}
    const activeTurnos = turnos.length > 0 ? turnos : [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }] as any[]
    for (const t of activeTurnos) {
      const c = map[t.id]
      newInputsMap[t.id] = {
        total_consola: c?.total_consola_centimos != null ? (c.total_consola_centimos / 100).toFixed(2) : '',
        yape: c ? (c.yape_centimos / 100).toFixed(2) : '0.00',
        openpay: c ? (c.openpay_centimos / 100).toFixed(2) : '0.00',
        deposito: c ? (c.deposito_transferencia_centimos / 100).toFixed(2) : '0.00',
        serafinado: c ? (c.serafinado_centimos / 100).toFixed(2) : '0.00',
        redondeo: c ? (c.redondeo_centimos / 100).toFixed(2) : '0.00',
        entregado_grifero: c?.entregado_grifero_centimos != null ? (c.entregado_grifero_centimos / 100).toFixed(2) : '',
        contabilizado_admin: c?.contabilizado_admin_centimos != null ? (c.contabilizado_admin_centimos / 100).toFixed(2) : '',
        colaborador_id: c?.colaborador_id ?? '',
      }
    }
    setInputsMap(newInputsMap)

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
      ((regRes.data ?? []) as Record<string, any>[]).map(r => ({
        ...r,
        empresa_nombre: r.empresas_clientes?.nombre ?? null,
      })) as any
    )
    setLoadingDia(false)
  }, [fecha, turnos])

  useEffect(() => {
    if (activeTab === 'registro') {
      loadDia()
    }
  }, [fecha, activeTab, loadDia])

  // ── Carga de datos del mes (Historial) ────────────────────────
  const loadHistorial = useCallback(async () => {
    setLoadingHistorial(true)
    const year = parseInt(selectedMonth.substring(0, 4))
    const month = parseInt(selectedMonth.substring(5, 7))
    const lastDay = new Date(year, month, 0).getDate()
    const startDate = `${selectedMonth}-01`
    const endDate = `${selectedMonth}-${String(lastDay).padStart(2, '0')}`

    try {
      const { data, error } = await supabase
        .from('cierres_caja')
        .select(`
          id,
          turno_id,
          fecha,
          total_consola_centimos,
          yape_centimos,
          openpay_centimos,
          deposito_transferencia_centimos,
          corporacion_centimos,
          licitaciones_centimos,
          particulares_centimos,
          chevron_centimos,
          serafinado_centimos,
          contaminacion_centimos,
          redondeo_centimos,
          entregado_grifero_centimos,
          contabilizado_admin_centimos,
          colaborador_id,
          profiles:colaborador_id ( nombre ),
          cierre_vales ( monto_centimos )
        `)
        .gte('fecha', startDate)
        .lte('fecha', endDate)
        .order('fecha', { ascending: true })
        .order('turno_id', { ascending: true })

      if (error) throw error

      const calculated: CierreRowCalculated[] = (data as any[] || []).map((raw) => {
        const totalConsola = raw.total_consola_centimos ?? 0
        const valesTotal = raw.cierre_vales?.reduce((sum: number, v: any) => sum + v.monto_centimos, 0) ?? 0
        const creditos =
          raw.corporacion_centimos +
          raw.licitaciones_centimos +
          raw.particulares_centimos +
          raw.chevron_centimos

        const efectivoFinal =
          totalConsola -
          raw.yape_centimos -
          raw.openpay_centimos -
          raw.deposito_transferencia_centimos -
          valesTotal -
          creditos -
          raw.serafinado_centimos +
          raw.redondeo_centimos

        const refDinero =
          raw.contabilizado_admin_centimos !== null
            ? raw.contabilizado_admin_centimos
            : raw.entregado_grifero_centimos !== null
            ? raw.entregado_grifero_centimos
            : null

        const faltanteSobrante = refDinero !== null ? refDinero - efectivoFinal : null

        return {
          id: raw.id,
          turno_id: raw.turno_id,
          fecha: raw.fecha,
          colaborador_nombre: raw.profiles?.nombre ?? '—',
          total_consola_centimos: totalConsola,
          yape_centimos: raw.yape_centimos,
          openpay_centimos: raw.openpay_centimos,
          deposito_transferencia_centimos: raw.deposito_transferencia_centimos,
          vales_total_centimos: valesTotal,
          corporacion_centimos: raw.corporacion_centimos,
          licitaciones_centimos: raw.licitaciones_centimos,
          particulares_centimos: raw.particulares_centimos,
          chevron_centimos: raw.chevron_centimos,
          serafinado_centimos: raw.serafinado_centimos,
          contaminacion_centimos: raw.contaminacion_centimos,
          redondeo_centimos: raw.redondeo_centimos,
          entregado_grifero_centimos: raw.entregado_grifero_centimos,
          contabilizado_admin_centimos: raw.contabilizado_admin_centimos,
          efectivo_final_centimos: efectivoFinal,
          faltante_sobrante_centimos: faltanteSobrante,
        }
      })

      setCierresHistorial(calculated)
    } catch (err) {
      console.error('Error al cargar historial:', err)
    } finally {
      setLoadingHistorial(false)
    }
  }, [selectedMonth])

  useEffect(() => {
    if (activeTab === 'historial') {
      loadHistorial()
    }
  }, [selectedMonth, activeTab, loadHistorial])

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

  // ── Guardar Cambios en la Tabla de Turnos (Control de Ventas) ──
  const handleInputChange = (turnoId: number, field: keyof ShiftInputs, val: string) => {
    setInputsMap(prev => ({
      ...prev,
      [turnoId]: {
        ...prev[turnoId],
        [field]: val
      }
    }))
  }

  const handleShiftInputBlur = async (turnoId: number, changedField?: keyof ShiftInputs) => {
    const inputs = inputsMap[turnoId]
    if (!inputs) return

    const totalConsola = inputs.total_consola === '' ? null : toCentimos(inputs.total_consola)
    const yape = toCentimos(inputs.yape)
    const openpay = toCentimos(inputs.openpay)
    const deposito = toCentimos(inputs.deposito)
    const serafinado = toCentimos(inputs.serafinado)
    const redondeo = toCentimos(inputs.redondeo)
    const entregado = inputs.entregado_grifero === '' ? null : toCentimos(inputs.entregado_grifero)
    const contabilizado = inputs.contabilizado_admin === '' ? null : toCentimos(inputs.contabilizado_admin)
    
    // Asignar colaborador por defecto si está vacío
    let colaboradorId = inputs.colaborador_id
    if (!colaboradorId && colaboradores.length > 0) {
      colaboradorId = colaboradores[0].id
    }
    if (!colaboradorId && profile) {
      colaboradorId = profile.id
    }

    if (!colaboradorId) return

    const payload = {
      fecha,
      turno_id: turnoId,
      colaborador_id: colaboradorId,
      total_consola_centimos: totalConsola,
      yape_centimos: yape,
      openpay_centimos: openpay,
      deposito_transferencia_centimos: deposito,
      serafinado_centimos: serafinado,
      redondeo_centimos: redondeo,
      entregado_grifero_centimos: entregado,
      contabilizado_admin_centimos: contabilizado,
    }

    const existingCierre = cierresMap[turnoId]
    try {
      if (existingCierre) {
        await supabase.from('cierres_caja').update(payload).eq('id', existingCierre.id)
      } else {
        await supabase.from('cierres_caja').insert(payload)
      }
      loadDia()
    } catch (err) {
      console.error('Error al guardar turno:', err)
    }
  }

  // ── Guardar nuevo registro de venta corporativa (Completo) ────
  async function saveRegistro() {
    const galones = parseFloat(nuevo.cantidad_galones)
    if (!nuevo.tipo_combustible || !(galones > 0) || !profile) return
    setSavingReg(true)
    const precioUnit = precioDiario(nuevo.tipo_combustible)

    try {
      const { error } = await supabase.from('registro_ventas').insert({
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
      if (error) throw error

      setNuevo(p => ({
        ...NUEVO_VACIO,
        turno_id: p.turno_id,
        tipo_atencion: p.tipo_atencion,
        tipo_combustible: p.tipo_combustible,
      }))
      loadDia()
    } catch (err) {
      alert('Error al agregar el registro de venta: ' + (err as any).message)
    } finally {
      setSavingReg(false)
    }
  }

  // ── Registro Rápido de Créditos (Abreviado) ───────────────────
  async function handleQuickRegister() {
    const monto = parseFloat(quickMonto)
    if (!(monto > 0) || !profile) return
    setSavingQuick(true)

    try {
      // Registrar un crédito rápido de tipo 'particular'
      const { error } = await supabase.from('registro_ventas').insert({
        fecha,
        turno_id: parseInt(quickTurno),
        colaborador_id: profile.id,
        tipo_documento: 'vale',
        tipo_atencion: 'particular',
        tipo_combustible: 'REGULAR', // default
        cantidad_galones: 0, // 0 indica registro rápido/parcial
        precio_unit_centimos: 0,
        importe_centimos: toCentimos(monto),
        empresa_id: null,
      })
      if (error) throw error

      setQuickMonto('')
      loadDia()
    } catch (err) {
      alert('Error al registrar crédito rápido: ' + (err as any).message)
    } finally {
      setSavingQuick(false)
    }
  }

  // ── Iniciar edición de una fila de venta (Completo) ────────────
  const startEdit = (r: RegistroRow) => {
    setEditingId(r.id)
    setEditForm({
      empresa_id: r.empresa_id ?? '',
      numero: r.numero ?? '',
      placa: r.placa ?? '',
      serie: r.serie ?? '',
      conductor: r.conductor ?? '',
      dni_conductor: r.dni_conductor ?? '',
      turno_id: String(r.turno_id),
      tipo_combustible: r.tipo_combustible,
      cantidad_galones: String(r.cantidad_galones),
      importe: (r.importe_centimos / 100).toFixed(2),
    })
  }

  // ── Guardar edición de una fila de venta (Completo) ────────────
  const saveEdit = async (id: string) => {
    if (!editForm) return
    const galones = parseFloat(editForm.cantidad_galones) || 0
    let precioUnit = precioDiario(editForm.tipo_combustible)
    
    // Si es un registro rápido modificado, recalcular importe
    let importeCentimos = 0
    if (galones === 0) {
      importeCentimos = toCentimos(editForm.importe)
      precioUnit = 0
    } else {
      importeCentimos = Math.round(galones * precioUnit)
    }

    const emp = empresas.find(x => x.id === editForm.empresa_id)
    const tipoAtencion = emp ? emp.tipo : 'particular'

    try {
      const { error } = await supabase
        .from('registro_ventas')
        .update({
          turno_id: parseInt(editForm.turno_id),
          empresa_id: editForm.empresa_id || null,
          tipo_atencion: tipoAtencion,
          numero: editForm.numero || null,
          placa: editForm.placa || null,
          serie: editForm.serie || null,
          conductor: editForm.conductor || null,
          dni_conductor: editForm.dni_conductor || null,
          tipo_combustible: editForm.tipo_combustible,
          cantidad_galones: galones,
          precio_unit_centimos: precioUnit,
          importe_centimos: importeCentimos,
        })
        .eq('id', id)

      if (error) throw error

      setEditingId(null)
      setEditForm(null)
      loadDia()
    } catch (err) {
      alert('Error al guardar cambios: ' + (err as any).message)
    }
  }

  // ── Borrar registro de venta ──────────────────────────────────
  async function deleteRegistro(id: string) {
    if (!confirm('¿Seguro que desea eliminar este registro?')) return
    await supabase.from('registro_ventas').delete().eq('id', id)
    loadDia()
  }

  // ── Reiniciar día ─────────────────────────────────────────────
  async function handleReinicio() {
    setConfirmReinicio(false)
    setLoadingDia(true)
    try {
      await supabase.from('registro_ventas').delete().eq('fecha', fecha)
      if (precioId) {
        await supabase.from('precios_diarios').delete().eq('id', precioId)
      }
      await supabase.from('cierres_caja').delete().eq('fecha', fecha)
      await loadDia()
    } catch (err) {
      console.error('Error al reiniciar el día:', err)
    } finally {
      setLoadingDia(false)
    }
  }

  // ── CÁLCULO REACTIVO: Créditos por turno (desde registros) ────
  const creditosPorTurno = useMemo(() => {
    const map: Record<number, { corporacion: number; licitaciones: number; particulares: number; chevron: number }> = {}
    const activeTurnos = turnos.length > 0 ? turnos : [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }] as any[]
    for (const t of activeTurnos) {
      const regs = registros.filter(r => r.turno_id === t.id)
      map[t.id] = {
        corporacion: regs.filter(r => r.tipo_atencion === 'corporativo').reduce((sum, r) => sum + r.importe_centimos, 0),
        licitaciones: regs.filter(r => r.tipo_atencion === 'licitacion').reduce((sum, r) => sum + r.importe_centimos, 0),
        particulares: regs.filter(r => r.tipo_atencion === 'particular').reduce((sum, r) => sum + r.importe_centimos, 0),
        chevron: regs.filter(r => r.tipo_atencion === 'chevron').reduce((sum, r) => sum + r.importe_centimos, 0),
      }
    }
    return map
  }, [registros, turnos])

  // Filtrar registros rápidos (cantidad_galones === 0) para el modo Abreviado
  const registrosRapidos = useMemo(() => {
    return registros.filter(r => r.cantidad_galones === 0)
  }, [registros])

  // LÓGICA DE HISTORIAL: Agrupar por fecha
  const groupedTestData = useMemo(() => {
    const groups: Record<string, CierreRowCalculated[]> = {}
    for (const c of cierresHistorial) {
      if (!groups[c.fecha]) {
        groups[c.fecha] = []
      }
      groups[c.fecha].push(c)
    }
    return groups
  }, [cierresHistorial])

  const nombreMes = useMemo(() => {
    const [_, m] = selectedMonth.split('-')
    const meses = [
      'ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO',
      'JULIO', 'AGOSTO', 'SETIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE'
    ]
    const idx = parseInt(m, 10) - 1
    return meses[idx] || 'TOTAL'
  }, [selectedMonth])

  const totalMensual = useMemo(() => {
    const sum = (key: keyof CierreRowCalculated) =>
      cierresHistorial.reduce((acc, c) => acc + (Number(c[key]) || 0), 0)

    const sumNullables = (key: 'entregado_grifero_centimos' | 'contabilizado_admin_centimos' | 'faltante_sobrante_centimos') =>
      cierresHistorial.reduce((acc, c) => acc + (c[key] ?? 0), 0)

    return {
      total_consola: sum('total_consola_centimos'),
      yape: sum('yape_centimos'),
      openpay: sum('openpay_centimos'),
      deposito: sum('deposito_transferencia_centimos'),
      vales: sum('vales_total_centimos'),
      corporacion: sum('corporacion_centimos'),
      licitaciones: sum('licitaciones_centimos'),
      particulares: sum('particulares_centimos'),
      chevron: sum('chevron_centimos'),
      serafinado: sum('serafinado_centimos'),
      contaminacion: sum('contaminacion_centimos'),
      redondeo: sum('redondeo_centimos'),
      efectivo_final: sum('efectivo_final_centimos'),
      entregado_grifero: sumNullables('entregado_grifero_centimos'),
      contabilizado_admin: sumNullables('contabilizado_admin_centimos'),
      faltante_sobrante: sumNullables('faltante_sobrante_centimos'),
    }
  }, [cierresHistorial])

  // Formateador especial para diferencia (con color rojo/verde)
  const renderDiferencia = (v: number | null) => {
    if (v === null) return <td className="text-right font-mono text-xs text-app-muted">—</td>
    if (v > 0) return <td className="text-right font-mono text-xs font-semibold text-green-600">+{formatSoles(v)}</td>
    if (v < 0) return <td className="text-right font-mono text-xs font-semibold text-red-600">-{formatSoles(Math.abs(v))}</td>
    return <td className="text-right font-mono text-xs text-app-muted">S/ 0.00</td>
  }

  return (
    <div className="flex h-full flex-col overflow-hidden bg-slate-50">
      
      {/* ── Top Header & Tab Selector ───────────────────────────── */}
      <div className="bg-white border-b border-app-border px-4 py-2 shadow-sm">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <h1 className="text-lg font-bold text-slate-800">Control de Ventas</h1>
            
            {/* Tabs */}
            <div className="flex rounded-md bg-slate-100 p-0.5 border border-slate-200">
              <button
                onClick={() => setActiveTab('registro')}
                className={`rounded-md px-3 py-1 text-xs font-medium transition-all ${
                  activeTab === 'registro'
                    ? 'bg-white text-slate-800 shadow-sm'
                    : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                📝 Registro Diario
              </button>
              <button
                onClick={() => setActiveTab('historial')}
                className={`rounded-md px-3 py-1 text-xs font-medium transition-all ${
                  activeTab === 'historial'
                    ? 'bg-white text-slate-800 shadow-sm'
                    : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                📊 Historial Mensual
              </button>
            </div>
          </div>

          {/* Toggle Abreviado/Completo */}
          <div className="flex items-center gap-3">
            <div className="flex overflow-hidden rounded border border-app-border bg-white">
              {([
                ['abreviado', 'ABREVIADO'],
                ['completo', 'COMPLETO'],
              ] as [Modo, string][]).map(([m, label]) => (
                <button
                  key={m}
                  onClick={() => setModo(m)}
                  className={`px-2.5 py-1 text-[11px] font-bold transition-colors ${
                    modo === m
                      ? 'bg-primary text-primary-text'
                      : 'bg-white text-app-muted hover:bg-slate-50'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ── Sub-Toolbar Dinámica ───────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-3 border-b border-app-border bg-white px-4 py-2">
        {activeTab === 'registro' ? (
          <>
            <input
              type="date"
              className="input w-36 text-sm"
              value={fecha}
              onChange={e => setFecha(e.target.value)}
            />

            {/* Precios Combustible */}
            <div className="flex items-center gap-2 rounded border border-app-border bg-slate-50 px-2.5 py-1">
              {([
                { k: 'db5' as const, label: 'DIESEL' },
                { k: 'regular' as const, label: 'REGULAR' },
                { k: 'premium' as const, label: 'PREMIUM' },
              ] as const).map(({ k, label }) => (
                <label key={k} className="flex items-center gap-1">
                  <span className="text-[10px] font-bold text-app-muted">{label}:</span>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    className="input w-16 text-right font-mono text-xs py-0.5 h-6"
                    placeholder="0.00"
                    value={precios[k]}
                    onChange={e => setPrecios(p => ({ ...p, [k]: e.target.value }))}
                    onBlur={savePrecios}
                  />
                </label>
              ))}
              {savingPrecios && (
                <span className="animate-pulse text-[10px] text-app-muted">guardando…</span>
              )}
            </div>

            {/* Reiniciar Día */}
            <div className="ml-auto">
              {!confirmReinicio ? (
                <button className="btn-danger text-xs py-1 px-2" onClick={() => setConfirmReinicio(true)}>
                  REINICIAR DÍA
                </button>
              ) : (
                <div className="flex items-center gap-1.5 rounded border border-red-300 bg-red-50 px-2 py-0.5">
                  <span className="text-[11px] font-semibold text-red-700">¿Borrar registros de esta fecha?</span>
                  <button
                    className="btn bg-red-600 hover:bg-red-700 text-white py-0.5 px-2 text-[10px]"
                    onClick={handleReinicio}
                  >
                    Sí, borrar
                  </button>
                  <button
                    className="btn-ghost py-0.5 px-2 text-[10px]"
                    onClick={() => setConfirmReinicio(false)}
                  >
                    No
                  </button>
                </div>
              )}
            </div>
          </>
        ) : (
          <>
            <input
              type="month"
              className="input w-44 text-sm"
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
            />
            <button
              onClick={() => window.print()}
              className="btn bg-slate-800 text-white hover:bg-slate-700 text-xs py-1 px-3 ml-auto"
            >
              🖨️ Imprimir Reporte
            </button>
          </>
        )}
      </div>

      {/* ── Contenido Principal ─────────────────────────────────── */}
      <div className="flex-1 overflow-auto p-4">
        
        {/* === VISTA: REGISTRO DIARIO === */}
        {activeTab === 'registro' && (
          <div className="space-y-6">
            {loadingDia ? (
              <div className="flex items-center justify-center py-16">
                <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
              </div>
            ) : (
              <>
                {/* Tabla de Turnos (Totalmente Editable) */}
                <div className="overflow-x-auto rounded border border-app-border bg-white shadow-sm">
                  <table className="table-excel">
                    <thead>
                      <tr>
                        <th style={{ width: 56 }}>TURNO</th>
                        <th style={{ width: 110 }}>TOTAL CONSOLA</th>
                        <th style={{ width: 96 }}>YAPE</th>
                        <th style={{ width: 96 }}>OPEN PAY</th>
                        <th style={{ width: 100 }}>DEPÓSITO / TRANS.</th>
                        <th style={{ width: 100 }}>DSCTOS VALES</th>
                        {modo === 'abreviado' ? (
                          <th style={{ width: 120, background: '#fef9c3', color: '#854d0e' }}>TOTAL CRÉDITOS</th>
                        ) : (
                          <>
                            <th style={{ width: 108, background: '#f1f5f9' }}>CORPORACIÓN</th>
                            <th style={{ width: 110, background: '#f1f5f9' }}>LICITACIONES</th>
                            <th style={{ width: 108, background: '#f1f5f9' }}>PARTICULARES</th>
                            <th style={{ width: 90,  background: '#f1f5f9' }}>CHEVRON</th>
                          </>
                        )}
                        <th style={{ width: 90 }}>PRUEBA</th>
                        <th style={{ width: 90 }}>REDONDEO</th>
                        <th style={{ width: 116, background: '#dcfce7', color: '#15803d' }}>EFECTIVO FINAL</th>
                        <th style={{ width: 120 }}>COLABORADOR</th>
                      </tr>
                    </thead>
                    <tbody>
                      {turnos.map((t, idx) => {
                        const c = cierresMap[t.id] || {
                          id: '',
                          turno_id: t.id,
                          total_consola_centimos: null,
                          yape_centimos: 0,
                          openpay_centimos: 0,
                          deposito_transferencia_centimos: 0,
                          corporacion_centimos: 0,
                          licitaciones_centimos: 0,
                          particulares_centimos: 0,
                          chevron_centimos: 0,
                          serafinado_centimos: 0,
                          redondeo_centimos: 0,
                          contaminacion_centimos: 0,
                          entregado_grifero_centimos: null,
                          contabilizado_admin_centimos: null,
                          colaborador_id: '',
                          vales_total_centimos: 0
                        }

                        const creditos = creditosPorTurno[t.id] || { corporacion: 0, licitaciones: 0, particulares: 0, chevron: 0 }
                        const totalCreditos = creditos.corporacion + creditos.licitaciones + creditos.particulares + creditos.chevron
                        const efectivo = calcEfectivoFinal(c, creditos)

                        const inputs = inputsMap[t.id] || {
                          total_consola: '',
                          yape: '0.00',
                          openpay: '0.00',
                          deposito: '0.00',
                          serafinado: '0.00',
                          redondeo: '0.00',
                          entregado_grifero: '',
                          contabilizado_admin: '',
                          colaborador_id: '',
                        }

                        const inputStyle = "w-full bg-transparent border-0 px-1 py-0.5 text-right font-mono text-xs focus:ring-1 focus:ring-primary focus:bg-white"

                        return (
                          <tr key={t.id}>
                            <td className="text-center text-sm font-bold text-slate-800 bg-slate-50">
                              {idx + 1}
                            </td>
                            {/* Total Consola */}
                            <td>
                              <input
                                type="number"
                                step="0.01"
                                className={inputStyle}
                                value={inputs.total_consola}
                                onChange={e => handleInputChange(t.id, 'total_consola', e.target.value)}
                                onBlur={() => handleShiftInputBlur(t.id, 'total_consola')}
                                placeholder="0.00"
                              />
                            </td>
                            {/* Yape */}
                            <td>
                              <input
                                type="number"
                                step="0.01"
                                className={inputStyle}
                                value={inputs.yape}
                                onChange={e => handleInputChange(t.id, 'yape', e.target.value)}
                                onBlur={() => handleShiftInputBlur(t.id, 'yape')}
                              />
                            </td>
                            {/* Open Pay */}
                            <td>
                              <input
                                type="number"
                                step="0.01"
                                className={inputStyle}
                                value={inputs.openpay}
                                onChange={e => handleInputChange(t.id, 'openpay', e.target.value)}
                                onBlur={() => handleShiftInputBlur(t.id, 'openpay')}
                              />
                            </td>
                            {/* Depósito */}
                            <td>
                              <input
                                type="number"
                                step="0.01"
                                className={inputStyle}
                                value={inputs.deposito}
                                onChange={e => handleInputChange(t.id, 'deposito', e.target.value)}
                                onBlur={() => handleShiftInputBlur(t.id, 'deposito')}
                              />
                            </td>
                            {/* Vales (Solo Lectura, sumado de cierre_vales) */}
                            <td className="text-right font-mono text-xs text-slate-600 bg-slate-50/50">
                              {fs(c.vales_total_centimos)}
                            </td>

                            {/* Créditos (Calculados Reactivos) */}
                            {modo === 'abreviado' ? (
                              <td
                                className="text-right font-mono text-xs font-semibold text-amber-800"
                                style={{ background: '#fef9c3' }}
                              >
                                {fs(totalCreditos)}
                              </td>
                            ) : (
                              <>
                                <td className="text-right font-mono text-xs" style={{ background: '#f1f5f9' }}>
                                  {fs(creditos.corporacion)}
                                </td>
                                <td className="text-right font-mono text-xs" style={{ background: '#f1f5f9' }}>
                                  {fs(creditos.licitaciones)}
                                </td>
                                <td className="text-right font-mono text-xs" style={{ background: '#f1f5f9' }}>
                                  {fs(creditos.particulares)}
                                </td>
                                <td className="text-right font-mono text-xs" style={{ background: '#f1f5f9' }}>
                                  {fs(creditos.chevron)}
                                </td>
                              </>
                            )}

                            {/* Prueba (Serafinado) */}
                            <td>
                              <input
                                type="number"
                                step="0.01"
                                className={inputStyle}
                                value={inputs.serafinado}
                                onChange={e => handleInputChange(t.id, 'serafinado', e.target.value)}
                                onBlur={() => handleShiftInputBlur(t.id, 'serafinado')}
                              />
                            </td>
                            {/* Redondeo */}
                            <td>
                              <input
                                type="number"
                                step="0.01"
                                className={inputStyle}
                                value={inputs.redondeo}
                                onChange={e => handleInputChange(t.id, 'redondeo', e.target.value)}
                                onBlur={() => handleShiftInputBlur(t.id, 'redondeo')}
                              />
                            </td>
                            {/* Efectivo Final */}
                            <td className="text-right font-mono text-xs font-semibold" style={{ background: '#e8f5e9' }}>
                              {fs(efectivo)}
                            </td>
                            {/* Colaborador */}
                            <td>
                              <select
                                className="w-full bg-transparent border-0 py-0.5 text-xs focus:ring-1 focus:ring-primary focus:bg-white"
                                value={inputs.colaborador_id}
                                onChange={e => {
                                  handleInputChange(t.id, 'colaborador_id', e.target.value)
                                  // Forzar guardado inmediato al seleccionar colaborador
                                  setTimeout(() => {
                                    setInputsMap(prev => {
                                      const updated = {
                                        ...prev,
                                        [t.id]: { ...prev[t.id], colaborador_id: e.target.value }
                                      }
                                      // Llamar al guardado con la referencia actualizada
                                      const totalConsola = updated[t.id].total_consola === '' ? null : toCentimos(updated[t.id].total_consola)
                                      const yape = toCentimos(updated[t.id].yape)
                                      const openpay = toCentimos(updated[t.id].openpay)
                                      const deposito = toCentimos(updated[t.id].deposito)
                                      const serafinado = toCentimos(updated[t.id].serafinado)
                                      const redondeo = toCentimos(updated[t.id].redondeo)
                                      const entregado = updated[t.id].entregado_grifero === '' ? null : toCentimos(updated[t.id].entregado_grifero)
                                      const contabilizado = updated[t.id].contabilizado_admin === '' ? null : toCentimos(updated[t.id].contabilizado_admin)
                                      
                                      const payload = {
                                        fecha,
                                        turno_id: t.id,
                                        colaborador_id: e.target.value,
                                        total_consola_centimos: totalConsola,
                                        yape_centimos: yape,
                                        openpay_centimos: openpay,
                                        deposito_transferencia_centimos: deposito,
                                        serafinado_centimos: serafinado,
                                        redondeo_centimos: redondeo,
                                        entregado_grifero_centimos: entregado,
                                        contabilizado_admin_centimos: contabilizado,
                                      }
                                      
                                      const existingCierre = cierresMap[t.id]
                                      if (existingCierre) {
                                        supabase.from('cierres_caja').update(payload).eq('id', existingCierre.id).then(() => loadDia())
                                      } else {
                                        supabase.from('cierres_caja').insert(payload).then(() => loadDia())
                                      }
                                      return updated
                                    })
                                  }, 0)
                                }}
                              >
                                <option value="">—</option>
                                {colaboradores.map(col => (
                                  <option key={col.id} value={col.id}>{col.nombre}</option>
                                ))}
                              </select>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>

                {/* === MODO ABREVIADO: Registro Rápido de Créditos === */}
                {modo === 'abreviado' && (
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    {/* Formulario rápido */}
                    <div className="card space-y-4 md:col-span-1">
                      <h3 className="text-sm font-bold text-slate-700 border-b pb-1.5">Registro Rápido de Créditos</h3>
                      
                      <div className="flex items-center gap-4">
                        <div className="flex-1">
                          <label className="block text-xs font-semibold text-slate-500 mb-1">TURNO</label>
                          <select
                            className="input h-9"
                            value={quickTurno}
                            onChange={e => setQuickTurno(e.target.value)}
                          >
                            {turnos.map((t, i) => (
                              <option key={t.id} value={String(t.id)}>{i + 1}</option>
                            ))}
                          </select>
                        </div>
                        <div className="flex-1">
                          <label className="block text-xs font-semibold text-slate-500 mb-1">MONTO S/.</label>
                          <input
                            type="number"
                            step="0.01"
                            placeholder="0.00"
                            className="input h-9 font-mono"
                            value={quickMonto}
                            onChange={e => setQuickMonto(e.target.value)}
                            onKeyDown={e => {
                              if (e.key === 'Enter' && parseFloat(quickMonto) > 0 && !savingQuick) {
                                handleQuickRegister()
                              }
                            }}
                          />
                        </div>
                      </div>

                      <button
                        className="btn-primary w-full h-9"
                        disabled={!(parseFloat(quickMonto) > 0) || savingQuick}
                        onClick={handleQuickRegister}
                      >
                        {savingQuick ? 'Registrando…' : 'REGISTRAR'}
                      </button>
                    </div>

                    {/* Mini tabla de créditos rápidos */}
                    <div className="card md:col-span-2 space-y-2">
                      <h3 className="text-sm font-bold text-slate-700 border-b pb-1.5">Créditos Rápidos del Día</h3>
                      <div className="max-h-48 overflow-y-auto border border-app-border rounded">
                        <table className="table-excel">
                          <thead>
                            <tr>
                              <th style={{ width: 80 }}>TURNO</th>
                              <th>MONTO S/.</th>
                              <th style={{ width: 100 }}>ACCIONES</th>
                            </tr>
                          </thead>
                          <tbody>
                            {registrosRapidos.map(r => (
                              <tr key={r.id}>
                                <td className="text-center text-xs font-semibold">{r.turno_id}</td>
                                <td className="font-mono text-xs font-bold text-slate-800">{fs(r.importe_centimos)}</td>
                                <td className="text-center">
                                  <button
                                    onClick={() => deleteRegistro(r.id)}
                                    className="text-red-600 hover:text-red-800 text-xs font-semibold"
                                  >
                                    Eliminar
                                  </button>
                                </td>
                              </tr>
                            ))}
                            {registrosRapidos.length === 0 && (
                              <tr>
                                <td colSpan={3} className="py-6 text-center text-xs text-app-muted italic">
                                  No hay créditos rápidos registrados hoy
                                </td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                )}

                {/* === MODO COMPLETO: Registro Completo de Vales y Transacciones === */}
                {modo === 'completo' && (
                  <div className="overflow-x-auto rounded border border-app-border bg-white shadow-sm">
                    <table className="table-excel">
                      <thead>
                        <tr>
                          <th style={{ width: 86 }}>FECHA</th>
                          <th style={{ width: 150 }}>CLIENTE</th>
                          <th style={{ width: 80 }}>VALE</th>
                          <th style={{ width: 80 }}>PLACA</th>
                          <th style={{ width: 70 }}>TICKET</th>
                          <th style={{ width: 120 }}>CONDUCTOR</th>
                          <th style={{ width: 84 }}>DNI</th>
                          <th style={{ width: 58 }}>TURNO</th>
                          <th style={{ width: 82 }}>PRODUCTO</th>
                          <th style={{ width: 80 }}>GALONES</th>
                          <th style={{ width: 108 }}>PRECIO TOTAL</th>
                          <th style={{ width: 100, background: '#fff7ed', color: '#ea580c' }}>
                            VARIACIÓN
                          </th>
                          <th style={{ width: 110 }}>ACCIONES</th>
                        </tr>
                      </thead>
                      <tbody>
                        {/* Fila de Entrada Rápida */}
                        <tr style={{ background: '#eff6ff' }}>
                          <td className="text-xs text-app-muted">{fecha}</td>
                          <td>
                            <select
                              className="input py-0 h-6 text-xs w-full"
                              value={nuevo.empresa_id}
                              onChange={(e) => {
                                const next = { ...nuevo, empresa_id: e.target.value }
                                if (e.target.value) {
                                  const emp = empresas.find(x => x.id === e.target.value)
                                  if (emp) next.tipo_atencion = emp.tipo
                                }
                                setNuevo(next)
                              }}
                            >
                              <option value="">Buscar…</option>
                              {empresas.map(e => (
                                <option key={e.id} value={e.id}>{e.nombre}</option>
                              ))}
                            </select>
                          </td>
                          <td>
                            <input
                              className="input py-0 h-6 text-xs w-full"
                              placeholder="Nº vale"
                              value={nuevo.numero}
                              onChange={e => setNuevo({ ...nuevo, numero: e.target.value })}
                            />
                          </td>
                          <td>
                            <input
                              className="input py-0 h-6 text-xs w-full"
                              placeholder="Placa"
                              value={nuevo.placa}
                              onChange={e => setNuevo({ ...nuevo, placa: e.target.value })}
                              style={{ textTransform: 'uppercase' }}
                            />
                          </td>
                          <td>
                            <input
                              className="input py-0 h-6 text-xs w-full"
                              placeholder="Serie"
                              value={nuevo.serie}
                              onChange={e => setNuevo({ ...nuevo, serie: e.target.value })}
                            />
                          </td>
                          <td>
                            <input
                              className="input py-0 h-6 text-xs w-full"
                              placeholder="Conductor"
                              value={nuevo.conductor}
                              onChange={e => setNuevo({ ...nuevo, conductor: e.target.value })}
                            />
                          </td>
                          <td>
                            <input
                              className="input py-0 h-6 text-xs w-full"
                              placeholder="DNI"
                              value={nuevo.dni_conductor}
                              onChange={e => setNuevo({ ...nuevo, dni_conductor: e.target.value })}
                              maxLength={8}
                            />
                          </td>
                          <td>
                            <select
                              className="input py-0 h-6 text-xs w-full"
                              value={nuevo.turno_id}
                              onChange={e => setNuevo({ ...nuevo, turno_id: e.target.value })}
                            >
                              {turnos.map((t, i) => (
                                <option key={t.id} value={String(t.id)}>{i + 1}</option>
                              ))}
                            </select>
                          </td>
                          <td>
                            <select
                              className="input py-0 h-6 text-xs w-full"
                              value={nuevo.tipo_combustible}
                              onChange={e => setNuevo({ ...nuevo, tipo_combustible: e.target.value })}
                            >
                              <option value="">—</option>
                              {combustibles.map(c => (
                                <option key={c.codigo} value={c.codigo}>{c.codigo}</option>
                              ))}
                            </select>
                          </td>
                          <td>
                            <input
                              type="number"
                              step="0.001"
                              min="0"
                              className="input py-0 h-6 text-xs w-full text-right font-mono"
                              placeholder="0.000"
                              value={nuevo.cantidad_galones}
                              onChange={e => setNuevo({ ...nuevo, cantidad_galones: e.target.value })}
                              onKeyDown={e => {
                                const gal = parseFloat(nuevo.cantidad_galones)
                                if (e.key === 'Enter' && nuevo.tipo_combustible && gal > 0 && !savingReg) {
                                  saveRegistro()
                                }
                              }}
                            />
                          </td>
                          <td className="text-right font-mono text-xs font-medium text-primary-text">
                            {parseFloat(nuevo.cantidad_galones) > 0 && nuevo.tipo_combustible
                              ? fs(Math.round(parseFloat(nuevo.cantidad_galones) * precioDiario(nuevo.tipo_combustible)))
                              : '—'}
                          </td>
                          <td style={{ background: '#fff7ed' }}>
                            <button
                              className="btn-primary h-6 w-full py-0 text-xs"
                              disabled={!nuevo.tipo_combustible || !(parseFloat(nuevo.cantidad_galones) > 0) || savingReg}
                              onClick={saveRegistro}
                            >
                              {savingReg ? '…' : '+ Agregar'}
                            </button>
                          </td>
                          <td className="text-center">—</td>
                        </tr>

                        {/* Registros guardados */}
                        {registros.map(r => {
                          const isEditing = editingId === r.id
                          const precioRef = precioDiario(r.tipo_combustible)
                          const variacion = Math.round((precioRef - r.precio_unit_centimos) * r.cantidad_galones)

                          if (isEditing && editForm) {
                            return (
                              <tr key={r.id} className="bg-amber-50">
                                <td className="text-xs text-amber-800 font-semibold">{fecha}</td>
                                {/* Cliente */}
                                <td>
                                  <select
                                    className="input py-0 h-6 text-xs w-full bg-white border-amber-300"
                                    value={editForm.empresa_id}
                                    onChange={e => setEditForm({ ...editForm, empresa_id: e.target.value })}
                                  >
                                    <option value="">Buscar…</option>
                                    {empresas.map(emp => (
                                      <option key={emp.id} value={emp.id}>{emp.nombre}</option>
                                    ))}
                                  </select>
                                </td>
                                {/* Vale/Número */}
                                <td>
                                  <input
                                    className="input py-0 h-6 text-xs w-full bg-white border-amber-300"
                                    value={editForm.numero}
                                    onChange={e => setEditForm({ ...editForm, numero: e.target.value })}
                                  />
                                </td>
                                {/* Placa */}
                                <td>
                                  <input
                                    className="input py-0 h-6 text-xs w-full bg-white border-amber-300"
                                    value={editForm.placa}
                                    onChange={e => setEditForm({ ...editForm, placa: e.target.value })}
                                    style={{ textTransform: 'uppercase' }}
                                  />
                                </td>
                                {/* Serie */}
                                <td>
                                  <input
                                    className="input py-0 h-6 text-xs w-full bg-white border-amber-300"
                                    value={editForm.serie}
                                    onChange={e => setEditForm({ ...editForm, serie: e.target.value })}
                                  />
                                </td>
                                {/* Conductor */}
                                <td>
                                  <input
                                    className="input py-0 h-6 text-xs w-full bg-white border-amber-300"
                                    value={editForm.conductor}
                                    onChange={e => setEditForm({ ...editForm, conductor: e.target.value })}
                                  />
                                </td>
                                {/* DNI */}
                                <td>
                                  <input
                                    className="input py-0 h-6 text-xs w-full bg-white border-amber-300"
                                    value={editForm.dni_conductor}
                                    onChange={e => setEditForm({ ...editForm, dni_conductor: e.target.value })}
                                    maxLength={8}
                                  />
                                </td>
                                {/* Turno */}
                                <td>
                                  <select
                                    className="input py-0 h-6 text-xs w-full bg-white border-amber-300"
                                    value={editForm.turno_id}
                                    onChange={e => setEditForm({ ...editForm, turno_id: e.target.value })}
                                  >
                                    {turnos.map((t, i) => (
                                      <option key={t.id} value={String(t.id)}>{i + 1}</option>
                                    ))}
                                  </select>
                                </td>
                                {/* Producto */}
                                <td>
                                  <select
                                    className="input py-0 h-6 text-xs w-full bg-white border-amber-300"
                                    value={editForm.tipo_combustible}
                                    onChange={e => setEditForm({ ...editForm, tipo_combustible: e.target.value })}
                                  >
                                    {combustibles.map(comb => (
                                      <option key={comb.codigo} value={comb.codigo}>{comb.codigo}</option>
                                    ))}
                                  </select>
                                </td>
                                {/* Galones */}
                                <td>
                                  <input
                                    type="number"
                                    step="0.001"
                                    className="input py-0 h-6 text-xs w-full text-right font-mono bg-white border-amber-300"
                                    value={editForm.cantidad_galones}
                                    onChange={e => setEditForm({ ...editForm, cantidad_galones: e.target.value })}
                                  />
                                </td>
                                {/* Importe (Editable solo si galones = 0, sino calculado) */}
                                <td>
                                  {parseFloat(editForm.cantidad_galones) === 0 ? (
                                    <input
                                      type="number"
                                      step="0.01"
                                      className="input py-0 h-6 text-xs w-full text-right font-mono bg-white border-amber-300"
                                      value={editForm.importe}
                                      onChange={e => setEditForm({ ...editForm, importe: e.target.value })}
                                    />
                                  ) : (
                                    <span className="block text-right font-mono text-xs font-medium px-2 text-slate-700">
                                      {fs(Math.round((parseFloat(editForm.cantidad_galones) || 0) * precioDiario(editForm.tipo_combustible)))}
                                    </span>
                                  )}
                                </td>
                                <td style={{ background: '#fff7ed' }}>—</td>
                                {/* Acciones Guardar / Cancelar */}
                                <td className="text-center space-x-1.5">
                                  <button
                                    onClick={() => saveEdit(r.id)}
                                    className="text-green-600 hover:text-green-800 text-xs font-bold"
                                  >
                                    Guardar
                                  </button>
                                  <button
                                    onClick={() => { setEditingId(null); setEditForm(null) }}
                                    className="text-slate-500 hover:text-slate-700 text-xs font-semibold"
                                  >
                                    Cancel
                                  </button>
                                </td>
                              </tr>
                            )
                          }

                          return (
                            <tr key={r.id}>
                              <td className="text-xs">{fecha}</td>
                              <td className="text-xs truncate" style={{ maxWidth: 140 }}>
                                {r.empresa_nombre ?? '—'}
                              </td>
                              <td className="text-xs">{r.numero ?? '—'}</td>
                              <td className="text-xs">{r.placa ?? '—'}</td>
                              <td className="text-xs">{r.serie ?? '—'}</td>
                              <td className="text-xs">{r.conductor ?? '—'}</td>
                              <td className="text-xs">{r.dni_conductor ?? '—'}</td>
                              <td className="text-center text-xs">{r.turno_id}</td>
                              <td className="text-xs font-medium">
                                {r.cantidad_galones === 0 ? 'REG. RÁPIDO' : r.tipo_combustible}
                              </td>
                              <td className="text-right font-mono text-xs">
                                {r.cantidad_galones > 0 ? r.cantidad_galones.toFixed(3) : '—'}
                              </td>
                              <td className="text-right font-mono text-xs font-semibold text-slate-700">{fs(r.importe_centimos)}</td>
                              <td
                                className="text-right font-mono text-xs font-semibold"
                                style={{
                                  background: '#fff7ed',
                                  color: variacion > 0 ? '#16a34a' : variacion < 0 ? '#dc2626' : '#ea580c',
                                }}
                              >
                                {r.cantidad_galones > 0 ? fs(Math.abs(variacion)) : '—'}
                              </td>
                              <td className="text-center space-x-2">
                                <button
                                  onClick={() => startEdit(r)}
                                  className="text-blue-600 hover:text-blue-800 text-xs font-semibold"
                                >
                                  Editar
                                </button>
                                <button
                                  onClick={() => deleteRegistro(r.id)}
                                  className="text-red-600 hover:text-red-800 text-xs font-semibold"
                                >
                                  Eliminar
                                </button>
                              </td>
                            </tr>
                          )
                        })}

                        {registros.length === 0 && (
                          <tr>
                            <td colSpan={13} className="py-4 text-center text-xs text-app-muted">
                              No hay registros de vales/créditos para esta fecha
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
        )}

        {/* === VISTA: HISTORIAL MENSUAL === */}
        {activeTab === 'historial' && (
          <div className="space-y-4">
            {loadingHistorial ? (
              <div className="flex h-64 items-center justify-center">
                <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
              </div>
            ) : cierresHistorial.length === 0 ? (
              <div className="flex h-64 flex-col items-center justify-center rounded-lg border-2 border-dashed border-app-border bg-white p-8 text-center shadow-sm">
                <p className="text-base font-medium text-slate-600">No hay registros de ventas para el mes seleccionado.</p>
                <p className="text-xs text-app-muted mt-1">Selecciona otro mes o verifica los cierres cargados.</p>
              </div>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-app-border bg-white shadow-sm">
                <table className="table-excel min-w-full">
                  <thead>
                    <tr>
                      <th style={{ width: 90 }}>FECHA</th>
                      <th style={{ width: 56 }}>TURNO</th>
                      <th style={{ width: 120 }}>INGRESO TOTAL</th>
                      <th style={{ width: 100 }}>YAPE</th>
                      <th style={{ width: 100 }}>OPEN PAY</th>
                      <th style={{ width: 110 }}>DEPÓSITO / TRANS.</th>
                      <th style={{ width: 110 }}>DSCTOS, VALES</th>
                      {modo === 'abreviado' ? (
                        <th style={{ width: 120, background: '#fef9c3', color: '#854d0e' }}>TOTAL CRÉDITOS</th>
                      ) : (
                        <>
                          <th style={{ width: 110, background: '#f1f5f9' }}>CORPORACIÓN</th>
                          <th style={{ width: 110, background: '#f1f5f9' }}>LICITACIONES</th>
                          <th style={{ width: 110, background: '#f1f5f9' }}>PARTICULARES</th>
                          <th style={{ width: 95,  background: '#f1f5f9' }}>CHEVRON</th>
                        </>
                      )}
                      <th style={{ width: 110, background: '#ffedd5', color: '#c2410c' }}>PRUEBAS / SERAF.</th>
                      <th style={{ width: 90 }}>REDONDEO</th>
                      <th style={{ width: 120, background: '#dcfce7', color: '#15803d' }}>EFECTIVO</th>
                      <th style={{ width: 130, background: '#dcfce7', color: '#15803d' }}>ENTREGADO SOBRE</th>
                      <th style={{ width: 130, background: '#dcfce7', color: '#15803d' }}>CONTABILIZADO</th>
                      <th style={{ width: 120, background: '#dcfce7', color: '#15803d' }}>FALTANTE/SOBRANTE</th>
                      <th style={{ width: 110 }}>COLABORADOR</th>
                    </tr>
                  </thead>
                  <tbody>
                    
                    {/* Fila de Gran Total Mensual */}
                    <tr className="font-bold text-slate-800" style={{ background: '#ffedd5' }}>
                      <td className="text-left font-bold text-amber-955 px-2 py-1.5" colSpan={2}>
                        {nombreMes}
                      </td>
                      <td className="text-right font-mono text-xs">{fs(totalMensual.total_consola)}</td>
                      <td className="text-right font-mono text-xs">{fs(totalMensual.yape)}</td>
                      <td className="text-right font-mono text-xs">{fs(totalMensual.openpay)}</td>
                      <td className="text-right font-mono text-xs">{fs(totalMensual.deposito)}</td>
                      <td className="text-right font-mono text-xs">{fs(totalMensual.vales)}</td>
                      {modo === 'abreviado' ? (
                        <td className="text-right font-mono text-xs" style={{ background: '#fef9c3' }}>
                          {fs(totalMensual.corporacion + totalMensual.licitaciones + totalMensual.particulares + totalMensual.chevron)}
                        </td>
                      ) : (
                        <>
                          <td className="text-right font-mono text-xs" style={{ background: '#e2e8f0' }}>{fs(totalMensual.corporacion)}</td>
                          <td className="text-right font-mono text-xs" style={{ background: '#e2e8f0' }}>{fs(totalMensual.licitaciones)}</td>
                          <td className="text-right font-mono text-xs" style={{ background: '#e2e8f0' }}>{fs(totalMensual.particulares)}</td>
                          <td className="text-right font-mono text-xs" style={{ background: '#e2e8f0' }}>{fs(totalMensual.chevron)}</td>
                        </>
                      )}
                      <td className="text-right font-mono text-xs" style={{ background: '#fed7aa' }}>{fs(totalMensual.serafinado + totalMensual.contaminacion)}</td>
                      <td className="text-right font-mono text-xs">{fs(totalMensual.redondeo)}</td>
                      <td className="text-right font-mono text-xs text-green-800" style={{ background: '#bbf7d0' }}>{fs(totalMensual.efectivo_final)}</td>
                      <td className="text-right font-mono text-xs text-green-800" style={{ background: '#bbf7d0' }}>{fs(totalMensual.entregado_grifero)}</td>
                      <td className="text-right font-mono text-xs text-green-800" style={{ background: '#bbf7d0' }}>{fs(totalMensual.contabilizado_admin)}</td>
                      {renderDiferencia(totalMensual.faltante_sobrante)}
                      <td className="text-center text-xs">—</td>
                    </tr>

                    {/* Filas agrupadas por Fecha */}
                    {Object.entries(groupedTestData).map(([fechaString, turnosDelDia]) => {
                      const turnosOrdenados = [1, 2, 3, 4].map(tNum => {
                        return turnosDelDia.find(c => c.turno_id === tNum) || null
                      })

                      const diaTotalConsola = sumCentimos(turnosDelDia.map(c => c.total_consola_centimos))
                      const diaYape = sumCentimos(turnosDelDia.map(c => c.yape_centimos))
                      const diaOpenpay = sumCentimos(turnosDelDia.map(c => c.openpay_centimos))
                      const diaDeposito = sumCentimos(turnosDelDia.map(c => c.deposito_transferencia_centimos))
                      const diaVales = sumCentimos(turnosDelDia.map(c => c.vales_total_centimos))
                      const diaCorporacion = sumCentimos(turnosDelDia.map(c => c.corporacion_centimos))
                      const diaLicitaciones = sumCentimos(turnosDelDia.map(c => c.licitaciones_centimos))
                      const diaParticulares = sumCentimos(turnosDelDia.map(c => c.particulares_centimos))
                      const diaChevron = sumCentimos(turnosDelDia.map(c => c.chevron_centimos))
                      const diaSerafinado = sumCentimos(turnosDelDia.map(c => c.serafinado_centimos))
                      const diaContaminacion = sumCentimos(turnosDelDia.map(c => c.contaminacion_centimos))
                      const diaRedondeo = sumCentimos(turnosDelDia.map(c => c.redondeo_centimos))
                      const diaEfectivoFinal = sumCentimos(turnosDelDia.map(c => c.efectivo_final_centimos))
                      
                      const diaEntregado = turnosDelDia.some(c => c.entregado_grifero_centimos !== null)
                        ? sumCentimos(turnosDelDia.map(c => c.entregado_grifero_centimos))
                        : null
                      
                      const diaContabilizado = turnosDelDia.some(c => c.contabilizado_admin_centimos !== null)
                        ? sumCentimos(turnosDelDia.map(c => c.contabilizado_admin_centimos))
                        : null

                      const diaFaltanteSobrante = (diaContabilizado !== null ? diaContabilizado : (diaEntregado !== null ? diaEntregado : null)) !== null
                        ? (diaContabilizado !== null ? diaContabilizado : (diaEntregado ?? 0)) - diaEfectivoFinal
                        : null

                      const [yyyy, mm, dd] = fechaString.split('-')
                      const fechaFormateada = `${parseInt(dd, 10)}/${parseInt(mm, 10)}/${yyyy}`

                      return (
                        <Fragment key={fechaString}>
                          {/* Turnos 1 al 4 */}
                          {turnosOrdenados.map((c, idx) => {
                            const tNum = idx + 1
                            if (!c) {
                              return (
                                <tr key={`${fechaString}-${tNum}`} className="text-slate-300">
                                  <td className="text-center text-xs bg-slate-50 font-medium text-slate-400">
                                    <button
                                      onClick={() => { setFecha(fechaString); setActiveTab('registro') }}
                                      className="text-primary hover:underline"
                                      title="Registrar / Editar este día"
                                    >
                                      {fechaFormateada}
                                    </button>
                                  </td>
                                  <td className="text-center text-xs font-bold bg-slate-50 text-slate-400">{tNum}</td>
                                  <td colSpan={13} className="text-center text-xs italic py-0.5 text-slate-300">
                                    Sin registros
                                  </td>
                                </tr>
                              )
                            }

                            const totalCreditos =
                              c.corporacion_centimos +
                              c.licitaciones_centimos +
                              c.particulares_centimos +
                              c.chevron_centimos

                            return (
                              <tr key={c.id}>
                                <td className="text-center text-xs bg-slate-50 font-medium">
                                  <button
                                    onClick={() => { setFecha(fechaString); setActiveTab('registro') }}
                                    className="text-primary hover:underline font-bold"
                                    title="Registrar / Editar este día"
                                  >
                                    {fechaFormateada}
                                  </button>
                                </td>
                                <td className="text-center text-xs font-bold text-slate-700 bg-slate-50">{tNum}</td>
                                <td className="text-right font-mono text-xs">{fs(c.total_consola_centimos)}</td>
                                <td className="text-right font-mono text-xs">{fs(c.yape_centimos)}</td>
                                <td className="text-right font-mono text-xs">{fs(c.openpay_centimos)}</td>
                                <td className="text-right font-mono text-xs">{fs(c.deposito_transferencia_centimos)}</td>
                                <td className="text-right font-mono text-xs">{fs(c.vales_total_centimos)}</td>
                                
                                {modo === 'abreviado' ? (
                                  <td className="text-right font-mono text-xs font-medium" style={{ background: '#fef9c3' }}>
                                    {fs(totalCreditos)}
                                  </td>
                                ) : (
                                  <>
                                    <td className="text-right font-mono text-xs" style={{ background: '#f1f5f9' }}>{fs(c.corporacion_centimos)}</td>
                                    <td className="text-right font-mono text-xs" style={{ background: '#f1f5f9' }}>{fs(c.licitaciones_centimos)}</td>
                                    <td className="text-right font-mono text-xs" style={{ background: '#f1f5f9' }}>{fs(c.particulares_centimos)}</td>
                                    <td className="text-right font-mono text-xs" style={{ background: '#f1f5f9' }}>{fs(c.chevron_centimos)}</td>
                                  </>
                                )}

                                <td className="text-right font-mono text-xs" style={{ background: '#fff7ed' }}>
                                  {fs(c.serafinado_centimos + c.contaminacion_centimos)}
                                </td>
                                <td className="text-right font-mono text-xs">{fs(c.redondeo_centimos)}</td>
                                <td className="text-right font-mono text-xs font-semibold" style={{ background: '#f0fdf4' }}>{fs(c.efectivo_final_centimos)}</td>
                                <td className="text-right font-mono text-xs" style={{ background: '#f0fdf4' }}>{fs(c.entregado_grifero_centimos)}</td>
                                <td className="text-right font-mono text-xs" style={{ background: '#f0fdf4' }}>{fs(c.contabilizado_admin_centimos)}</td>
                                {renderDiferencia(c.faltante_sobrante_centimos)}
                                <td className="text-center text-xs text-slate-600 truncate" style={{ maxWidth: 100 }}>{c.colaborador_nombre}</td>
                              </tr>
                            )
                          })}

                          {/* Fila consolidada (DIA) */}
                          <tr className="font-bold border-b-2 border-slate-300" style={{ background: '#dcfce7' }}>
                            <td className="text-center text-xs text-green-950">
                              <button
                                onClick={() => { setFecha(fechaString); setActiveTab('registro') }}
                                className="text-green-950 hover:underline font-bold"
                                title="Registrar / Editar este día"
                              >
                                {fechaFormateada}
                              </button>
                            </td>
                            <td className="text-center text-xs text-green-950 font-bold">DIA</td>
                            <td className="text-right font-mono text-xs text-green-950">{fs(diaTotalConsola)}</td>
                            <td className="text-right font-mono text-xs text-green-950">{fs(diaYape)}</td>
                            <td className="text-right font-mono text-xs text-green-950">{fs(diaOpenpay)}</td>
                            <td className="text-right font-mono text-xs text-green-950">{fs(diaDeposito)}</td>
                            <td className="text-right font-mono text-xs text-green-950">{fs(diaVales)}</td>
                            
                            {modo === 'abreviado' ? (
                              <td className="text-right font-mono text-xs text-green-950" style={{ background: '#fef9c3' }}>
                                {fs(diaCorporacion + diaLicitaciones + diaParticulares + diaChevron)}
                              </td>
                            ) : (
                              <>
                                <td className="text-right font-mono text-xs text-green-950" style={{ background: '#e2e8f0' }}>{fs(diaCorporacion)}</td>
                                <td className="text-right font-mono text-xs text-green-950" style={{ background: '#e2e8f0' }}>{fs(diaLicitaciones)}</td>
                                <td className="text-right font-mono text-xs text-green-950" style={{ background: '#e2e8f0' }}>{fs(diaParticulares)}</td>
                                <td className="text-right font-mono text-xs text-green-950" style={{ background: '#e2e8f0' }}>{fs(diaChevron)}</td>
                              </>
                            )}

                            <td className="text-right font-mono text-xs text-green-950" style={{ background: '#fed7aa' }}>{fs(diaSerafinado + diaContaminacion)}</td>
                            <td className="text-right font-mono text-xs text-green-950">{fs(diaRedondeo)}</td>
                            <td className="text-right font-mono text-xs text-green-800" style={{ background: '#bbf7d0' }}>{fs(diaEfectivoFinal)}</td>
                            <td className="text-right font-mono text-xs text-green-800" style={{ background: '#bbf7d0' }}>{fs(diaEntregado)}</td>
                            <td className="text-right font-mono text-xs text-green-800" style={{ background: '#bbf7d0' }}>{fs(diaContabilizado)}</td>
                            {renderDiferencia(diaFaltanteSobrante)}
                            <td className="text-center text-xs text-green-950">—</td>
                          </tr>
                        </Fragment>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
