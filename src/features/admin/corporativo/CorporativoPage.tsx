import { useState, useEffect, useMemo, useRef, Fragment } from 'react'
import type { ReactNode } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { supabase } from '@/lib/supabase'
import { formatSoles, toCentimos } from '@/lib/money'
import { hoyLocal } from '@/lib/date'
import { usePersistedState } from '@/lib/usePersistedState'
import { useAuth } from '@/features/auth/useAuth'
// Local-first: lecturas y escrituras van contra la base local (Dexie);
// el worker de sync replica a Supabase. Solo la auditoría (historial de
// cambios) sigue siendo online: vive únicamente en el servidor.
import {
  leerCatalogos,
  leerRegistrosRango,
  insertRegistroVenta,
  updateRegistroVenta,
  softDeleteRegistroVenta,
  restaurarRegistroVenta,
} from '@/lib/local/repo'
import { asegurarRango } from '@/lib/local/sync'
import MultiSelectDropdown from '@/components/MultiSelectDropdown'

// ─── Tipos ────────────────────────────────────────────────────────

interface RegistroRow {
  id: string
  fecha: string
  turno_id: number
  turno_nombre: string | null
  empresa_id: string | null
  empresa_nombre: string | null
  tipo_atencion: string
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
  deleted_at: string | null
}

interface FormState {
  fecha: string
  empresa_id: string
  tipo_atencion: string
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

// Fila de registro_ventas_log (auditoría, migración 013)
interface LogRow {
  id: string
  registro_id: string
  accion: 'INSERT' | 'UPDATE' | 'SOFT_DELETE' | 'RESTORE' | 'DELETE'
  datos_old: Record<string, unknown> | null
  datos_new: Record<string, unknown> | null
  usuario_id: string | null
  realizado_en: string
}

type Tab = 'registros' | 'resumen'
type FiltroEstado = 'todos' | 'pendiente' | 'pagado'
type Vista = 'activos' | 'papelera'

const TIPOS_ATENCION = ['corporativo', 'licitacion', 'particular', 'chevron'] as const

// Todos los registros de Seguimiento son vales, así que `tipo_documento` ya no
// se pide ni se muestra: se manda este valor fijo (la columna es NOT NULL en
// `registro_ventas`, con CHECK sobre los tipos permitidos).
const TIPO_DOC_FIJO = 'vale'

const TIPO_LABELS: Record<string, string> = {
  corporativo: 'Corporación',
  licitacion: 'Licitación',
  particular: 'Particular',
  chevron: 'Chevron',
}

/** Mensaje legible de un error desconocido (catch de unknown). */
const msgDe = (err: unknown) => (err instanceof Error ? err.message : String(err))

const FORM_INIT: FormState = {
  fecha: '', empresa_id: '', tipo_atencion: 'corporativo',
  serie: '', numero: '', turno_id: '', conductor: '', placa: '', dni_conductor: '',
  tipo_combustible: '', cantidad_galones: '', precio_unit: '', estado_pago: 'pendiente',
  factura_numero: '', empresa_facturacion: '', fecha_facturacion: '', fecha_pago: '',
}

// ─── Columnas configurables de la tabla de registros ──────────────
// El usuario elige cuáles ve y en qué orden ("Editar encabezado"). Es SOLO
// presentación: los datos siempre se guardan y se traen completos desde Ventas.

type ColKey =
  | 'fecha' | 'empresa' | 'tipo' | 'vale' | 'ticket' | 'placa' | 'conductor'
  | 'dni' | 'turno' | 'producto' | 'galones' | 'precio' | 'importe'
  | 'factura' | 'estado' | 'acciones'

interface ColDef { key: ColKey; label: string; width: number }

const COLUMNAS: ColDef[] = [
  { key: 'fecha',     label: 'FECHA',     width: 92 },
  { key: 'empresa',   label: 'EMPRESA',   width: 160 },
  { key: 'tipo',      label: 'TIPO',      width: 84 },
  { key: 'vale',      label: 'VALE LIC.', width: 96 },
  { key: 'ticket',    label: 'TICKET',    width: 84 },
  { key: 'placa',     label: 'PLACA',     width: 78 },
  { key: 'conductor', label: 'CONDUCTOR', width: 130 },
  { key: 'dni',       label: 'DNI',       width: 84 },
  { key: 'turno',     label: 'TURNO',     width: 58 },
  { key: 'producto',  label: 'PRODUCTO',  width: 80 },
  { key: 'galones',   label: 'GALONES',   width: 80 },
  { key: 'precio',    label: 'PRECIO/GL', width: 84 },
  { key: 'importe',   label: 'IMPORTE',   width: 96 },
  { key: 'factura',   label: 'FACTURA',   width: 96 },
  { key: 'estado',    label: 'ESTADO',    width: 86 },
  // Columna de botones (Editar / Eliminar / Historial). Configurable como las
  // demás desde "Editar encabezado" (mostrar/ocultar + reordenar).
  { key: 'acciones',  label: 'ACCIONES',  width: 160 },
]
const COL_DEF = Object.fromEntries(COLUMNAS.map(c => [c.key, c])) as Record<ColKey, ColDef>
// Alineación de las columnas numéricas (misma en cabecera, cuerpo y totales).
const COL_ALIGN: Partial<Record<ColKey, string>> = {
  turno: 'text-center', galones: 'text-right', precio: 'text-right', importe: 'text-right',
}

/** Preferencia por columna: orden (posición en el array) + visibilidad. */
type ColPref = { k: ColKey; on: boolean }
// Por defecto se ocultan TICKET y DNI (existen, pero rara vez se consultan).
const PREFS_DEFECTO: ColPref[] = COLUMNAS.map(c => ({
  k: c.key,
  on: c.key !== 'ticket' && c.key !== 'dni',
}))

// Rango por defecto del filtro: el mes en curso completo.
function primerDiaMesActual(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}
function ultimoDiaMesActual(): string {
  const d = new Date()
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(last).padStart(2, '0')}`
}

function tipoBadgeClass(tipo: string): string {
  switch (tipo) {
    case 'corporativo': return 'badge-primary'
    case 'licitacion':  return 'badge-accent'
    case 'chevron':     return 'badge-warning'
    default:            return 'badge'
  }
}

// Campos que se comparan/muestran en el historial de auditoría.
const CAMPOS_LOG: [key: string, label: string][] = [
  ['fecha', 'Fecha'],
  ['turno_id', 'Turno'],
  ['empresa_id', 'Empresa'],
  ['tipo_atencion', 'Tipo'],
  ['serie', 'Ticket'],
  ['numero', 'Vale Lic.'],
  ['conductor', 'Conductor'],
  ['placa', 'Placa'],
  ['dni_conductor', 'DNI conductor'],
  ['tipo_combustible', 'Producto'],
  ['cantidad_galones', 'Galones'],
  ['precio_unit_centimos', 'Precio/gl'],
  ['importe_centimos', 'Importe'],
  ['empresa_facturacion', 'Empresa facturación'],
  ['factura_numero', 'N° factura'],
  ['fecha_facturacion', 'Fecha facturación'],
  ['estado_pago', 'Estado de pago'],
  ['fecha_pago', 'Fecha de pago'],
]

const ACCION_META: Record<LogRow['accion'], { label: string; badge: string }> = {
  INSERT:      { label: 'Creado',                badge: 'badge-success' },
  UPDATE:      { label: 'Modificado',            badge: 'badge-primary' },
  SOFT_DELETE: { label: 'Enviado a papelera',    badge: 'badge-danger' },
  RESTORE:     { label: 'Restaurado',            badge: 'badge-accent' },
  DELETE:      { label: 'Borrado físico',        badge: 'badge-danger' },
}

const fs = (v: number | null | undefined) => v != null ? formatSoles(v) : '—'

// Ícono "historial" (reloj con flecha antihoraria) para el botón por fila.
function IconHistorial() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 3v5h5" />
      <path d="M3.05 13A9 9 0 1 0 6 5.3L3 8" />
      <path d="M12 7v5l3 2" />
    </svg>
  )
}

// Ícono "columnas" para el botón de Editar encabezado.
function IconColumnas() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <line x1="9" y1="4" x2="9" y2="20" />
      <line x1="15" y1="4" x2="15" y2="20" />
    </svg>
  )
}

// Puntos de agarre del arrastre (⠿) en cada fila del editor de encabezado.
function IconArrastre() {
  return (
    <svg width="10" height="14" viewBox="0 0 10 14" fill="currentColor" aria-hidden>
      {[2, 7, 12].map(cy => (
        <Fragment key={cy}>
          <circle cx="2.5" cy={cy} r="1.2" />
          <circle cx="7.5" cy={cy} r="1.2" />
        </Fragment>
      ))}
    </svg>
  )
}

// ─── Componente principal ─────────────────────────────────────────

export default function CorporativoPage() {
  const { profile } = useAuth()
  const [tab, setTab] = useState<Tab>('registros')

  // Filtros persistidos: se recuerdan al cambiar de módulo o recargar.
  // Rango de fechas DESDE/HASTA; por defecto, el mes en curso.
  const [desde, setDesde] = usePersistedState('seguimiento.desde', primerDiaMesActual)
  const [hasta, setHasta] = usePersistedState('seguimiento.hasta', ultimoDiaMesActual)
  const [filtroTipos, setFiltroTipos] = usePersistedState<string[]>('seguimiento.filtroTipos', [])
  const [filtroEmpresas, setFiltroEmpresas] = usePersistedState<string[]>('seguimiento.filtroEmpresas', [])
  const [filtroEstado, setFiltroEstado] = usePersistedState<FiltroEstado>('seguimiento.filtroEstado', 'todos')
  const [vista, setVista] = useState<Vista>('activos')

  // Columnas visibles y su orden (editor de encabezado). Solo presentación.
  const [prefsRaw, setPrefs] = usePersistedState<ColPref[]>('seguimiento.columnas', PREFS_DEFECTO)
  const [menuCols, setMenuCols] = useState(false)
  const menuColsRef = useRef<HTMLDivElement>(null)
  const arrastreRef = useRef<number | null>(null)

  const desdeRef = useRef<HTMLInputElement>(null)
  const hastaRef = useRef<HTMLInputElement>(null)
  // true mientras se espera que el usuario elija "desde" para encadenar el
  // calendario de "hasta" (flujo del botón 📅).
  const encadenarHastaRef = useRef(false)

  // Catálogos: espejo local (Dexie) mantenido por el worker de sync.
  // Memoizados para que su identidad no cambie en cada render (los
  // useMemo/useEffect que dependen de ellos entrarían en bucle).
  const catalogos = useLiveQuery(leerCatalogos, [])
  const empresas = useMemo(() => catalogos?.empresas ?? [], [catalogos])
  const turnos = useMemo(() => catalogos?.turnos ?? [], [catalogos])
  const combustibles = useMemo(() => catalogos?.combustibles ?? [], [catalogos])

  // Alta de registros (modal) y edición EN LÍNEA (editId ≠ null resalta la fila)
  const [showModal, setShowModal] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [form, setForm] = useState<FormState>({ ...FORM_INIT })
  const [saving, setSaving] = useState(false)
  const [deleteId, setDeleteId] = useState<string | null>(null)

  // Historial de auditoría (clic sobre un registro)
  const [histRow, setHistRow] = useState<RegistroRow | null>(null)
  const [histLog, setHistLog] = useState<LogRow[]>([])
  const [histLoading, setHistLoading] = useState(false)
  const [perfiles, setPerfiles] = useState<Record<string, string>>({})

  // Registros del rango DESDE → HASTA (activos o papelera), en vivo desde
  // Dexie. Los cambios (propios o del pull del servidor) refrescan solos.
  const rowsLive = useLiveQuery(
    () => leerRegistrosRango(desde, hasta, vista),
    [desde, hasta, vista]
  )
  const loading = rowsLive === undefined
  const rows: RegistroRow[] = useMemo(() => rowsLive ?? [], [rowsLive])

  // Rangos fuera de la ventana hidratada (~35 días): se piden al servidor
  // en segundo plano y quedan cacheados. Sin conexión → se ve lo local.
  useEffect(() => {
    void asegurarRango(desde, hasta)
  }, [desde, hasta])

  // Cambiar de rango/vista cancela cualquier edición en curso (antes lo
  // hacía la recarga de red).
  useEffect(() => {
    setEditId(null)
  }, [desde, hasta, vista])

  // Rango coherente: si el usuario cruza las fechas, se corrige la otra.
  function cambiarDesde(v: string) {
    if (!v) return
    setDesde(v)
    if (hasta && v > hasta) setHasta(v)
    if (encadenarHastaRef.current) {
      encadenarHastaRef.current = false
      try { hastaRef.current?.showPicker() } catch { /* requiere gesto del usuario; se ignora */ }
    }
  }
  function cambiarHasta(v: string) {
    if (!v) return
    setHasta(v)
    if (desde && v < desde) setDesde(v)
  }
  // Botón 📅: abre el calendario de "desde" y, al elegir, encadena el de "hasta".
  function abrirCalendarios() {
    encadenarHastaRef.current = true
    try { desdeRef.current?.showPicker() } catch { desdeRef.current?.focus() }
  }
  function irMesActual() {
    setDesde(primerDiaMesActual())
    setHasta(ultimoDiaMesActual())
  }

  // Cada filtro solo ofrece las opciones compatibles con el otro, así nunca
  // se puede armar una combinación (ej. empresa de licitación + tipo
  // corporación) que jamás traería resultados.
  const tiposDisponibles = useMemo(() => {
    if (filtroEmpresas.length === 0) return [...TIPOS_ATENCION]
    const empresasSeleccionadas = empresas.filter(e => filtroEmpresas.includes(e.id))
    return TIPOS_ATENCION.filter(t => empresasSeleccionadas.some(e => e.tipo === t))
  }, [empresas, filtroEmpresas])

  const empresasDisponibles = useMemo(() => {
    if (filtroTipos.length === 0) return empresas
    return empresas.filter(e => filtroTipos.includes(e.tipo))
  }, [empresas, filtroTipos])

  // Si el otro filtro deja de admitir una opción ya marcada, se quita sola.
  useEffect(() => {
    setFiltroTipos(prev => {
      const next = prev.filter(t => tiposDisponibles.includes(t as typeof TIPOS_ATENCION[number]))
      return next.length === prev.length ? prev : next
    })
  }, [tiposDisponibles]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setFiltroEmpresas(prev => {
      const next = prev.filter(id => empresasDisponibles.some(e => e.id === id))
      return next.length === prev.length ? prev : next
    })
  }, [empresasDisponibles]) // eslint-disable-line react-hooks/exhaustive-deps

  const rowsFiltradas = useMemo(() => rows.filter(r => {
    if (filtroTipos.length > 0 && !filtroTipos.includes(r.tipo_atencion)) return false
    if (filtroEmpresas.length > 0 && !filtroEmpresas.includes(r.empresa_id ?? '')) return false
    if (filtroEstado !== 'todos' && r.estado_pago !== filtroEstado) return false
    return true
  }), [rows, filtroTipos, filtroEmpresas, filtroEstado])

  const totales = useMemo(() => {
    let galones = 0, importe = 0, pendiente = 0
    for (const r of rowsFiltradas) {
      galones += r.cantidad_galones
      importe += r.importe_centimos
      if (r.estado_pago === 'pendiente') pendiente += r.importe_centimos
    }
    return { galones, importe, pendiente }
  }, [rowsFiltradas])

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

  // Editar EN LÍNEA: no abre modal; la fila se resalta y el resto se opaca.
  function openEdit(row: RegistroRow) {
    setForm({
      fecha: row.fecha,
      empresa_id: row.empresa_id ?? '',
      tipo_atencion: row.tipo_atencion,
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
    setShowModal(false)
    setEditId(row.id)
  }

  function cancelEdit() {
    setEditId(null)
    setForm({ ...FORM_INIT })
  }

  async function handleSave() {
    const galones = parseFloat(form.cantidad_galones) || 0
    // turno_id es NOT NULL en la BD: se valida aquí para que el rechazo no
    // llegue diferido desde el sync (antes lo devolvía la red al instante).
    const turnoNum = parseInt(form.turno_id)
    if (!galones || !form.precio_unit || !form.tipo_combustible || !turnoNum || !profile) return
    setSaving(true)
    const precioCentimos = toCentimos(form.precio_unit)
    const importeCentimos = Math.round(galones * precioCentimos)
    const body = {
      fecha: form.fecha,
      empresa_id: form.empresa_id || null,
      tipo_atencion: form.tipo_atencion,
      serie: form.serie.trim() || null,
      numero: form.numero.trim() || null,
      turno_id: turnoNum,
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
    try {
      // El insert exige colaborador_id y tipo_documento (NOT NULL en
      // registro_ventas); en el update NO se mandan, para conservar al creador
      // original y no tocar un tipo_documento que la interfaz ya no expone.
      if (editId === null) {
        await insertRegistroVenta({
          ...body,
          colaborador_id: profile.id,
          tipo_documento: TIPO_DOC_FIJO,
          importe_declarado_centimos: null,
        })
      } else {
        await updateRegistroVenta(editId, body)
      }
    } catch (err) {
      setSaving(false)
      alert('Error al guardar el registro: ' + msgDe(err))
      return
    }
    setSaving(false)
    setShowModal(false)
    setEditId(null)
  }

  async function togglePago(row: RegistroRow) {
    const nuevo = row.estado_pago === 'pagado' ? 'pendiente' : 'pagado'
    try {
      await updateRegistroVenta(row.id, {
        estado_pago: nuevo,
        fecha_pago: nuevo === 'pagado' ? hoyLocal() : null,
      })
    } catch (err) {
      alert('Error al cambiar el estado de pago: ' + msgDe(err))
    }
  }

  // Soft delete: se marca deleted_at/deleted_by; el registro va a la papelera
  // (recuperable) y el trigger de auditoría deja constancia.
  async function confirmDelete() {
    if (!deleteId) return
    try {
      await softDeleteRegistroVenta(deleteId, profile?.id ?? null)
    } catch (err) {
      alert('Error al eliminar: ' + msgDe(err))
    }
    setDeleteId(null)
  }

  async function restaurar(id: string) {
    try {
      await restaurarRegistroVenta(id)
    } catch (err) {
      alert('Error al restaurar: ' + msgDe(err))
    }
  }

  // ─── Historial de auditoría ────────────────────────────────────

  async function abrirHistorial(row: RegistroRow) {
    setHistRow(row)
    setHistLoading(true)
    try {
      const [logRes, profRes] = await Promise.all([
        supabase
          .from('registro_ventas_log')
          .select('*')
          .eq('registro_id', row.id)
          .order('realizado_en', { ascending: false }),
        // Nombres para "quién hizo el cambio" (solo se trae una vez)
        Object.keys(perfiles).length === 0
          ? supabase.from('profiles').select('id, nombre')
          : Promise.resolve({ data: null }),
      ])
      setHistLog((logRes.data as LogRow[]) ?? [])
      if (profRes.data) {
        const map: Record<string, string> = {}
        for (const p of profRes.data as { id: string; nombre: string }[]) map[p.id] = p.nombre
        setPerfiles(map)
      }
    } catch (err) {
      console.error('Error al cargar historial:', err)
      setHistLog([])
    } finally {
      setHistLoading(false)
    }
  }

  // Presentación de un valor del log según el campo (moneda, catálogos, etc.)
  function fmtCampoLog(key: string, valor: unknown): string {
    if (valor == null || valor === '') return '—'
    switch (key) {
      case 'empresa_id':
        return empresas.find(e => e.id === valor)?.nombre ?? String(valor).slice(0, 8) + '…'
      case 'turno_id': {
        const idx = turnos.findIndex(t => t.id === valor)
        return idx >= 0 ? `Turno ${idx + 1}` : `T${valor}`
      }
      case 'tipo_atencion':
        return TIPO_LABELS[String(valor)] ?? String(valor)
      case 'precio_unit_centimos':
      case 'importe_centimos':
        return formatSoles(Number(valor))
      case 'cantidad_galones':
        return Number(valor).toFixed(3)
      default:
        return String(valor)
    }
  }

  // Diferencias campo a campo entre datos_old y datos_new de una entrada UPDATE
  function difLog(l: LogRow): { label: string; antes: string; despues: string }[] {
    if (!l.datos_old || !l.datos_new) return []
    const out: { label: string; antes: string; despues: string }[] = []
    for (const [key, label] of CAMPOS_LOG) {
      const a = l.datos_old[key] ?? null
      const b = l.datos_new[key] ?? null
      if (JSON.stringify(a) !== JSON.stringify(b)) {
        out.push({ label, antes: fmtCampoLog(key, a), despues: fmtCampoLog(key, b) })
      }
    }
    return out
  }

  const formImporte = useMemo(() => {
    const g = parseFloat(form.cantidad_galones) || 0
    return Math.round(g * toCentimos(form.precio_unit))
  }, [form.cantidad_galones, form.precio_unit])

  const canSave = !!(
    form.fecha && form.tipo_combustible &&
    parseFloat(form.cantidad_galones) > 0 && toCentimos(form.precio_unit) > 0
  )

  // Estilo compacto de los inputs de la edición en línea
  const cellInput = 'input h-6 w-full py-0 text-xs'

  // Nº de turno como en Ventas: la POSICIÓN (1..N) en la lista ordenada por id,
  // no el id ni el nombre. Así "Turno Tarde/Madrugada/Noche" se muestra 1-4 y
  // deja de desbordar la celda.
  const turnoNumero = useMemo(() => {
    const m: Record<number, number> = {}
    turnos.forEach((t, i) => { m[t.id] = i + 1 })
    return m
  }, [turnos])

  // ─── Encabezado configurable ───────────────────────────────────

  // Sanea lo persistido: descarta claves que ya no existen (p. ej. la vieja
  // "doc") y añade al final las columnas nuevas de una versión posterior.
  const prefs = useMemo(() => {
    const validas = prefsRaw.filter(p => p && p.k in COL_DEF)
    if (validas.length === 0) return PREFS_DEFECTO
    const faltantes = PREFS_DEFECTO.filter(d => !validas.some(v => v.k === d.k))
    return [...validas, ...faltantes]
  }, [prefsRaw])

  const cols = useMemo(() => prefs.filter(p => p.on).map(p => p.k), [prefs])
  const anchoTabla = useMemo(
    () => cols.reduce((t, k) => t + COL_DEF[k].width, 0),
    [cols],
  )

  // Toggle de visibilidad; nunca deja el encabezado sin columnas.
  function toggleCol(k: ColKey) {
    setPrefs(() => {
      if (cols.length === 1 && cols[0] === k) return prefs
      return prefs.map(p => (p.k === k ? { ...p, on: !p.on } : p))
    })
  }
  // Reordenar arrastrando: mueve la columna `desde` a la posición `hasta`.
  function moverCol(desdeIdx: number, hastaIdx: number) {
    if (desdeIdx === hastaIdx) return
    setPrefs(() => {
      const next = [...prefs]
      const [item] = next.splice(desdeIdx, 1)
      next.splice(hastaIdx, 0, item)
      return next
    })
  }

  // Cerrar el panel al hacer clic fuera o pulsar Escape.
  useEffect(() => {
    if (!menuCols) return
    const fuera = (e: MouseEvent) => {
      if (!menuColsRef.current?.contains(e.target as Node)) setMenuCols(false)
    }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenuCols(false) }
    document.addEventListener('mousedown', fuera)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('mousedown', fuera)
      document.removeEventListener('keydown', esc)
    }
  }, [menuCols])

  // ─── Celdas por columna ────────────────────────────────────────

  /** Control de edición en línea de una columna (sin el <td> que lo envuelve). */
  function controlEdicion(k: ColKey) {
    switch (k) {
      case 'fecha':
        return <input type="date" className={cellInput} value={form.fecha}
          onChange={e => setForm(p => ({ ...p, fecha: e.target.value }))} />
      case 'empresa':
        return (
          <select
            className={cellInput} value={form.empresa_id}
            onChange={e => {
              const emp = empresas.find(x => x.id === e.target.value)
              setForm(p => ({
                ...p,
                empresa_id: e.target.value,
                tipo_atencion: emp ? emp.tipo : p.tipo_atencion,
              }))
            }}
          >
            <option value="">— Sin empresa —</option>
            {empresas.map(e => <option key={e.id} value={e.id}>{e.nombre}</option>)}
          </select>
        )
      case 'tipo':
        return (
          <select className={cellInput} value={form.tipo_atencion}
            onChange={e => setForm(p => ({ ...p, tipo_atencion: e.target.value }))}>
            {TIPOS_ATENCION.map(t => <option key={t} value={t}>{TIPO_LABELS[t]}</option>)}
          </select>
        )
      case 'vale':
        return <input className={`${cellInput} font-mono`} placeholder="N° vale" value={form.numero}
          onChange={e => setForm(p => ({ ...p, numero: e.target.value }))} />
      case 'ticket':
        return <input className={`${cellInput} font-mono`} placeholder="Serie" value={form.serie}
          onChange={e => setForm(p => ({ ...p, serie: e.target.value }))} />
      case 'placa':
        return <input className={`${cellInput} font-mono uppercase`} value={form.placa}
          onChange={e => setForm(p => ({ ...p, placa: e.target.value.toUpperCase() }))} />
      case 'conductor':
        return <input className={cellInput} value={form.conductor}
          onChange={e => setForm(p => ({ ...p, conductor: e.target.value }))} />
      case 'dni':
        return <input className={`${cellInput} font-mono`} maxLength={8} value={form.dni_conductor}
          onChange={e => setForm(p => ({ ...p, dni_conductor: e.target.value }))} />
      case 'turno':
        return (
          <select className={cellInput} value={form.turno_id}
            onChange={e => setForm(p => ({ ...p, turno_id: e.target.value }))}>
            <option value="">—</option>
            {turnos.map((t, i) => <option key={t.id} value={t.id}>{i + 1}</option>)}
          </select>
        )
      case 'producto':
        return (
          <select className={cellInput} value={form.tipo_combustible}
            onChange={e => setForm(p => ({ ...p, tipo_combustible: e.target.value }))}>
            <option value="">—</option>
            {combustibles.map(c => <option key={c.codigo} value={c.codigo}>{c.codigo}</option>)}
          </select>
        )
      case 'galones':
        return <input type="number" min="0" step="0.001" className={`${cellInput} text-right font-mono`}
          value={form.cantidad_galones}
          onChange={e => setForm(p => ({ ...p, cantidad_galones: e.target.value }))} />
      case 'precio':
        return <input type="number" min="0" step="0.01" className={`${cellInput} text-right font-mono`}
          value={form.precio_unit}
          onChange={e => setForm(p => ({ ...p, precio_unit: e.target.value }))} />
      case 'importe':
        return <span className="block text-right font-mono text-xs font-semibold">{fs(formImporte)}</span>
      case 'factura':
        return <input className={`${cellInput} font-mono`} placeholder="F001-…" value={form.factura_numero}
          onChange={e => setForm(p => ({ ...p, factura_numero: e.target.value }))} />
      case 'estado':
        return (
          <select
            className={cellInput} value={form.estado_pago}
            onChange={e => {
              const v = e.target.value as 'pendiente' | 'pagado'
              setForm(p => ({
                ...p,
                estado_pago: v,
                fecha_pago: v === 'pagado' ? (p.fecha_pago || hoyLocal()) : '',
              }))
            }}
          >
            <option value="pendiente">Pendiente</option>
            <option value="pagado">Pagado</option>
          </select>
        )
      case 'acciones':
        return (
          <div className="flex gap-1">
            <button
              className="btn-primary px-2 py-0.5 text-xs"
              onClick={handleSave}
              disabled={saving || !canSave}
            >
              {saving ? '…' : 'Guardar'}
            </button>
            <button className="btn-ghost px-1.5 py-0.5 text-xs" onClick={cancelEdit}>
              Cancelar
            </button>
          </div>
        )
    }
  }

  /** Contenido de una columna en modo lectura. */
  function contenidoVista(k: ColKey, row: RegistroRow) {
    switch (k) {
      case 'fecha':     return row.fecha
      case 'empresa':   return row.empresa_nombre ?? <span className="text-app-muted">—</span>
      case 'tipo':      return (
        <span className={`badge ${tipoBadgeClass(row.tipo_atencion)}`}>
          {TIPO_LABELS[row.tipo_atencion] ?? row.tipo_atencion}
        </span>
      )
      case 'vale':      return row.numero || '—'
      case 'ticket':    return row.serie || '—'
      case 'placa':     return row.placa || '—'
      case 'conductor': return row.conductor || '—'
      case 'dni':       return row.dni_conductor || '—'
      case 'turno':     return turnoNumero[row.turno_id] ?? row.turno_id
      case 'producto':  return row.tipo_combustible
      case 'galones':   return row.cantidad_galones.toFixed(3)
      case 'precio':    return fs(row.precio_unit_centimos)
      case 'importe':   return fs(row.importe_centimos)
      case 'factura':   return row.factura_numero ?? '—'
      case 'estado':    return vista === 'papelera' ? (
        <span
          className="badge badge-danger"
          title={row.deleted_at ? `Eliminado el ${new Date(row.deleted_at).toLocaleString('es-PE')}` : undefined}
        >
          Eliminado
        </span>
      ) : (
        <button
          onClick={() => togglePago(row)}
          className={`badge cursor-pointer transition-opacity hover:opacity-75 ${
            row.estado_pago === 'pagado' ? 'badge-success' : 'badge-danger'
          }`}
        >
          {row.estado_pago === 'pagado' ? 'Pagado' : 'Pendiente'}
        </button>
      )
      case 'acciones': return (
        <div className="flex items-center gap-1">
          {/* Historial: botón propio (ya NO es clic en toda la fila) */}
          <button
            className="btn-ghost px-1 text-xs"
            onClick={() => abrirHistorial(row)}
            title="Ver historial de cambios"
          >
            <IconHistorial />
          </button>
          {vista === 'papelera' ? (
            <button className="btn-ghost text-xs text-success-text" onClick={() => restaurar(row.id)}>
              ↩ Restaurar
            </button>
          ) : (
            <>
              <button className="btn-ghost text-xs" onClick={() => openEdit(row)}>
                Editar
              </button>
              <button
                className="btn-ghost text-xs text-danger-text"
                onClick={() => setDeleteId(row.id)}
              >
                ✕
              </button>
            </>
          )}
        </div>
      )
    }
  }

  // Clases de la celda en modo lectura (tipografía por columna).
  const CLASE_VISTA: Record<ColKey, string> = {
    fecha: 'font-mono text-xs',
    empresa: 'truncate',
    tipo: '',
    vale: 'font-mono text-xs',
    ticket: 'font-mono text-xs',
    placa: 'font-mono text-xs',
    conductor: 'truncate text-xs',
    dni: 'font-mono text-xs',
    turno: 'text-center text-xs font-medium',
    producto: 'text-xs font-medium',
    galones: 'text-right font-mono text-xs',
    precio: 'text-right font-mono text-xs',
    importe: 'text-right font-mono text-xs font-medium',
    factura: 'font-mono text-xs',
    estado: '',
    acciones: '',
  }

  /**
   * Fila de totales adaptada al encabezado: la etiqueta ocupa las columnas
   * anteriores a la primera que lleva número, y de ahí en adelante cada columna
   * imprime su valor (o nada).
   */
  function filaTotales(
    label: string,
    valores: Partial<Record<ColKey, ReactNode>>,
    trClass: string,
    tdClass = '',
  ) {
    const primera = cols.findIndex(k => k in valores)
    const corte = Math.max(primera === -1 ? cols.length : primera, 1)
    return (
      <tr className={trClass}>
        <td colSpan={corte} className={`px-2 py-1 text-xs ${tdClass || 'text-app-muted'}`}>{label}</td>
        {cols.slice(corte).map(k => (
          <td key={k} className={`px-2 py-1 text-right font-mono text-xs ${tdClass}`}>
            {valores[k] ?? null}
          </td>
        ))}
      </tr>
    )
  }

  // ─── Render ───────────────────────────────────────────────────

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col overflow-hidden">

      {/* ── Barra superior ── */}
      <div className="border-b border-app-border bg-white px-4 py-2">
        <div className="flex flex-wrap items-center gap-2">

          {/* Tabs */}
          <div className="flex gap-1">
            {([['registros', 'Registros'], ['resumen', 'Por Empresa']] as [Tab, string][]).map(([k, l]) => (
              <button key={k} onClick={() => { setTab(k); if (k === 'resumen') setVista('activos') }}
                className={`rounded px-2.5 py-1 text-xs transition-colors duration-150 ${
                  tab === k
                    ? 'bg-primary text-primary-text font-medium'
                    : 'text-app-muted hover:bg-app-border hover:text-app-text'
                }`}
              >{l}</button>
            ))}
          </div>

          <div className="mx-1 h-4 w-px bg-app-border" />

          {/* Rango de fechas DESDE → HASTA (se puede escribir o elegir en calendario) */}
          <button
            className="btn-ghost px-1.5 py-1"
            onClick={abrirCalendarios}
            title="Elegir el rango en los calendarios (desde y luego hasta)"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <rect x="3" y="4" width="18" height="17" rx="2" />
              <line x1="16" y1="2" x2="16" y2="6" />
              <line x1="8" y1="2" x2="8" y2="6" />
              <line x1="3" y1="10" x2="21" y2="10" />
            </svg>
          </button>
          <div className="flex items-center gap-1">
            <span className="text-[10px] font-bold text-app-muted">DESDE</span>
            <input
              ref={desdeRef}
              type="date" value={desde} max={hasta || undefined}
              onChange={e => cambiarDesde(e.target.value)}
              className="input text-xs" style={{ width: 132 }}
            />
            <span className="text-[10px] font-bold text-app-muted">HASTA</span>
            <input
              ref={hastaRef}
              type="date" value={hasta} min={desde || undefined}
              onChange={e => cambiarHasta(e.target.value)}
              className="input text-xs" style={{ width: 132 }}
            />
            <button
              className="btn-ghost px-1.5 py-0.5 text-[11px]"
              onClick={irMesActual}
              title="Volver al mes en curso"
            >
              Mes actual
            </button>
          </div>

          {tab === 'registros' && (
            <>
              <MultiSelectDropdown
                options={tiposDisponibles.map(t => ({ value: t, label: TIPO_LABELS[t] }))}
                selected={filtroTipos}
                onChange={setFiltroTipos}
                placeholder="Todos los tipos"
                className="text-xs" style={{ width: 150 }}
                showChevron={false}
              />

              <MultiSelectDropdown
                options={empresasDisponibles.map(e => ({ value: e.id, label: e.nombre }))}
                selected={filtroEmpresas}
                onChange={setFiltroEmpresas}
                placeholder="Todas las empresas"
                className="text-xs" style={{ width: 190 }}
              />

              <select
                value={filtroEstado}
                onChange={e => setFiltroEstado(e.target.value as FiltroEstado)}
                className="input text-xs" style={{ width: 110 }}
              >
                <option value="todos">Todos</option>
                <option value="pendiente">Pendiente</option>
                <option value="pagado">Pagado</option>
              </select>

              {/* Papelera: registros con soft delete, restaurables */}
              <button
                onClick={() => setVista(v => v === 'papelera' ? 'activos' : 'papelera')}
                className={`rounded border px-2 py-1 text-xs transition-colors ${
                  vista === 'papelera'
                    ? 'border-danger-dark bg-danger text-danger-text font-medium'
                    : 'border-app-border text-app-muted hover:bg-app-border hover:text-app-text'
                }`}
                title="Ver los registros eliminados (se pueden restaurar)"
              >
                🗑 Papelera
              </button>

              {/* Editar encabezado: qué columnas se ven y en qué orden */}
              <div className="relative" ref={menuColsRef}>
                <button
                  onClick={() => setMenuCols(v => !v)}
                  className={`flex items-center gap-1 rounded border px-2 py-1 text-xs transition-colors ${
                    menuCols
                      ? 'border-primary bg-primary text-primary-text font-medium'
                      : 'border-app-border text-app-muted hover:bg-app-border hover:text-app-text'
                  }`}
                  title="Elegir qué columnas se muestran y en qué orden (no afecta a los datos)"
                >
                  <IconColumnas />
                  Editar encabezado
                </button>

                {menuCols && (
                  <div className="absolute left-0 top-full z-30 mt-1 w-64 rounded-lg border border-app-border bg-white p-2 shadow-lg">
                    <div className="mb-1.5 flex items-baseline justify-between gap-2 px-1">
                      <span className="text-[11px] font-semibold text-app-text">Columnas</span>
                      <button
                        className="text-[11px] text-app-muted underline-offset-2 hover:text-app-text hover:underline"
                        onClick={() => setPrefs(() => PREFS_DEFECTO.map(p => ({ ...p })))}
                      >
                        Restablecer
                      </button>
                    </div>
                    <p className="mb-1.5 px-1 text-[10px] leading-snug text-app-muted">
                      Marca las que quieras ver y arrastra ⠿ para cambiar el orden.
                    </p>
                    <ul className="max-h-72 overflow-y-auto">
                      {prefs.map((p, i) => (
                        <li
                          key={p.k}
                          draggable
                          onDragStart={() => { arrastreRef.current = i }}
                          onDragEnd={() => { arrastreRef.current = null }}
                          onDragOver={e => {
                            e.preventDefault()
                            const desdeIdx = arrastreRef.current
                            if (desdeIdx == null || desdeIdx === i) return
                            moverCol(desdeIdx, i)
                            arrastreRef.current = i
                          }}
                          className="flex cursor-grab items-center gap-2 rounded px-1 py-1 hover:bg-slate-50 active:cursor-grabbing"
                        >
                          <span className="text-app-muted"><IconArrastre /></span>
                          <label className="flex flex-1 cursor-pointer items-center gap-2 text-xs text-app-text">
                            <input
                              type="checkbox"
                              checked={p.on}
                              onChange={() => toggleCol(p.k)}
                              className="h-3.5 w-3.5 accent-blue-600"
                            />
                            {COL_DEF[p.k].label}
                          </label>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </>
          )}

          {vista === 'activos' && (
            <button className="btn-primary ml-auto text-xs" onClick={openNew}>
              + Nuevo registro
            </button>
          )}
        </div>
      </div>

      {/* ── Contenido ── */}
      <div className="flex-1 overflow-auto">
        {loading ? (
          <p className="p-6 text-sm text-app-muted">Cargando…</p>
        ) : tab === 'registros' ? (
          <table className="table-excel table-fixed" style={{ minWidth: anchoTabla }}>
            <thead>
              <tr>
                {cols.map(k => (
                  <th key={k} className={COL_ALIGN[k]} style={{ width: COL_DEF[k].width }}>
                    {COL_DEF[k].label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rowsFiltradas.map(row => {
                const enEdicion = editId === row.id
                const otraEnEdicion = editId !== null && !enEdicion

                // ── Fila en edición: inputs en línea, fila resaltada ──
                if (enEdicion) {
                  // Los campos cuya columna está oculta se editan en la segunda
                  // fila, para que ocultar una columna nunca impida corregirla.
                  // `importe` se calcula, así que nunca es editable.
                  const ocultosEditables = COLUMNAS
                    .map(c => c.key)
                    .filter(k => k !== 'importe' && k !== 'acciones' && !cols.includes(k))
                  return (
                    <Fragment key={row.id}>
                      <tr className="!bg-blue-50">
                        {cols.map(k => <td key={k}>{controlEdicion(k)}</td>)}
                      </tr>
                      {/* Campos secundarios de la misma edición (sin modal) */}
                      <tr className="!bg-blue-50">
                        <td colSpan={cols.length} className="!whitespace-normal">
                          <div className="flex flex-wrap items-end gap-3 px-1 py-1">
                            {ocultosEditables.map(k => (
                              <label key={k} className="flex items-center gap-1 text-[11px] text-app-muted">
                                {COL_DEF[k].label}
                                <span className="inline-block" style={{ width: Math.max(COL_DEF[k].width, 96) }}>
                                  {controlEdicion(k)}
                                </span>
                              </label>
                            ))}
                            <label className="flex items-center gap-1 text-[11px] text-app-muted">
                              Empresa facturación
                              <input
                                className="input h-6 w-44 py-0 text-xs"
                                value={form.empresa_facturacion}
                                onChange={e => setForm(p => ({ ...p, empresa_facturacion: e.target.value }))}
                              />
                            </label>
                            <label className="flex items-center gap-1 text-[11px] text-app-muted">
                              Fecha facturación
                              <input
                                type="date" className="input h-6 w-32 py-0 text-xs"
                                value={form.fecha_facturacion}
                                onChange={e => setForm(p => ({ ...p, fecha_facturacion: e.target.value }))}
                              />
                            </label>
                            {form.estado_pago === 'pagado' && (
                              <label className="flex items-center gap-1 text-[11px] text-app-muted">
                                Fecha de pago
                                <input
                                  type="date" className="input h-6 w-32 py-0 text-xs"
                                  value={form.fecha_pago}
                                  onChange={e => setForm(p => ({ ...p, fecha_pago: e.target.value }))}
                                />
                              </label>
                            )}
                            <span className="ml-auto text-[11px] italic text-primary-text">
                              ✎ Editando este registro
                            </span>
                          </div>
                        </td>
                      </tr>
                    </Fragment>
                  )
                }

                // ── Fila normal (se opaca si otra fila está en edición) ──
                return (
                  <tr
                    key={row.id}
                    className={`${otraEnEdicion
                      ? 'pointer-events-none select-none opacity-30'
                      : ''} ${row.deleted_at ? 'text-app-muted' : ''}`}
                  >
                    {cols.map(k => (
                      <td key={k} className={CLASE_VISTA[k]}>{contenidoVista(k, row)}</td>
                    ))}
                  </tr>
                )
              })}

              {rowsFiltradas.length === 0 && (
                <tr>
                  <td colSpan={cols.length} className="py-10 text-center text-sm text-app-muted">
                    {vista === 'papelera'
                      ? 'La papelera está vacía para el periodo y filtros seleccionados'
                      : 'Sin registros para los filtros seleccionados'}
                  </td>
                </tr>
              )}
            </tbody>

            {rowsFiltradas.length > 0 && (
              <tfoot>
                {filaTotales(
                  `TOTALES — ${rowsFiltradas.length} registros`,
                  { galones: totales.galones.toFixed(3), importe: fs(totales.importe) },
                  'bg-slate-100 font-semibold',
                )}
                {vista === 'activos' && totales.pendiente > 0 && filaTotales(
                  'PENDIENTE DE COBRO',
                  { importe: fs(totales.pendiente) },
                  'bg-red-50',
                  'font-semibold text-danger-text',
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
                      Sin registros en el periodo seleccionado
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Modal nuevo registro ── */}
      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div
            className="modal-box max-h-[90vh] max-w-2xl overflow-y-auto p-5"
            onClick={e => e.stopPropagation()}
          >
            <h3 className="mb-4 text-sm font-semibold">Nuevo Registro</h3>

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
                    {turnos.map((t, i) => (
                      <option key={t.id} value={t.id}>Turno {i + 1}</option>
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

              {/* Vale Lic. + Ticket */}
              <div className="flex gap-2">
                <div className="flex-1">
                  <label className="mb-1 block text-xs text-app-muted">Vale Lic. (N°)</label>
                  <input
                    className="input font-mono" value={form.numero} placeholder="00001"
                    onChange={e => setForm(p => ({ ...p, numero: e.target.value }))}
                  />
                </div>
                <div className="flex-1">
                  <label className="mb-1 block text-xs text-app-muted">Ticket (serie)</label>
                  <input
                    className="input font-mono" value={form.serie} placeholder="001"
                    onChange={e => setForm(p => ({ ...p, serie: e.target.value }))}
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

      {/* ── Modal confirmar eliminación (soft delete) ── */}
      {deleteId && (
        <div className="modal-overlay" onClick={() => setDeleteId(null)}>
          <div className="modal-box p-5" onClick={e => e.stopPropagation()}>
            <p className="mb-1 text-sm font-medium text-app-text">¿Eliminar este registro?</p>
            <p className="mb-4 text-xs text-app-muted">
              Se moverá a la papelera 🗑 y podrá restaurarse cuando se necesite.
              Nada se borra definitivamente de la base de datos.
            </p>
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

      {/* ── Modal historial de auditoría ── */}
      {histRow && (
        <div className="modal-overlay" onClick={() => setHistRow(null)}>
          <div
            className="modal-box max-h-[85vh] max-w-2xl overflow-y-auto p-5"
            onClick={e => e.stopPropagation()}
          >
            <div className="mb-1 flex items-baseline justify-between gap-2">
              <h3 className="text-sm font-semibold">Historial de cambios</h3>
              <span className="font-mono text-[10px] text-app-muted" title="ID único del registro (Supabase)">
                {histRow.id}
              </span>
            </div>
            <p className="mb-4 text-xs text-app-muted">
              {histRow.fecha} · {histRow.empresa_nombre ?? 'Sin empresa'} · {histRow.tipo_combustible}{' '}
              · {histRow.cantidad_galones.toFixed(3)} gal · {fs(histRow.importe_centimos)}
            </p>

            {histLoading ? (
              <p className="py-6 text-center text-sm text-app-muted">Cargando historial…</p>
            ) : histLog.length === 0 ? (
              <p className="py-6 text-center text-sm text-app-muted">
                Este registro no tiene historial (es anterior a la activación de la auditoría).
              </p>
            ) : (
              <div className="space-y-3">
                {histLog.map(l => {
                  const meta = ACCION_META[l.accion]
                  const difs = l.accion === 'UPDATE' ? difLog(l) : []
                  return (
                    <div key={l.id} className="rounded border border-app-border bg-slate-50 p-2.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`badge ${meta.badge}`}>{meta.label}</span>
                        <span className="text-xs text-app-text">
                          {new Date(l.realizado_en).toLocaleString('es-PE')}
                        </span>
                        <span className="ml-auto text-xs text-app-muted">
                          por {l.usuario_id ? (perfiles[l.usuario_id] ?? 'usuario desconocido') : 'sistema'}
                        </span>
                      </div>

                      {l.accion === 'INSERT' && l.datos_new && (() => {
                        const dn = l.datos_new
                        // Mostrar TODOS los campos con los que se creó la fila
                        // (no solo un resumen): conductor, DNI, placa, ticket, etc.
                        const filas = CAMPOS_LOG
                          .map(([key, label]) => ({ key, label, valor: dn[key] }))
                          .filter(f => f.valor != null && f.valor !== '')
                        return (
                          <table className="mt-1.5 w-full text-xs">
                            <tbody>
                              {filas.map(f => (
                                <tr key={f.key}>
                                  <td className="w-40 py-0.5 pr-2 font-medium text-app-muted">{f.label}</td>
                                  <td className="py-0.5 font-mono text-app-text">{fmtCampoLog(f.key, f.valor)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )
                      })()}

                      {l.accion === 'UPDATE' && (
                        difs.length === 0 ? (
                          <p className="mt-1.5 text-xs italic text-app-muted">Cambios en campos internos</p>
                        ) : (
                          <table className="mt-1.5 w-full text-xs">
                            <tbody>
                              {difs.map((d, i) => (
                                <tr key={i}>
                                  <td className="w-36 py-0.5 pr-2 font-medium text-app-muted">{d.label}</td>
                                  <td className="py-0.5 pr-1 text-right font-mono text-danger-text line-through">{d.antes}</td>
                                  <td className="w-5 text-center text-app-muted">→</td>
                                  <td className="py-0.5 font-mono font-medium text-success-text">{d.despues}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )
                      )}
                    </div>
                  )
                })}
              </div>
            )}

            <div className="mt-4 flex justify-end">
              <button className="btn-ghost text-xs" onClick={() => setHistRow(null)}>
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
