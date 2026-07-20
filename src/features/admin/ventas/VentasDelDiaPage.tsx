import { useState, useEffect, useCallback, useMemo, useRef, Fragment } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/features/auth/useAuth'
import { hoyLocal, esFechaValida } from '@/lib/date'
import { formatSoles, toCentimos, sumCentimos } from '@/lib/money'
// Local-first: la página lee y escribe SIEMPRE en la base local (Dexie);
// el worker de sync replica contra Supabase por detrás. Por eso ya no hay
// "loadDia": useLiveQuery re-renderiza solo ante cualquier cambio local.
import {
  leerCatalogos,
  leerDia,
  leerCierresRango,
  insertRegistroVenta,
  updateRegistroVenta,
  softDeleteRegistroVenta,
  upsertCierreCaja,
  upsertPrecioDiario,
  leerReportesDia,
} from '@/lib/local/repo'
import { asegurarRango, sincronizarAhora } from '@/lib/local/sync'
import ConsolaUploader, { ConsolaPanel } from './ConsolaUploader'
import Combobox from '@/components/Combobox'
import CeldaGrid from '@/components/CeldaGrid'
import { useGridHoja, type GridHoja } from '@/lib/useGridHoja'

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
  dscto_vales_centimos: number
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
  /** Total tomado de la consola al registrar en ABREVIADO. NULL si nació en COMPLETO. */
  importe_declarado_centimos: number | null
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
  dscto_vales: string
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
  dscto_vales_centimos: number
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

// Buffer editable en línea para cada fila de `registro_ventas` (modo Completo)
interface RegistroInputs {
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

// ─── Grid de la tabla Completo (navegación tipo hoja de cálculo) ──
// Las columnas se numeran por su posición en el <tr>. FECHA (0) y ACCIONES (12)
// quedan fuera del grid: no aportan nada al copiar ni al navegar.
const COL_MIN = 1
const COL_MAX = 11

const COL_CLIENTE = 1
const COL_TURNO = 7
const COL_PRODUCTO = 8
const COL_GALONES = 9
const COL_IMPORTE = 10

/** Campo del buffer editable que corresponde a cada columna navegable. */
const CAMPO_POR_COL: Record<number, keyof RegistroInputs> = {
  [COL_CLIENTE]: 'empresa_id',
  2: 'numero',            // VALE LIC.
  3: 'serie',             // TICKET
  4: 'placa',             // PLACA
  5: 'conductor',         // CONDUCTOR
  6: 'dni_conductor',     // DNI
  [COL_TURNO]: 'turno_id',
  [COL_PRODUCTO]: 'tipo_combustible',
  [COL_GALONES]: 'cantidad_galones',
  [COL_IMPORTE]: 'importe', // solo editable si GALONES = 0
}

/** Columnas de texto libre: aceptan teclear encima, pegar y borrar con Supr. */
const COLS_TEXTO = new Set([2, 3, 4, 5, 6, COL_GALONES, COL_IMPORTE])
/** Columnas numéricas: se filtra lo que se teclea y lo que se pega. */
const COLS_NUM = new Set([COL_GALONES, COL_IMPORTE])

/** Fila 0 = fila de entrada rápida; fila i+1 = registros[i]. */
const FILA_NUEVA = 0

// ─── Grid de la tabla de Turnos ───────────────────────────────────
// TURNO (0) queda fuera del grid. Las columnas editables van de 1 a 5
// (TOTAL CONSOLA … DSCTOS VALES); las de después se corren según el modo,
// porque los créditos ocupan 4 columnas en COMPLETO y una sola en ABREVIADO.
const T_COL_CREDITO = 6

/** Opciones de una celda editable del grid. */
interface OpcionesCelda {
  numero?: boolean
  /** Admite signo negativo (hoy solo REDONDEO). */
  negativo?: boolean
  step?: string
  maxLength?: number
  mayusculas?: boolean
  placeholder?: string
  className?: string
  style?: React.CSSProperties
  /** Anexo bajo el valor, fuera de edición (p. ej. el redondeo sugerido). */
  pie?: React.ReactNode
}

// ─── Helpers ──────────────────────────────────────────────────────

/** Vuelca un cierre de caja al formato del buffer editable de la tabla de turnos. */
function aShiftInputs(c?: CierreRow): ShiftInputs {
  // Los valores en 0 quedan como '' para verse como placeholder y evitar que al
  // escribir se antepongan dígitos (ej. "50" en vez de "5"). TOTAL CONSOLA,
  // ENTREGADO y CONTABILIZADO sí distinguen "cero" de "sin registrar".
  const sinCero = (v: number | null | undefined) => (v ? (v / 100).toFixed(2) : '')
  const conCero = (v: number | null | undefined) => (v != null ? (v / 100).toFixed(2) : '')
  return {
    total_consola: conCero(c?.total_consola_centimos),
    yape: sinCero(c?.yape_centimos),
    openpay: sinCero(c?.openpay_centimos),
    deposito: sinCero(c?.deposito_transferencia_centimos),
    dscto_vales: sinCero(c?.dscto_vales_centimos),
    serafinado: sinCero(c?.serafinado_centimos),
    redondeo: sinCero(c?.redondeo_centimos),
    entregado_grifero: conCero(c?.entregado_grifero_centimos),
    contabilizado_admin: conCero(c?.contabilizado_admin_centimos),
    colaborador_id: c?.colaborador_id ?? '',
  }
}

/** Vuelca una fila de la BD al formato del buffer editable. */
function aInputs(r: RegistroRow): RegistroInputs {
  return {
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
  }
}

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
    c.dscto_vales_centimos -
    totalCreditos -
    c.serafinado_centimos +
    c.redondeo_centimos
  )
}

const fs = (v: number | null | undefined) => (v != null ? formatSoles(v) : '—')

// La fecha de trabajo sobrevive a ir y volver de otra pestaña (la página se
// desmonta), pero NO a cerrar el navegador: al día siguiente se vuelve a abrir
// en hoy y no se registra por error sobre la fecha de ayer.
const FECHA_KEY = 'ventas.fecha'

function fechaInicial(): string {
  const guardada = sessionStorage.getItem(FECHA_KEY)
  return esFechaValida(guardada) ? guardada : hoyLocal()
}

export default function VentasPage() {
  const { profile } = useAuth()

  // Control de vista
  const [activeTab, setActiveTab] = useState<Tab>('registro')
  const [modo, setModo] = useState<Modo>('abreviado')

  // ─── ESTADO: REGISTRO DIARIO (local-first) ──────────────────────
  const [fecha, setFecha] = useState(fechaInicial)

  // Los datos del día viven en Dexie: useLiveQuery re-emite ante cualquier
  // cambio local (edición propia o pull del servidor). Nada de loadDia.
  const dia = useLiveQuery(
    () => (esFechaValida(fecha) ? leerDia(fecha) : Promise.resolve(null)),
    [fecha]
  )
  const loadingDia = dia === undefined

  const cierresMap = useMemo(() => {
    const map: Record<number, CierreRow> = {}
    for (const c of dia?.cierres ?? []) map[c.turno_id] = c
    return map
  }, [dia])

  const registros: RegistroRow[] = useMemo(() => dia?.registros ?? [], [dia])

  const [precios, setPrecios] = useState({ db5: '', regular: '', premium: '' })

  // Siembra los inputs de precio cuando cambia la fila de precios local.
  // Deps finas (id/updated_at): un cambio en registros o cierres del día
  // no debe pisar un precio a medio tipear.
  useEffect(() => {
    if (dia === undefined) return
    const pd = dia?.precioRow
    if (pd) {
      setPrecios({
        db5: (pd.precio_db5_centimos / 100).toFixed(2),
        regular: (pd.precio_regular_centimos / 100).toFixed(2),
        premium: (pd.precio_premium_centimos / 100).toFixed(2),
      })
    } else {
      setPrecios({ db5: '', regular: '', premium: '' })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dia?.precioRow?.id, dia?.precioRow?.updated_at, dia === undefined, fecha])
  const [savingPrecios, setSavingPrecios] = useState(false)
  const [savingReg, setSavingReg] = useState(false)
  // Reajuste de filas valoradas a un precio viejo (ver `filasDesfasadas`).
  const [reajustando, setReajustando] = useState(false)
  const [avisoDescartado, setAvisoDescartado] = useState('')
  const [nuevo, setNuevo] = useState<NuevoReg>({ ...NUEVO_VACIO })

  // Corregir fecha (mover un día completo a otra fecha, solo si el destino está vacío)
  const [showFixDate, setShowFixDate] = useState(false)
  const [fixDateTarget, setFixDateTarget] = useState('')
  const [fixingDate, setFixingDate] = useState(false)

  // Inputs editables de los turnos
  const [inputsMap, setInputsMap] = useState<Record<number, ShiftInputs>>({})

  // Registro rápido de créditos (Abreviado)
  const [quickTurno, setQuickTurno] = useState('1')
  const [quickMonto, setQuickMonto] = useState('')
  const [savingQuick, setSavingQuick] = useState(false)

  // Edición en línea para registros (Completo) — cada fila es editable directamente,
  // sin un modo "editar" explícito, igual que la Tabla de Turnos de arriba.
  const [regInputsMap, setRegInputsMap] = useState<Record<string, RegistroInputs>>({})

  // Un único nivel de deshacer por tabla, a nivel de celda (ver `deshacer`).
  const [ultimoCambio, setUltimoCambio] =
    useState<{ id: string; campo: keyof RegistroInputs; anterior: string } | null>(null)
  const [ultimoCambioTurno, setUltimoCambioTurno] =
    useState<{ turnoId: number; campo: keyof ShiftInputs; anterior: string } | null>(null)

  // Guard síncrono: `savingReg` viaja por setState y no frena dos disparos
  // seguidos del guardado de la fila nueva (p. ej. blur + clic en "+ Agregar").
  const guardandoNuevoRef = useRef(false)

  // Los dos grids de la página se crean más abajo (necesitan callbacks que aún
  // no existen aquí). Estos refs los enlazan para que solo uno tenga selección a
  // la vez: en una hoja de cálculo hay una única celda activa.
  const soltarTurnos = useRef(() => {})
  const soltarRegistros = useRef(() => {})

  // Catálogos de referencia (espejo local, lo mantiene el worker de sync).
  // Memoizados: un `?? []` a secas crearía un array nuevo por render y los
  // efectos que dependen de ellos (p. ej. inputsMap) entrarían en bucle.
  const catalogos = useLiveQuery(leerCatalogos, [])
  const turnos = useMemo(() => catalogos?.turnos ?? [], [catalogos])
  const empresas = useMemo(() => catalogos?.empresas ?? [], [catalogos])
  const combustibles = useMemo(() => catalogos?.combustibles ?? [], [catalogos])
  const colaboradores = useMemo(() => catalogos?.colaboradores ?? [], [catalogos])

  // ─── ESTADO: HISTORIAL MENSUAL ──────────────────────────────────
  const [selectedMonth, setSelectedMonth] = useState(() => {
    const d = new Date()
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    return `${y}-${m}`
  })
  // (loadingHistorial y cierresHistorial ahora se derivan del liveQuery de abajo)

  // ── Turno por defecto de la fila de entrada (cuando llega el catálogo) ──
  useEffect(() => {
    if (turnos.length > 0) {
      setNuevo(prev => (prev.turno_id ? prev : { ...prev, turno_id: String(turnos[0].id) }))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [turnos])

  // ── Corregir fecha: mover todo lo registrado hoy a otra fecha ──
  // Solo permitido si el destino no tiene absolutamente ningún dato
  // (evita fusiones o sobrescrituras silenciosas de información real).
  // Operación de reparación poco frecuente: se hace directo contra Supabase
  // (mover 3 tablas por fecha con verificación del destino exige la vista
  // completa del servidor, no la ventana local). Requiere conexión.
  async function handleFixDate() {
    if (!esFechaValida(fixDateTarget) || fixDateTarget === fecha) return
    if (!navigator.onLine) {
      alert('Corregir la fecha requiere conexión a internet.')
      return
    }
    setFixingDate(true)
    try {
      const [regCheck, cierreCheck, precioCheck] = await Promise.all([
        supabase.from('registro_ventas').select('id').eq('fecha', fixDateTarget).is('deleted_at', null).limit(1),
        supabase.from('cierres_caja').select('id').eq('fecha', fixDateTarget).limit(1),
        supabase.from('precios_diarios').select('id').eq('fecha', fixDateTarget).limit(1),
      ])
      const yaTieneDatos =
        (regCheck.data?.length ?? 0) > 0 ||
        (cierreCheck.data?.length ?? 0) > 0 ||
        (precioCheck.data?.length ?? 0) > 0

      if (yaTieneDatos) {
        alert(
          `La fecha ${fixDateTarget} ya tiene información registrada. ` +
          'La corrección de fecha solo puede hacerse hacia un día completamente vacío.'
        )
        return
      }

      const [regErr, cierreErr, precioErr] = await Promise.all([
        supabase.from('registro_ventas').update({ fecha: fixDateTarget }).eq('fecha', fecha),
        supabase.from('cierres_caja').update({ fecha: fixDateTarget }).eq('fecha', fecha),
        supabase.from('precios_diarios').update({ fecha: fixDateTarget }).eq('fecha', fecha),
      ])
      const error = regErr.error || cierreErr.error || precioErr.error
      if (error) throw error

      setShowFixDate(false)
      setFixDateTarget('')
      // Refleja el movimiento en la base local (el pull trae las filas con
      // su fecha nueva; las viejas quedan pisadas por updated_at).
      await sincronizarAhora()
      setFecha(fixDateTarget)
    } catch (err) {
      alert('Error al corregir la fecha: ' + (err as any).message)
    } finally {
      setFixingDate(false)
    }
  }

  // Solo se recuerdan fechas completas: mientras se teclea a mano el valor
  // pasa por estados parciales que no deben quedar guardados.
  useEffect(() => {
    if (esFechaValida(fecha)) sessionStorage.setItem(FECHA_KEY, fecha)
  }, [fecha])

  // ── Reconstruir inputs editables (reactivo a cierres + turnos) ─
  useEffect(() => {
    const activeTurnos = turnos.length > 0 ? turnos : [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }] as any[]
    const newInputsMap: Record<number, ShiftInputs> = {}
    for (const t of activeTurnos) {
      newInputsMap[t.id] = aShiftInputs(cierresMap[t.id])
    }
    setInputsMap(newInputsMap)
  }, [cierresMap, turnos])

  // ── Datos del mes (Historial) — lectura local + rescate remoto ─
  const mesRango = useMemo(() => {
    const year = parseInt(selectedMonth.substring(0, 4))
    const month = parseInt(selectedMonth.substring(5, 7))
    const lastDay = new Date(year, month, 0).getDate()
    return {
      startDate: `${selectedMonth}-01`,
      endDate: `${selectedMonth}-${String(lastDay).padStart(2, '0')}`,
    }
  }, [selectedMonth])

  // Meses fuera de la ventana hidratada (~35 días): se piden al servidor en
  // segundo plano y quedan cacheados en Dexie. Sin conexión → se ve lo local.
  useEffect(() => {
    if (activeTab === 'historial') void asegurarRango(mesRango.startDate, mesRango.endDate)
  }, [activeTab, mesRango])

  const cierresMes = useLiveQuery(
    () =>
      activeTab === 'historial'
        ? leerCierresRango(mesRango.startDate, mesRango.endDate)
        : Promise.resolve(null),
    [activeTab, mesRango]
  )
  const loadingHistorial = activeTab === 'historial' && cierresMes === undefined

  const cierresHistorial = useMemo<CierreRowCalculated[]>(() => {
    return (cierresMes ?? []).map((raw) => {
        const totalConsola = raw.total_consola_centimos ?? 0
        const dsctoVales = raw.dscto_vales_centimos ?? 0
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
          dsctoVales -
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
          colaborador_nombre: raw.colaborador_nombre,
          total_consola_centimos: totalConsola,
          yape_centimos: raw.yape_centimos,
          openpay_centimos: raw.openpay_centimos,
          deposito_transferencia_centimos: raw.deposito_transferencia_centimos,
          dscto_vales_centimos: dsctoVales,
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
  }, [cierresMes])

  // ── Guardar precios (al salir del campo) ──────────────────────
  // Escritura local instantánea; el sync la sube por detrás. El upsert es
  // por fecha, así que da igual si el precio nació hoy o se corrige.
  async function savePrecios() {
    const db5 = toCentimos(precios.db5)
    const regular = toCentimos(precios.regular)
    const premium = toCentimos(precios.premium)
    if (!db5 && !regular && !premium) return
    setSavingPrecios(true)
    try {
      await upsertPrecioDiario(fecha, {
        precio_db5_centimos: db5,
        precio_regular_centimos: regular,
        precio_premium_centimos: premium,
        registrado_por: profile?.id ?? null,
      })
    } finally {
      setSavingPrecios(false)
    }
  }

  // ── Precio diario por código de combustible ───────────────────
  function precioDiario(codigo: string): number {
    if (codigo === 'DB5') return toCentimos(precios.db5)
    if (codigo === 'REGULAR') return toCentimos(precios.regular)
    if (codigo === 'PREMIUM') return toCentimos(precios.premium)
    return 0
  }

  // ── Precio con el que se valora una fila YA GUARDADA ──────────
  // Cambiar el precio del día NO debe reescribir lo ya registrado: cada venta
  // conserva el `precio_unit_centimos` con el que se grabó. Solo se recurre al
  // precio del día cuando la fila aún no tiene precio propio (créditos rápidos,
  // que nacen con 0) o cuando se le cambia el producto y el precio viejo ya no
  // corresponde. La columna VARIACIÓN es justamente la que muestra la brecha
  // entre el precio histórico de la fila y el precio vigente.
  function precioDeFila(r: RegistroRow, codigoEditado: string): number {
    const mismoProducto = codigoEditado === r.tipo_combustible
    if (mismoProducto && r.precio_unit_centimos > 0) return r.precio_unit_centimos
    return precioDiario(codigoEditado)
  }

  // ── Filas valoradas a un precio distinto al del día ────────────
  // Que el precio no sea retroactivo es deliberado: puede subir de verdad a
  // media jornada y convivir dos precios el mismo día. Pero si sencillamente se
  // cargó mal, esas filas quedan valoradas al precio equivocado y editarlas no
  // las arregla (conservan su `precio_unit_centimos`). De ahí estas dos salidas:
  // reajustar TODAS de un golpe (aviso de arriba) o solo las que estén mal, una
  // a una desde su propia celda de PRECIO TOTAL. Los créditos rápidos (sin
  // galones) no entran: su importe se digita a mano, no sale de un precio.
  const filasDesfasadas = useMemo(
    () =>
      registros.filter(r => {
        if (r.cantidad_galones <= 0) return false
        const precioHoy = precioDiario(r.tipo_combustible)
        return precioHoy > 0 && r.precio_unit_centimos !== precioHoy
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [registros, precios]
  )

  /** Desglose del aviso: cuántas filas y de qué precio viejo a cuál nuevo. */
  const resumenDesfase = useMemo(() => {
    const grupos = new Map<string, { codigo: string; viejo: number; nuevo: number; filas: number }>()
    for (const r of filasDesfasadas) {
      const clave = `${r.tipo_combustible}|${r.precio_unit_centimos}`
      const g = grupos.get(clave) ?? {
        codigo: r.tipo_combustible,
        viejo: r.precio_unit_centimos,
        nuevo: precioDiario(r.tipo_combustible),
        filas: 0,
      }
      g.filas++
      grupos.set(clave, g)
    }
    return [...grupos.values()]
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filasDesfasadas, precios])

  /** Revalora filas al precio de hoy: cambia su precio unitario y su importe. */
  async function reajustarPrecios(filas: RegistroRow[]) {
    if (filas.length === 0 || reajustando) return
    setReajustando(true)
    try {
      await Promise.all(
        filas.map(r => {
          const precio = precioDiario(r.tipo_combustible)
          return updateRegistroVenta(r.id, {
            precio_unit_centimos: precio,
            importe_centimos: Math.round(r.cantidad_galones * precio),
          })
        })
      )
    } catch (err) {
      alert('Error al reajustar los precios: ' + (err as any).message)
    } finally {
      setReajustando(false)
    }
  }

  // El aviso se descarta por combinación fecha+precios: si el usuario dice que
  // esas filas están bien, no vuelve a molestar… pero si el precio cambia otra
  // vez, la advertencia es nueva y hay que volver a mostrarla.
  const firmaPrecios = `${fecha}|${precios.db5}|${precios.regular}|${precios.premium}`
  const mostrarAvisoPrecio = filasDesfasadas.length > 0 && avisoDescartado !== firmaPrecios

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

  // `override` permite guardar un valor recién elegido sin esperar al re-render
  // (setState es asíncrono, `inputsMap` aún no lo refleja en este tick).
  const handleShiftInputBlur = async (turnoId: number, override?: Partial<ShiftInputs>) => {
    const base = inputsMap[turnoId]
    if (!base) return
    const inputs = override ? { ...base, ...override } : base

    const totalConsola = inputs.total_consola === '' ? null : toCentimos(inputs.total_consola)
    const yape = toCentimos(inputs.yape)
    const openpay = toCentimos(inputs.openpay)
    const deposito = toCentimos(inputs.deposito)
    const dsctoVales = toCentimos(inputs.dscto_vales)
    const serafinado = toCentimos(inputs.serafinado)
    const redondeo = toCentimos(inputs.redondeo)
    const entregado = inputs.entregado_grifero === '' ? null : toCentimos(inputs.entregado_grifero)
    const contabilizado = inputs.contabilizado_admin === '' ? null : toCentimos(inputs.contabilizado_admin)

    // Evitar crear cierres "fantasma": si aún no existe un cierre para este
    // turno y no hay ningún dato significativo (todo vacío/en cero y sin
    // colaborador elegido), no insertar nada. Antes, cualquier blur creaba
    // una fila de puros ceros que aparecía en el historial como registro espurio.
    const existingCierre = cierresMap[turnoId]
    const tieneDatos =
      totalConsola !== null ||
      yape > 0 || openpay > 0 || deposito > 0 || dsctoVales > 0 ||
      serafinado > 0 || redondeo > 0 ||
      entregado !== null || contabilizado !== null ||
      inputs.colaborador_id !== ''
    if (!existingCierre && !tieneDatos) return

    // Asignar colaborador por defecto si está vacío
    let colaboradorId = inputs.colaborador_id
    if (!colaboradorId && colaboradores.length > 0) {
      colaboradorId = colaboradores[0].id
    }
    if (!colaboradorId && profile) {
      colaboradorId = profile.id
    }

    if (!colaboradorId) return

    try {
      // Upsert local por (fecha, turno): instantáneo y a prueba de cortes.
      await upsertCierreCaja(fecha, turnoId, {
        colaborador_id: colaboradorId,
        total_consola_centimos: totalConsola,
        yape_centimos: yape,
        openpay_centimos: openpay,
        deposito_transferencia_centimos: deposito,
        dscto_vales_centimos: dsctoVales,
        serafinado_centimos: serafinado,
        redondeo_centimos: redondeo,
        entregado_grifero_centimos: entregado,
        contabilizado_admin_centimos: contabilizado,
      })
    } catch (err) {
      console.error('Error al guardar turno:', err)
    }
  }

  // ── GRID de la tabla de turnos: coordenadas → campo ────────────
  // Las columnas posteriores a los créditos se corren con el modo (4 columnas de
  // crédito en COMPLETO, 1 en ABREVIADO); de ahí que se calculen y no se fijen.
  const colTurno = useMemo(() => {
    const anchoCreditos = modo === 'completo' ? 4 : 1
    return {
      prueba: T_COL_CREDITO + anchoCreditos,
      redondeo: T_COL_CREDITO + anchoCreditos + 1,
      efectivo: T_COL_CREDITO + anchoCreditos + 2,
      colaborador: T_COL_CREDITO + anchoCreditos + 3,
    }
  }, [modo])

  const campoTurno = useCallback((c: number): keyof ShiftInputs | null => {
    if (c === 1) return 'total_consola'
    if (c === 2) return 'yape'
    if (c === 3) return 'openpay'
    if (c === 4) return 'deposito'
    if (c === 5) return 'dscto_vales'
    if (c === colTurno.prueba) return 'serafinado'
    if (c === colTurno.redondeo) return 'redondeo'
    if (c === colTurno.colaborador) return 'colaborador_id'
    return null // créditos y efectivo final: calculados, solo lectura
  }, [colTurno])

  /** Las celdas de dinero del turno: todas menos el <select> de COLABORADOR. */
  const esMoneda = useCallback(
    (c: number) => {
      const campo = campoTurno(c)
      return campo !== null && campo !== 'colaborador_id'
    },
    [campoTurno]
  )

  function valorTurno(f: number, c: number): string {
    const t = turnos[f]
    const campo = campoTurno(c)
    if (!t || !campo) return ''
    return inputsMap[t.id]?.[campo] ?? ''
  }

  function aplicarTurno(f: number, c: number, val: string) {
    const t = turnos[f]
    const campo = campoTurno(c)
    if (!t || !campo) return
    handleInputChange(t.id, campo, val)
  }

  function revertirTurno(f: number, c: number) {
    const t = turnos[f]
    const campo = campoTurno(c)
    if (!t || !campo) return
    handleInputChange(t.id, campo, aShiftInputs(cierresMap[t.id])[campo])
  }

  /** Persiste UNA celda del turno y anota el valor previo para poder deshacerlo. */
  function guardarTurno(f: number, c: number, valor: string) {
    const t = turnos[f]
    const campo = campoTurno(c)
    if (!t || !campo) return
    const anterior = aShiftInputs(cierresMap[t.id])[campo]
    if (anterior === valor) return // nada que escribir
    setUltimoCambioTurno({ turnoId: t.id, campo, anterior })
    handleInputChange(t.id, campo, valor)
    // `override`: `inputsMap` todavía no refleja el cambio en este tick.
    handleShiftInputBlur(t.id, { [campo]: valor } as Partial<ShiftInputs>)
  }

  function deshacerTurno() {
    if (!ultimoCambioTurno) return
    const { turnoId, campo, anterior } = ultimoCambioTurno
    setUltimoCambioTurno(null)
    handleInputChange(turnoId, campo, anterior)
    handleShiftInputBlur(turnoId, { [campo]: anterior } as Partial<ShiftInputs>)
  }

  // ── Guardar nuevo registro de venta corporativa (Completo) ────
  async function saveRegistro() {
    const galones = parseFloat(nuevo.cantidad_galones)
    if (!nuevo.tipo_combustible || !(galones > 0) || !profile) return
    if (guardandoNuevoRef.current) return
    guardandoNuevoRef.current = true
    setSavingReg(true)
    const precioUnit = precioDiario(nuevo.tipo_combustible)

    try {
      await insertRegistroVenta({
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
        // Nace en COMPLETO: no hay total de consola contra el que comparar, así
        // que su variación de céntimos es invisible para el sistema.
        importe_declarado_centimos: null,
      })

      // Se conservan TURNO y PRODUCTO (y el tipo de atención) del registro
      // anterior a propósito: acelera el registro rápido de varios vales
      // seguidos del mismo turno/combustible. El resto se limpia.
      setNuevo(p => ({
        ...NUEVO_VACIO,
        turno_id: p.turno_id,
        tipo_atencion: p.tipo_atencion,
        tipo_combustible: p.tipo_combustible,
      }))
      // Devolver el cursor al inicio de la fila (CLIENTE) para empezar el
      // siguiente registro sin usar el ratón.
      gridReg.editarCelda(FILA_NUEVA, COL_CLIENTE)
    } catch (err) {
      alert('Error al agregar el registro de venta: ' + (err as any).message)
    } finally {
      guardandoNuevoRef.current = false
      setSavingReg(false)
    }
  }

  // ── Registro Rápido de Créditos (Abreviado) ───────────────────
  async function handleQuickRegister() {
    const monto = parseFloat(quickMonto)
    if (!(monto > 0) || !profile) return
    setSavingQuick(true)

    try {
      await insertRegistroVenta({
        fecha,
        turno_id: parseInt(quickTurno),
        colaborador_id: profile.id,
        tipo_documento: 'vale',
        tipo_atencion: 'particular',
        tipo_combustible: 'REGULAR',
        cantidad_galones: 0,
        precio_unit_centimos: 0,
        importe_centimos: toCentimos(monto),
        // El monto sale de la consola: se conserva para poder calcular después
        // el redondeo cuando la fila se complete con galones en COMPLETO.
        importe_declarado_centimos: toCentimos(monto),
        empresa_id: null,
        serie: null,
        numero: null,
        conductor: null,
        placa: null,
        dni_conductor: null,
      })

      setQuickMonto('')
    } catch (err) {
      alert('Error al registrar crédito rápido: ' + (err as any).message)
    } finally {
      setSavingQuick(false)
    }
  }

  // ── Reconstruir buffer editable de registros (reactivo a `registros`) ──
  useEffect(() => {
    const map: Record<string, RegistroInputs> = {}
    for (const r of registros) map[r.id] = aInputs(r)
    setRegInputsMap(map)
  }, [registros])

  const handleRegInputChange = (id: string, field: keyof RegistroInputs, val: string) => {
    setRegInputsMap(prev => ({
      ...prev,
      [id]: { ...prev[id], [field]: val },
    }))
  }

  // ── Guardar en línea una fila de venta (Completo) — sin botón "Editar" ──
  const handleRegBlur = async (id: string, override?: Partial<RegistroInputs>) => {
    const base = regInputsMap[id]
    if (!base) return
    // `override` permite que un Combobox pase su valor recién confirmado sin
    // depender del estado (que aún podría estar desactualizado en este tick).
    const inputs = override ? { ...base, ...override } : base
    const original = registros.find(x => x.id === id)
    if (!original) return
    const galones = parseFloat(inputs.cantidad_galones) || 0
    let precioUnit = precioDeFila(original, inputs.tipo_combustible)

    let importeCentimos = 0
    if (galones === 0) {
      importeCentimos = toCentimos(inputs.importe)
      precioUnit = 0
    } else {
      importeCentimos = Math.round(galones * precioUnit)
    }

    const emp = empresas.find(x => x.id === inputs.empresa_id)
    const tipoAtencion = emp ? emp.tipo : 'particular'

    // Mientras la fila siga sin galones, su importe ES el total declarado (el
    // usuario puede corregirlo a mano). En cuanto tiene galones, `importe` pasa
    // a ser galones × precio y el declarado queda intacto: es lo único que
    // permite calcular después el redondeo del turno.
    const importeDeclarado =
      galones === 0 ? importeCentimos : original.importe_declarado_centimos

    try {
      await updateRegistroVenta(id, {
        importe_declarado_centimos: importeDeclarado,
        turno_id: parseInt(inputs.turno_id),
        empresa_id: inputs.empresa_id || null,
        tipo_atencion: tipoAtencion,
        numero: inputs.numero || null,
        placa: inputs.placa || null,
        serie: inputs.serie || null,
        conductor: inputs.conductor || null,
        dni_conductor: inputs.dni_conductor || null,
        tipo_combustible: inputs.tipo_combustible,
        cantidad_galones: galones,
        precio_unit_centimos: precioUnit,
        importe_centimos: importeCentimos,
      })
    } catch (err) {
      alert('Error al guardar cambios: ' + (err as any).message)
    }
  }

  // ── Borrar registro de venta (soft delete) ────────────────────
  // Nunca se borra físicamente: se marca deleted_at y queda recuperable
  // desde Seguimiento → Papelera. El trigger de auditoría lo registra.
  async function deleteRegistro(id: string) {
    if (!confirm('¿Seguro que desea eliminar este registro?')) return
    try {
      await softDeleteRegistroVenta(id, profile?.id ?? null)
    } catch (err) {
      alert('Error al eliminar el registro: ' + (err instanceof Error ? err.message : String(err)))
    }
  }

  // ── GRID (modo Completo): selección, navegación y portapapeles ──
  // El `<td>` es lo enfocable mientras no se edita, así que las flechas y
  // Ctrl+C/Ctrl+V llegan aquí en vez de moverse dentro de un input.

  /** Fila `f` como registro guardado (null para la fila de entrada rápida). */
  const filaRegistro = (f: number): RegistroRow | null =>
    f === FILA_NUEVA ? null : registros[f - 1] ?? null

  function esEditable(f: number, c: number): boolean {
    if (c >= 1 && c <= 9) return true
    if (c !== 10) return false
    // PRECIO TOTAL solo se escribe a mano en créditos rápidos (sin galones);
    // en el resto es un valor derivado de galones × precio.
    const r = filaRegistro(f)
    const inputs = r ? regInputsMap[r.id] : null
    return !!inputs && (parseFloat(inputs.cantidad_galones) || 0) === 0
  }

  function aplicarValor(f: number, c: number, val: string) {
    const campo = CAMPO_POR_COL[c]
    if (!campo) return
    const r = filaRegistro(f)
    if (!r) {
      if (campo === 'importe') return // la fila de entrada no tiene importe libre
      setNuevo(p => ({ ...p, [campo]: val }))
      return
    }
    handleRegInputChange(r.id, campo, val)
  }

  /** Deshace la edición de una celda devolviéndole el valor almacenado. */
  function revertirCelda(f: number, c: number) {
    const r = filaRegistro(f)
    const campo = CAMPO_POR_COL[c]
    if (!r || !campo) return
    handleRegInputChange(r.id, campo, aInputs(r)[campo])
  }

  /**
   * Persiste el cambio de UNA celda de una fila guardada.
   *
   * Pasa el valor por `override` porque `regInputsMap` todavía no lo refleja
   * cuando el cambio se acaba de aplicar en este mismo manejador (setState es
   * asíncrono). De paso anota el valor previo para poder deshacerlo.
   */
  function guardarCelda(f: number, c: number, valor: string) {
    const r = filaRegistro(f)
    const campo = CAMPO_POR_COL[c]
    if (!r || !campo) return
    const anterior = aInputs(r)[campo]
    if (anterior === valor) return // nada que escribir
    setUltimoCambio({ id: r.id, campo, anterior })
    handleRegBlur(r.id, { [campo]: valor } as Partial<RegistroInputs>)
  }

  /** Valor actual de una celda en el buffer editable. */
  function valorCelda(f: number, c: number): string {
    const r = filaRegistro(f)
    const campo = CAMPO_POR_COL[c]
    if (!r || !campo) return ''
    return regInputsMap[r.id]?.[campo] ?? ''
  }

  /**
   * Deshace el último cambio de celda. Un solo nivel a propósito: un historial
   * profundo sobre una tabla que se guarda sola invita a retroceder de más y
   * dejar el registro en un estado que el usuario ya no reconoce. Las altas y
   * las bajas no entran aquí (las bajas se recuperan desde la Papelera).
   */
  function deshacer() {
    if (!ultimoCambio) return
    const { id, campo, anterior } = ultimoCambio
    setUltimoCambio(null)
    // La fila pudo eliminarse (o quedar en otra fecha) desde que se anotó.
    if (!registros.some(r => r.id === id)) return
    handleRegInputChange(id, campo, anterior)
    handleRegBlur(id, { [campo]: anterior } as Partial<RegistroInputs>)
  }

  /** La fila de entrada solo se graba con Enter desde GALONES (o con "+ Agregar"). */
  function intentarGuardarNuevo() {
    const gal = parseFloat(nuevo.cantidad_galones)
    if (nuevo.tipo_combustible && gal > 0) saveRegistro()
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

  // ── Total de consola del día (del reporte que lee el OCR) ─────
  // Vive en consola_reportes, no en cierres_caja: es un dato del DÍA, no
  // de un turno. La fila TOTAL lo muestra en solo lectura: el usuario edita
  // los 4 turnos, y este número es la referencia contra la que se contrastan.
  // Solo el OCR escribe aquí; para corregirlo se vuelve a pegar el reporte.
  const reportesConsola = useLiveQuery(() => leerReportesDia(fecha), [fecha])
  const totalConsolaDia = reportesConsola?.ventas_dia?.importe_total_centimos ?? null
  // El OCR pesa como auditor: si su propia lectura no se validó (Σ de las
  // líneas ≠ fila RSM del reporte), NO puede acusar de descuadre al usuario.
  // Se marca como dudosa para que nadie la trate como verdad.
  const lecturaDudosa = reportesConsola?.ventas_dia?.validacion_ok === false
  const [modalConsola, setModalConsola] = useState(false)

  // ── Totales del día (fila TOTAL al pie de la tabla de turnos) ──
  // El TOTAL CONSOLA de esta fila NO es esta suma: viene del reporte
  // consolidado que lee el OCR. La suma se usa solo para contrastarla.
  const totalesTurnos = useMemo(() => {
    const acc = {
      total_consola: 0, yape: 0, openpay: 0, deposito: 0, vales: 0,
      corporacion: 0, licitaciones: 0, particulares: 0, chevron: 0,
      creditos: 0, serafinado: 0, redondeo: 0, efectivo: 0,
    }
    for (const t of turnos) {
      const c = cierresMap[t.id]
      const cr = creditosPorTurno[t.id] ?? { corporacion: 0, licitaciones: 0, particulares: 0, chevron: 0 }
      acc.corporacion += cr.corporacion
      acc.licitaciones += cr.licitaciones
      acc.particulares += cr.particulares
      acc.chevron += cr.chevron
      acc.creditos += cr.corporacion + cr.licitaciones + cr.particulares + cr.chevron
      if (!c) continue
      acc.total_consola += c.total_consola_centimos ?? 0
      acc.yape += c.yape_centimos
      acc.openpay += c.openpay_centimos
      acc.deposito += c.deposito_transferencia_centimos
      acc.vales += c.dscto_vales_centimos
      acc.serafinado += c.serafinado_centimos
      acc.redondeo += c.redondeo_centimos
      acc.efectivo += calcEfectivoFinal(c, cr)
    }
    return acc
  }, [turnos, cierresMap, creditosPorTurno])

  // ── Redondeo sugerido por turno ───────────────────────────────
  // `total_consola` trae los importes reales de la consola (precio unitario con
  // más de 2 decimales), pero a los créditos les descontamos galones × precio de
  // 2 decimales. La suma de esas brechas es justo lo que hay que poner en
  // REDONDEO para que el efectivo final calce. Solo entran las filas que
  // conservan su total declarado: las nacidas en COMPLETO no tienen referencia.
  const redondeoSugeridoPorTurno = useMemo(() => {
    const map: Record<number, number> = {}
    for (const r of registros) {
      if (r.importe_declarado_centimos == null) continue
      map[r.turno_id] = (map[r.turno_id] ?? 0) + (r.importe_centimos - r.importe_declarado_centimos)
    }
    return map
  }, [registros])

  // ── Opciones para los comboboxes (Cliente, Producto, Turno) ───
  // Sólo se guarda un valor que coincida con estas opciones; texto libre sin
  // coincidencia no se persiste (lo maneja el propio Combobox).
  const empresaOptions = useMemo(
    () => empresas.map(e => ({ value: e.id, label: e.nombre })),
    [empresas]
  )
  // Turno: la etiqueta es la posición (1..4), así el usuario escribe 1-4.
  const turnoOptions = useMemo(
    () => turnos.map((t, i) => ({ value: String(t.id), label: String(i + 1) })),
    [turnos]
  )
  // Cliente del último vale registrado del día: se ofrece como sugerencia en la
  // fila de entrada (`registros` viene ordenado por created_at ascendente).
  const clienteSugerido = registros.length
    ? registros[registros.length - 1].empresa_id ?? ''
    : ''

  // ── Selección por tecla en los <select> de Producto y Turno ───
  // El typeahead nativo del <select> ACUMULA las teclas en un búfer (~1s):
  // pulsar R, P, D seguidas arma "RPD" y no coincide con nada; solo se resetea
  // al salir de la celda. Estos helpers seleccionan al instante con cada tecla,
  // de forma repetible y sin abandonar la celda.
  const combustibleCodigoPorTecla = useCallback((key: string): string | null => {
    const k = key.toUpperCase()
    if (k.length !== 1) return null
    const m = combustibles.find(c => c.codigo.toUpperCase().startsWith(k))
    return m ? m.codigo : null
  }, [combustibles])

  const turnoIdPorTecla = useCallback((key: string): string | null => {
    const n = Number(key)
    if (!Number.isInteger(n) || n < 1 || n > turnos.length) return null
    return String(turnos[n - 1].id)
  }, [turnos])

  const colaboradorPorTecla = useCallback((key: string): string | null => {
    const k = key.toUpperCase()
    if (k.length !== 1) return null
    const m = colaboradores.find(c => c.nombre.toUpperCase().startsWith(k))
    return m ? m.id : null
  }, [colaboradores])

  const colaboradorOptions = useMemo(
    () => colaboradores.map(c => ({ value: c.id, label: c.nombre })),
    [colaboradores]
  )

  // ── Los dos grids de la página ────────────────────────────────
  // Misma mecánica de hoja de cálculo en ambos (`useGridHoja`): un clic
  // selecciona, Enter/F2/doble clic abren, teclear encima reemplaza, las flechas
  // navegan y nunca alteran una casilla numérica. Solo cambia qué hay en cada
  // celda y cómo se persiste, que es lo que describen estos callbacks.
  const gridTurnos = useGridHoja({
    filaMax: turnos.length - 1,
    colMin: 1,
    colMax: colTurno.colaborador,
    visible: activeTab === 'registro',
    editable: (_f, c) => campoTurno(c) !== null,
    texto: (_f, c) => esMoneda(c),
    numero: (_f, c) => esMoneda(c),
    // REDONDEO es la única casilla de la app que puede restar céntimos.
    negativo: (_f, c) => c === colTurno.redondeo,
    valor: valorTurno,
    aplicar: aplicarTurno,
    guardar: guardarTurno,
    revertir: revertirTurno,
    deshacer: deshacerTurno,
    flechasPropias: c => c === colTurno.colaborador,
    teclaDirecta: (c, k) => (c === colTurno.colaborador ? colaboradorPorTecla(k) : null),
    alSeleccionar: () => soltarRegistros.current(),
  })

  const gridReg = useGridHoja({
    filaMax: registros.length, // la fila 0 es la de entrada rápida
    colMin: COL_MIN,
    colMax: COL_MAX,
    visible: modo === 'completo' && activeTab === 'registro',
    editable: esEditable,
    texto: (_f, c) => COLS_TEXTO.has(c),
    numero: (_f, c) => COLS_NUM.has(c),
    valor: valorCelda,
    aplicar: aplicarValor,
    guardar: guardarCelda,
    revertir: revertirCelda,
    deshacer,
    editorAutonomo: c => c === COL_CLIENTE,
    flechasPropias: c => c === COL_CLIENTE || c === COL_TURNO || c === COL_PRODUCTO,
    teclaDirecta: (c, k) =>
      c === COL_TURNO ? turnoIdPorTecla(k)
      : c === COL_PRODUCTO ? combustibleCodigoPorTecla(k)
      : null,
    // Solo Enter sobre GALONES da de alta la fila de entrada: con Tab o las
    // flechas se sigue rellenando el borrador sin crear nada.
    onEnter: (f, c) => { if (f === FILA_NUEVA && c === COL_GALONES) intentarGuardarNuevo() },
    alSeleccionar: () => soltarTurnos.current(),
  })

  // Solo un grid puede tener la celda activa: cada uno suelta la del otro.
  useEffect(() => {
    soltarTurnos.current = gridTurnos.limpiarSeleccion
    soltarRegistros.current = gridReg.limpiarSeleccion
  }, [gridTurnos.limpiarSeleccion, gridReg.limpiarSeleccion])

  // Cambiar de día trae otras filas: el deshacer y el portapapeles de los grids
  // apuntarían a registros que ya no están en pantalla.
  useEffect(() => {
    setUltimoCambio(null)
    setUltimoCambioTurno(null)
    gridReg.reiniciar()
    gridTurnos.reiniciar()
  }, [fecha, gridReg.reiniciar, gridTurnos.reiniciar])

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
      vales: sum('dscto_vales_centimos'),
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

  // ── Fábricas de celdas ────────────────────────────────────────
  // Las mismas tres formas de celda para los dos grids; solo cambia a qué grid
  // se enganchan (selección, edición, portapapeles).
  const CLASE_EDITOR = 'input py-0 h-6 text-xs w-full'

  const celdasDe = (g: GridHoja) => ({
    /** Celda con <input> de texto o número. */
    input: (
      f: number,
      c: number,
      valor: string,
      onChange: (v: string) => void,
      opts: OpcionesCelda = {}
    ) => (
      <CeldaGrid
        f={f}
        c={c}
        activa={g.esActiva(f, c)}
        tabbable={g.esTabbable(f, c)}
        copiada={g.esCopiada(f, c)}
        editando={g.editando}
        editable
        caret={g.caret}
        align={opts.numero ? 'right' : 'left'}
        className={`${opts.numero ? 'font-mono' : opts.mayusculas ? 'uppercase' : ''} ${opts.className ?? ''}`}
        style={opts.style}
        // Vacía se ve el placeholder (tenue), no un 0.00 que al teclear
        // antepondría dígitos. Se copia el valor real, no el placeholder.
        contenido={valor !== '' ? valor : <span className="text-app-muted">{opts.placeholder ?? ''}</span>}
        textoCopia={valor}
        pie={opts.pie}
        onSeleccionar={() => g.seleccionar(f, c)}
        onEditar={() => g.editarCelda(f, c)}
        editor={
          <input
            type={opts.numero ? 'number' : 'text'}
            step={opts.step}
            maxLength={opts.maxLength}
            placeholder={opts.placeholder}
            // Marca que lee `useHardenNumberInputs` para dejar teclear el signo.
            data-negativo={opts.negativo ? '' : undefined}
            className={`${CLASE_EDITOR} ${opts.numero ? 'text-right font-mono' : ''}`}
            style={opts.mayusculas ? { textTransform: 'uppercase' } : undefined}
            value={valor}
            onChange={e => onChange(e.target.value)}
          />
        }
      />
    ),

    /** Celda con <select> (TURNO, PRODUCTO, COLABORADOR). */
    select: (
      f: number,
      c: number,
      valor: string,
      etiqueta: string,
      onChange: (v: string) => void,
      opciones: { value: string; label: string }[],
      porTecla: (k: string) => string | null,
      vacio = false
    ) => (
      <CeldaGrid
        f={f}
        c={c}
        activa={g.esActiva(f, c)}
        tabbable={g.esTabbable(f, c)}
        copiada={g.esCopiada(f, c)}
        editando={g.editando}
        editable
        caret={g.caret}
        contenido={etiqueta}
        onSeleccionar={() => g.seleccionar(f, c)}
        onEditar={() => g.editarCelda(f, c)}
        editor={
          <select
            className={CLASE_EDITOR}
            value={valor}
            onChange={e => onChange(e.target.value)}
            onKeyDown={e => {
              const v = porTecla(e.key)
              if (v) { e.preventDefault(); onChange(v) }
            }}
          >
            {vacio && <option value="">—</option>}
            {opciones.map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        }
      />
    ),

    /** Celda de solo lectura: se puede seleccionar y copiar, no editar. */
    lectura: (
      f: number,
      c: number,
      contenido: React.ReactNode,
      align: 'left' | 'right' | 'center' = 'right',
      style?: React.CSSProperties,
      className = '',
      pie?: React.ReactNode
    ) => (
      <CeldaGrid
        f={f}
        c={c}
        activa={g.esActiva(f, c)}
        tabbable={g.esTabbable(f, c)}
        copiada={g.esCopiada(f, c)}
        editando={g.editando}
        contenido={contenido}
        align={align}
        style={style}
        className={className}
        pie={pie}
        onSeleccionar={() => g.seleccionar(f, c)}
        onEditar={() => {}}
      />
    ),
  })

  const celdaTurno = celdasDe(gridTurnos)
  const celdaReg = celdasDe(gridReg)

  /**
   * Ctrl+Z / Ctrl+Y solo existen dentro de los grids.
   *
   * Fuera de ellos hay que BLOQUEAR el deshacer nativo del navegador: los campos
   * sueltos de esta página (precios del día, registro rápido) se guardan en
   * `onBlur`, así que un Ctrl+Z sobre uno de ellos revierte el texto sin que se
   * note y el blur siguiente persiste el valor viejo. Un Ctrl+Z en el precio del
   * DB5 llegaba a reescribir el precio del producto.
   *
   * Dentro de un grid: si se está editando una celda, el evento no llega aquí
   * cancelado y el input usa su deshacer nativo, que ahí sí es visible.
   */
  function bloquearDeshacerFueraDelGrid(e: React.KeyboardEvent) {
    if (!e.ctrlKey && !e.metaKey) return
    const k = e.key.toLowerCase()
    if (k !== 'z' && k !== 'y') return
    const nodo = e.target as Node
    if (!gridReg.contiene(nodo) && !gridTurnos.contiene(nodo)) e.preventDefault()
  }

  // Formateador especial para diferencia (con color rojo/verde)
  const renderDiferencia = (v: number | null) => {
    if (v === null) return <td className="text-right font-mono text-xs text-app-muted">—</td>
    if (v > 0) return <td className="text-right font-mono text-xs font-semibold text-green-600">+{formatSoles(v)}</td>
    if (v < 0) return <td className="text-right font-mono text-xs font-semibold text-red-600">-{formatSoles(Math.abs(v))}</td>
    return <td className="text-right font-mono text-xs text-app-muted">S/ 0.00</td>
  }

  return (
    <div
      className="flex h-full min-w-0 flex-1 flex-col overflow-hidden bg-slate-50"
      onKeyDownCapture={bloquearDeshacerFueraDelGrid}
    >
      
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

            {/* Corregir fecha (mover el día completo si se cargó bajo la fecha equivocada) */}
            {!showFixDate ? (
              <button
                className="btn-ghost text-xs py-1 px-2"
                onClick={() => setShowFixDate(true)}
                title="Usar si todo el día se registró bajo la fecha equivocada"
              >
                Corregir fecha
              </button>
            ) : (
              <div className="flex items-center gap-1.5 rounded border border-app-border bg-slate-50 px-2 py-0.5">
                <span className="text-[11px] font-semibold text-slate-600">Mover a:</span>
                <input
                  type="date"
                  className="input h-6 w-32 text-xs py-0"
                  value={fixDateTarget}
                  onChange={e => setFixDateTarget(e.target.value)}
                />
                <button
                  className="btn bg-primary text-primary-text h-6 px-2 text-[10px]"
                  disabled={!fixDateTarget || fixDateTarget === fecha || fixingDate}
                  onClick={handleFixDate}
                >
                  {fixingDate ? '…' : 'Confirmar'}
                </button>
                <button
                  className="btn-ghost h-6 px-2 text-[10px]"
                  onClick={() => { setShowFixDate(false); setFixDateTarget('') }}
                >
                  Cancelar
                </button>
              </div>
            )}

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
                {/* Aviso: hay ventas valoradas a un precio distinto al del día.
                    Puede ser legítimo (el precio subió a media jornada), así que
                    NUNCA se reajusta solo: se pregunta. Si el usuario dice que
                    están bien, el aviso calla hasta que el precio vuelva a cambiar. */}
                {mostrarAvisoPrecio && (
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded border border-amber-300 bg-amber-50 px-3 py-2">
                    <span className="text-xs font-bold text-amber-900">
                      {filasDesfasadas.length} venta{filasDesfasadas.length > 1 ? 's' : ''} del día
                      {filasDesfasadas.length > 1 ? ' siguen' : ' sigue'} valorada
                      {filasDesfasadas.length > 1 ? 's' : ''} al precio anterior:
                    </span>
                    {resumenDesfase.map(g => (
                      <span key={`${g.codigo}-${g.viejo}`} className="text-xs text-amber-800">
                        <b>{g.codigo}</b> {g.filas} × {fs(g.viejo)} → {fs(g.nuevo)}
                      </span>
                    ))}
                    <div className="ml-auto flex items-center gap-2">
                      <button
                        className="btn bg-amber-600 text-white hover:bg-amber-700 h-6 px-2 text-[11px]"
                        disabled={reajustando}
                        onClick={() => reajustarPrecios(filasDesfasadas)}
                      >
                        {reajustando ? '…' : `Reajustar ${filasDesfasadas.length === 1 ? 'la venta' : `las ${filasDesfasadas.length}`} al precio de hoy`}
                      </button>
                      <button
                        className="btn-ghost h-6 px-2 text-[11px] text-amber-800"
                        title="Si el precio cambió de verdad a media jornada, esas ventas están bien. Podrás corregir las que sí estén mal una a una, desde su celda de PRECIO TOTAL."
                        onClick={() => setAvisoDescartado(firmaPrecios)}
                      >
                        No, están bien
                      </button>
                    </div>
                  </div>
                )}

                {/* Tabla de Turnos — grid tipo hoja de cálculo (mismo motor que COMPLETO) */}
                {/* table-fixed: ancho de columnas FIJO (no se ensancha con el contenido);
                    si no entra en pantalla, aparece scroll horizontal del contenedor. */}
                <div className="space-y-2">
                  <p className="text-[11px] text-app-muted">
                    Un clic selecciona la celda (Ctrl+C copia, Ctrl+V pega, Ctrl+Z deshace el
                    último cambio); Enter, F2 o doble clic la abren para editar. Muévete con
                    las flechas.
                  </p>
                  <div className="overflow-x-auto rounded border border-app-border bg-white shadow-sm">
                    <table
                      {...gridTurnos.props}
                      className="table-excel table-fixed"
                      style={{ minWidth: modo === 'completo' ? 1390 : 1094 }}
                    >
                      <thead>
                        <tr>
                          <th style={{ width: 56 }}>TURNO</th>
                          <th style={{ width: 110 }}>TOTAL CONSOLA</th>
                          <th style={{ width: 96 }}>YAPE</th>
                          <th style={{ width: 96 }}>OPEN PAY</th>
                          <th style={{ width: 100 }}>DEPÓSITO / TRANS.</th>
                          <th style={{ width: 100 }}>DSCTOS VALES</th>
                          {modo === 'abreviado' ? (
                            <th style={{ width: 120, background: 'var(--c-hl-credit)', color: 'var(--c-hl-credit-fg)' }}>TOTAL CRÉDITOS</th>
                          ) : (
                            <>
                              <th style={{ width: 108, background: 'var(--c-hl-neutral)' }}>CORPORACIÓN</th>
                              <th style={{ width: 110, background: 'var(--c-hl-neutral)' }}>LICITACIONES</th>
                              <th style={{ width: 108, background: 'var(--c-hl-neutral)' }}>PARTICULARES</th>
                              <th style={{ width: 90,  background: 'var(--c-hl-neutral)' }}>CHEVRON</th>
                            </>
                          )}
                          <th style={{ width: 90 }}>PRUEBA</th>
                          <th style={{ width: 90 }}>REDONDEO</th>
                          <th style={{ width: 116, background: 'var(--c-hl-cash)', color: 'var(--c-hl-cash-fg)' }}>EFECTIVO FINAL</th>
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
                            dscto_vales_centimos: 0
                          }
  
                          const creditos = creditosPorTurno[t.id] || { corporacion: 0, licitaciones: 0, particulares: 0, chevron: 0 }
                          const totalCreditos = creditos.corporacion + creditos.licitaciones + creditos.particulares + creditos.chevron
                          const efectivo = calcEfectivoFinal(c, creditos)
  
                          const inputs = inputsMap[t.id] ?? aShiftInputs()
                          const f = idx
  
                          // Redondeo sugerido: se ofrece como anexo clicable bajo la celda.
                          const sug = redondeoSugeridoPorTurno[t.id] ?? 0
                          const sugValor = (sug / 100).toFixed(2)
                          const pieRedondeo =
                            sug === 0 || inputs.redondeo === sugValor ? null : (
                              <button
                                type="button"
                                className="mt-0.5 block w-full text-right text-[10px] text-amber-600 hover:underline"
                                title={
                                  'Céntimos que la consola cobró de más o de menos frente a ' +
                                  'galones × precio, sumados sobre los créditos de este turno ' +
                                  'que se registraron en ABREVIADO. Clic para aplicarlo.'
                                }
                                onClick={() => guardarTurno(f, colTurno.redondeo, sugValor)}
                              >
                                sug. {sug > 0 ? '+' : ''}{sugValor}
                              </button>
                            )
  
                          const dinero = { numero: true, step: '0.01', placeholder: '0.00' }
                          const bgCredito = { background: 'var(--c-hl-neutral)' }
  
                          return (
                            <tr key={t.id}>
                              <td className="text-center text-sm font-bold text-slate-800 bg-slate-50">
                                {idx + 1}
                              </td>
  
                              {celdaTurno.input(f, 1, inputs.total_consola, v => handleInputChange(t.id, 'total_consola', v), dinero)}
                              {celdaTurno.input(f, 2, inputs.yape, v => handleInputChange(t.id, 'yape', v), dinero)}
                              {celdaTurno.input(f, 3, inputs.openpay, v => handleInputChange(t.id, 'openpay', v), dinero)}
                              {celdaTurno.input(f, 4, inputs.deposito, v => handleInputChange(t.id, 'deposito', v), dinero)}
                              {celdaTurno.input(f, 5, inputs.dscto_vales, v => handleInputChange(t.id, 'dscto_vales', v), dinero)}
  
                              {/* Créditos (calculados reactivos): se seleccionan y copian, no se editan */}
                              {modo === 'abreviado' ? (
                                celdaTurno.lectura(
                                  f, T_COL_CREDITO, fs(totalCreditos), 'right',
                                  { background: 'var(--c-hl-credit)' },
                                  'font-mono text-xs font-semibold text-amber-800'
                                )
                              ) : (
                                <>
                                  {celdaTurno.lectura(f, T_COL_CREDITO, fs(creditos.corporacion), 'right', bgCredito, 'font-mono text-xs')}
                                  {celdaTurno.lectura(f, T_COL_CREDITO + 1, fs(creditos.licitaciones), 'right', bgCredito, 'font-mono text-xs')}
                                  {celdaTurno.lectura(f, T_COL_CREDITO + 2, fs(creditos.particulares), 'right', bgCredito, 'font-mono text-xs')}
                                  {celdaTurno.lectura(f, T_COL_CREDITO + 3, fs(creditos.chevron), 'right', bgCredito, 'font-mono text-xs')}
                                </>
                              )}
  
                              {celdaTurno.input(f, colTurno.prueba, inputs.serafinado, v => handleInputChange(t.id, 'serafinado', v), dinero)}
                              {celdaTurno.input(
                                f, colTurno.redondeo, inputs.redondeo,
                                v => handleInputChange(t.id, 'redondeo', v),
                                { ...dinero, negativo: true, pie: pieRedondeo }
                              )}
  
                              {celdaTurno.lectura(
                                f, colTurno.efectivo, fs(efectivo), 'right',
                                { background: 'var(--c-hl-cash-soft)' },
                                'font-mono text-xs font-semibold'
                              )}
  
                              {celdaTurno.select(
                                f, colTurno.colaborador, inputs.colaborador_id,
                                colaboradorOptions.find(o => o.value === inputs.colaborador_id)?.label ?? '—',
                                v => handleInputChange(t.id, 'colaborador_id', v),
                                colaboradorOptions, colaboradorPorTecla, true
                              )}
                            </tr>
                          )
                        })}
                      </tbody>

                      {/* Fila TOTAL: el TOTAL CONSOLA no es la suma de los
                          turnos, sino lo que marcó el reporte consolidado
                          del día. Si ambos difieren, se avisa debajo. */}
                      <tfoot>
                        <tr className="border-t-2 border-app-border bg-app-border/20 font-semibold">
                          <td className="text-center text-base font-bold text-slate-800 bg-slate-50">
                            Σ
                          </td>
                          {/* Único hueco de la fila TOTAL donde entra un dato
                              externo: lo escribe el OCR al pegar el reporte, no
                              el usuario. Clic → modal de carga. */}
                          <td
                            className="cursor-pointer p-0 hover:brightness-95"
                            style={{ background: 'var(--c-hl-neutral)' }}
                            title={
                              totalConsolaDia === null
                                ? 'Clic para pegar el reporte de consola del día (Ctrl+V)'
                                : lecturaDudosa
                                  ? 'Lectura NO validada: las cifras del propio reporte no cuadran ' +
                                    'entre sí. Vuelve a pegarlo con mejor recorte antes de fiarte.'
                                  : 'Total del reporte consolidado de la consola. Clic para volver a cargarlo.'
                            }
                            onClick={() => setModalConsola(true)}
                          >
                            <div className="px-1 text-right font-mono text-xs font-bold">
                              {totalConsolaDia === null ? (
                                <span className="text-app-muted">＋</span>
                              ) : lecturaDudosa ? (
                                <span className="text-amber-600">{fs(totalConsolaDia)} ⚠</span>
                              ) : (
                                fs(totalConsolaDia)
                              )}
                            </div>
                          </td>
                          <td className="text-right font-mono text-xs">{fs(totalesTurnos.yape)}</td>
                          <td className="text-right font-mono text-xs">{fs(totalesTurnos.openpay)}</td>
                          <td className="text-right font-mono text-xs">{fs(totalesTurnos.deposito)}</td>
                          <td className="text-right font-mono text-xs">{fs(totalesTurnos.vales)}</td>
                          {modo === 'abreviado' ? (
                            <td className="text-right font-mono text-xs" style={{ background: 'var(--c-hl-credit)' }}>
                              {fs(totalesTurnos.creditos)}
                            </td>
                          ) : (
                            <>
                              <td className="text-right font-mono text-xs" style={{ background: 'var(--c-hl-neutral)' }}>{fs(totalesTurnos.corporacion)}</td>
                              <td className="text-right font-mono text-xs" style={{ background: 'var(--c-hl-neutral)' }}>{fs(totalesTurnos.licitaciones)}</td>
                              <td className="text-right font-mono text-xs" style={{ background: 'var(--c-hl-neutral)' }}>{fs(totalesTurnos.particulares)}</td>
                              <td className="text-right font-mono text-xs" style={{ background: 'var(--c-hl-neutral)' }}>{fs(totalesTurnos.chevron)}</td>
                            </>
                          )}
                          <td className="text-right font-mono text-xs">{fs(totalesTurnos.serafinado)}</td>
                          <td className="text-right font-mono text-xs">{fs(totalesTurnos.redondeo)}</td>
                          <td className="text-right font-mono text-xs" style={{ background: 'var(--c-hl-cash-soft)' }}>
                            {fs(totalesTurnos.efectivo)}
                          </td>
                          <td />
                        </tr>
                      </tfoot>
                    </table>
                  </div>

                  {/* Dos diagnósticos muy distintos, y conviene no confundirlos:
                      o el OCR leyó mal (y entonces no puede juzgar a nadie), o
                      leyó bien y el descuadre es real en lo que se digitó. */}
                  {lecturaDudosa ? (
                    <div className="alert-warning mt-2">
                      La lectura del reporte de consola <strong>no está validada</strong>: las
                      cifras por producto no suman el total del propio reporte, así que el OCR
                      leyó mal algún dígito. No se puede contrastar contra los turnos hasta
                      volver a cargarlo.
                    </div>
                  ) : totalConsolaDia !== null && totalesTurnos.total_consola > 0 &&
                      totalConsolaDia !== totalesTurnos.total_consola ? (
                    <div className="alert-warning mt-2">
                      La suma de los turnos ({fs(totalesTurnos.total_consola)}) no coincide con
                      el total del reporte de consola ({fs(totalConsolaDia)}). Diferencia:{' '}
                      <strong>{fs(totalesTurnos.total_consola - totalConsolaDia)}</strong>. Revisa
                      lo digitado en los 4 turnos.
                    </div>
                  ) : null}
                </div>

                {/* Carga de reportes de consola desde la celda Σ. Es la vía
                    disponible en AMBOS modos; en ABREVIADO existe además la
                    tarjeta fija junto a Registro Rápido. */}
                {modalConsola && (
                  <div className="modal-overlay" onClick={() => setModalConsola(false)}>
                    <div
                      className="modal-box !max-w-sm p-4"
                      onClick={e => e.stopPropagation()}
                    >
                      <div className="mb-3 flex items-center justify-between border-b border-app-border pb-1.5">
                        <h3 className="text-sm font-bold text-app-text">Reportes de Consola</h3>
                        <button
                          className="text-app-muted hover:text-app-text"
                          onClick={() => setModalConsola(false)}
                        >
                          ✕
                        </button>
                      </div>
                      <ConsolaPanel fecha={fecha} onIrAFecha={setFecha} />
                    </div>
                  </div>
                )}

                {/* === MODO ABREVIADO: Registro Rápido de Créditos === */}
                {modo === 'abreviado' && (
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    {/* Formulario rápido + carga de reportes de consola */}
                    <div className="md:col-span-1 space-y-6">
                    <div className="card space-y-4">
                      <h3 className="text-sm font-bold text-slate-700 border-b pb-1.5">Registro Rápido de Créditos</h3>
                      
                      <div className="flex items-center gap-4">
                        <div className="flex-1">
                          <label className="block text-xs font-semibold text-slate-500 mb-1">TURNO (1-4)</label>
                          <Combobox
                            className="input h-9"
                            options={turnoOptions}
                            value={quickTurno}
                            onChange={setQuickTurno}
                            allowEmpty={false}
                            placeholder="1-4"
                          />
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

                    <ConsolaUploader fecha={fecha} onIrAFecha={setFecha} />
                    </div>

                    {/* Créditos rápidos del día, agrupados por turno */}
                    <div className="card md:col-span-2 space-y-2">
                      <h3 className="text-sm font-bold text-slate-700 border-b pb-1.5">Créditos Rápidos del Día</h3>
                      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                        {(turnos.length > 0 ? turnos : [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }] as any[]).map((t, idx) => {
                          const regsTurno = registrosRapidos.filter(r => r.turno_id === t.id)
                          const subtotal = regsTurno.reduce((s, r) => s + r.importe_centimos, 0)
                          return (
                            <div key={t.id} className="flex flex-col rounded border border-app-border overflow-hidden">
                              <div className="bg-slate-100 px-2 py-1 text-xs font-bold text-slate-700 text-center">
                                Turno {idx + 1}
                              </div>
                              <div className="flex-1 divide-y divide-app-border">
                                {regsTurno.map(r => (
                                  <div key={r.id} className="flex items-center justify-between gap-1 px-2 py-1">
                                    <span className="font-mono text-xs font-bold text-slate-800">{fs(r.importe_centimos)}</span>
                                    <button
                                      onClick={() => deleteRegistro(r.id)}
                                      className="text-red-600 hover:text-red-800 text-[10px] font-semibold"
                                    >
                                      ✕
                                    </button>
                                  </div>
                                ))}
                                {regsTurno.length === 0 && (
                                  <div className="px-2 py-4 text-center text-[11px] text-app-muted italic">
                                    Sin registros
                                  </div>
                                )}
                              </div>
                              <div className="border-t border-app-border bg-slate-50 px-2 py-1 text-right text-xs font-bold text-slate-700">
                                {fs(subtotal)}
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  </div>
                )}

                {/* === MODO COMPLETO: Registro Completo de Vales y Transacciones === */}
                {modo === 'completo' && (
                  <div className="space-y-2">
                    {registrosRapidos.length > 0 && (
                      <div className="rounded border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-800">
                        {registrosRapidos.length} registro{registrosRapidos.length > 1 ? 's' : ''} rápido{registrosRapidos.length > 1 ? 's' : ''} pendiente{registrosRapidos.length > 1 ? 's' : ''} de completar con el detalle del vale/factura (resaltado{registrosRapidos.length > 1 ? 's' : ''} abajo)
                      </div>
                    )}
                    <p className="text-[11px] text-app-muted">
                      Un clic selecciona la celda (Ctrl+C copia, Ctrl+V pega, Ctrl+Z deshace el
                      último cambio); Enter, F2 o doble clic la abren para editar. Muévete con
                      las flechas. En la fila azul, Enter sobre GALONES da de alta el registro.
                    </p>
                    {/* table-fixed: la tabla de inserción mantiene ancho constante aunque
                        el contenido (nombres de cliente, montos) sea largo. */}
                    <div className="overflow-x-auto rounded border border-app-border bg-white shadow-sm">
                    <table
                      {...gridReg.props}
                      className="table-excel table-fixed"
                      style={{ minWidth: 1200 }}
                    >
                      <thead>
                        <tr>
                          <th style={{ width: 86 }}>FECHA</th>
                          <th style={{ width: 150 }}>CLIENTE</th>
                          <th style={{ width: 88 }}>VALE LIC.</th>
                          <th style={{ width: 72 }}>TICKET</th>
                          <th style={{ width: 78 }}>PLACA</th>
                          <th style={{ width: 120 }}>CONDUCTOR</th>
                          <th style={{ width: 84 }}>DNI</th>
                          <th style={{ width: 58 }}>TURNO</th>
                          <th style={{ width: 82 }}>PRODUCTO</th>
                          <th style={{ width: 80 }}>GALONES</th>
                          <th style={{ width: 108 }}>PRECIO TOTAL</th>
                          <th style={{ width: 100, background: 'var(--c-hl-warn)', color: 'var(--c-hl-warn-fg)' }}>
                            VARIACIÓN
                          </th>
                          <th style={{ width: 110 }}>ACCIONES</th>
                        </tr>
                      </thead>
                      <tbody>
                        {/* Fila de Entrada Rápida (f = 0) */}
                        <tr style={{ background: 'var(--c-hl-info)' }}>
                          <td className="text-xs text-app-muted">{fecha}</td>

                          <CeldaGrid
                            f={FILA_NUEVA} c={COL_CLIENTE}
                            activa={gridReg.esActiva(FILA_NUEVA, COL_CLIENTE)}
                            tabbable={gridReg.esTabbable(FILA_NUEVA, COL_CLIENTE)}
                            copiada={gridReg.esCopiada(FILA_NUEVA, COL_CLIENTE)}
                            editando={gridReg.editando}
                            editable
                            caret="ninguno"
                            contenido={empresaOptions.find(o => o.value === nuevo.empresa_id)?.label}
                            onSeleccionar={() => gridReg.seleccionar(FILA_NUEVA, COL_CLIENTE)}
                            onEditar={() => gridReg.editarCelda(FILA_NUEVA, COL_CLIENTE)}
                            editor={
                              <Combobox
                                className={CLASE_EDITOR}
                                options={empresaOptions}
                                value={nuevo.empresa_id}
                                onChange={(val) => {
                                  const next = { ...nuevo, empresa_id: val }
                                  if (val) {
                                    const emp = empresas.find(x => x.id === val)
                                    if (emp) next.tipo_atencion = emp.tipo
                                  }
                                  setNuevo(next)
                                }}
                                onCommit={() => gridReg.terminarEdicion()}
                                // La celda ya recibió la 1ª letra: se siembra aquí para no
                                // perderla mientras el combo se monta y toma el foco.
                                semilla={gridReg.semilla}
                                // Vales seguidos suelen ser del mismo cliente: se propone
                                // el anterior en tenue y se acepta con Enter o Tab.
                                sugerencia={clienteSugerido}
                                abrirAlEnfocar={false}
                                placeholder="Cliente…"
                              />
                            }
                          />

                          {celdaReg.input(FILA_NUEVA, 2, nuevo.numero, v => setNuevo(p => ({ ...p, numero: v })), { placeholder: 'Nº vale' })}
                          {celdaReg.input(FILA_NUEVA, 3, nuevo.serie, v => setNuevo(p => ({ ...p, serie: v })), { placeholder: 'Serie' })}
                          {celdaReg.input(FILA_NUEVA, 4, nuevo.placa, v => setNuevo(p => ({ ...p, placa: v })), { placeholder: 'Placa', mayusculas: true })}
                          {celdaReg.input(FILA_NUEVA, 5, nuevo.conductor, v => setNuevo(p => ({ ...p, conductor: v })), { placeholder: 'Conductor' })}
                          {celdaReg.input(FILA_NUEVA, 6, nuevo.dni_conductor, v => setNuevo(p => ({ ...p, dni_conductor: v })), { placeholder: 'DNI', maxLength: 8 })}

                          {celdaReg.select(
                            FILA_NUEVA, 7, nuevo.turno_id,
                            turnoOptions.find(o => o.value === nuevo.turno_id)?.label ?? '',
                            v => setNuevo(p => ({ ...p, turno_id: v })),
                            turnoOptions, turnoIdPorTecla
                          )}
                          {celdaReg.select(
                            FILA_NUEVA, 8, nuevo.tipo_combustible, nuevo.tipo_combustible,
                            v => setNuevo(p => ({ ...p, tipo_combustible: v })),
                            combustibles.map(c => ({ value: c.codigo, label: c.codigo })),
                            combustibleCodigoPorTecla, true
                          )}
                          {celdaReg.input(FILA_NUEVA, 9, nuevo.cantidad_galones, v => setNuevo(p => ({ ...p, cantidad_galones: v })), { numero: true, step: '0.001', placeholder: '0.000' })}

                          {celdaReg.lectura(
                            FILA_NUEVA, 10,
                            parseFloat(nuevo.cantidad_galones) > 0 && nuevo.tipo_combustible
                              ? fs(Math.round(parseFloat(nuevo.cantidad_galones) * precioDiario(nuevo.tipo_combustible)))
                              : '—',
                            'right', undefined, 'font-mono font-medium text-primary-text'
                          )}
                          {celdaReg.lectura(FILA_NUEVA, 11, '—', 'center', { background: 'var(--c-hl-warn)' })}

                          <td>
                            <button
                              className="btn-primary h-6 w-full py-0 text-xs"
                              disabled={!nuevo.tipo_combustible || !(parseFloat(nuevo.cantidad_galones) > 0) || savingReg}
                              onClick={saveRegistro}
                            >
                              {savingReg ? '…' : '+ Agregar'}
                            </button>
                          </td>
                        </tr>

                        {/* Registros guardados — editables en línea, sin botón "Editar" */}
                        {registros.map((r, i) => {
                          const inputs = regInputsMap[r.id]
                          if (!inputs) return null

                          const f = i + 1
                          const galonesEditados = parseFloat(inputs.cantidad_galones) || 0
                          const precioFila = precioDeFila(r, inputs.tipo_combustible)

                          // VARIACIÓN = lo que esta fila aporta al REDONDEO del turno: la brecha
                          // entre lo que le cobramos al cliente de crédito (galones × precio de
                          // 2 decimales) y lo que marcó la consola (que usa más decimales).
                          // `—` cuando la venta nació en COMPLETO: sin total declarado no hay
                          // referencia. No depende del precio del día para las filas ya cerradas.
                          const declarado = r.importe_declarado_centimos
                          const importeActual =
                            galonesEditados > 0
                              ? Math.round(galonesEditados * precioFila)
                              : toCentimos(inputs.importe)
                          const variacion = declarado == null ? null : importeActual - declarado

                          // Esta fila se grabó con otro precio del que hoy rige. Se ofrece
                          // revalorarla SOLO a ella: es la salida cuando el precio cambió de
                          // verdad a media jornada y unas ventas están bien y otras no.
                          const precioHoy = precioDiario(inputs.tipo_combustible)
                          const pieReprecio =
                            galonesEditados > 0 && precioHoy > 0 && precioFila !== precioHoy ? (
                              <button
                                type="button"
                                className="mt-0.5 block w-full text-right text-[10px] text-amber-600 hover:underline"
                                title={
                                  `Esta venta se registró a ${fs(precioFila)} por galón y hoy el precio ` +
                                  `es ${fs(precioHoy)}. Clic para revalorarla al precio de hoy.`
                                }
                                onClick={() => reajustarPrecios([r])}
                              >
                                ↻ {(precioHoy / 100).toFixed(2)} = {fs(Math.round(galonesEditados * precioHoy))}
                              </button>
                            ) : null

                          return (
                            <tr key={r.id} className={r.cantidad_galones === 0 ? 'bg-amber-50/60' : undefined}>
                              <td className="text-xs text-app-muted">{fecha}</td>

                              {/* Cliente */}
                              <CeldaGrid
                                f={f} c={COL_CLIENTE}
                                activa={gridReg.esActiva(f, COL_CLIENTE)}
                                tabbable={gridReg.esTabbable(f, COL_CLIENTE)}
                                copiada={gridReg.esCopiada(f, COL_CLIENTE)}
                                editando={gridReg.editando}
                                editable
                                caret="ninguno"
                                contenido={empresaOptions.find(o => o.value === inputs.empresa_id)?.label}
                                onSeleccionar={() => gridReg.seleccionar(f, COL_CLIENTE)}
                                onEditar={() => gridReg.editarCelda(f, COL_CLIENTE)}
                                editor={
                                  <Combobox
                                    className={CLASE_EDITOR}
                                    options={empresaOptions}
                                    value={inputs.empresa_id}
                                    onChange={val => handleRegInputChange(r.id, 'empresa_id', val)}
                                    onCommit={val => { guardarCelda(f, COL_CLIENTE, val); gridReg.terminarEdicion() }}
                                    semilla={gridReg.semilla}
                                    placeholder="Cliente…"
                                  />
                                }
                              />

                              {celdaReg.input(f, 2, inputs.numero, v => handleRegInputChange(r.id, 'numero', v))}
                              {celdaReg.input(f, 3, inputs.serie, v => handleRegInputChange(r.id, 'serie', v))}
                              {celdaReg.input(f, 4, inputs.placa, v => handleRegInputChange(r.id, 'placa', v), { mayusculas: true })}
                              {celdaReg.input(f, 5, inputs.conductor, v => handleRegInputChange(r.id, 'conductor', v))}
                              {celdaReg.input(f, 6, inputs.dni_conductor, v => handleRegInputChange(r.id, 'dni_conductor', v), { maxLength: 8 })}

                              {celdaReg.select(
                                f, 7, inputs.turno_id,
                                turnoOptions.find(o => o.value === inputs.turno_id)?.label ?? '',
                                v => handleRegInputChange(r.id, 'turno_id', v),
                                turnoOptions, turnoIdPorTecla
                              )}
                              {celdaReg.select(
                                f, 8, inputs.tipo_combustible, inputs.tipo_combustible,
                                v => handleRegInputChange(r.id, 'tipo_combustible', v),
                                combustibles.map(c => ({ value: c.codigo, label: c.codigo })),
                                combustibleCodigoPorTecla, r.cantidad_galones === 0
                              )}
                              {celdaReg.input(f, 9, inputs.cantidad_galones, v => handleRegInputChange(r.id, 'cantidad_galones', v), { numero: true, step: '0.001' })}

                              {/* PRECIO TOTAL: se escribe a mano solo en créditos rápidos (sin galones) */}
                              {galonesEditados === 0 ? (
                                celdaReg.input(f, 10, inputs.importe, v => handleRegInputChange(r.id, 'importe', v), { numero: true, step: '0.01' })
                              ) : (
                                celdaReg.lectura(
                                  f, COL_IMPORTE,
                                  <>
                                    <span className="block text-right font-mono text-xs font-medium text-slate-700">
                                      {fs(Math.round(galonesEditados * precioFila))}
                                    </span>
                                    {/* Total de consola declarado en ABREVIADO; la brecha va en VARIACIÓN. */}
                                    {declarado != null && declarado !== importeActual && (
                                      <span className="block text-right text-[10px] text-amber-600">
                                        consola: {fs(declarado)}
                                      </span>
                                    )}
                                  </>,
                                  'right', undefined, '', pieReprecio
                                )
                              )}

                              {celdaReg.lectura(
                                f, 11,
                                variacion === null
                                  ? '—'
                                  : `${variacion > 0 ? '+' : variacion < 0 ? '-' : ''}${fs(Math.abs(variacion))}`,
                                'right',
                                {
                                  background: 'var(--c-hl-warn)',
                                  color:
                                    variacion && variacion > 0 ? 'var(--c-pos-fg)'
                                    : variacion && variacion < 0 ? 'var(--c-neg-fg)'
                                    : 'var(--c-hl-warn-fg)',
                                },
                                'font-mono font-semibold'
                              )}

                              <td className="text-center">
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
                        <th style={{ width: 120, background: 'var(--c-hl-credit)', color: 'var(--c-hl-credit-fg)' }}>TOTAL CRÉDITOS</th>
                      ) : (
                        <>
                          <th style={{ width: 110, background: 'var(--c-hl-neutral)' }}>CORPORACIÓN</th>
                          <th style={{ width: 110, background: 'var(--c-hl-neutral)' }}>LICITACIONES</th>
                          <th style={{ width: 110, background: 'var(--c-hl-neutral)' }}>PARTICULARES</th>
                          <th style={{ width: 95,  background: 'var(--c-hl-neutral)' }}>CHEVRON</th>
                        </>
                      )}
                      <th style={{ width: 110, background: 'var(--c-hl-accent)', color: 'var(--c-hl-accent-fg)' }}>PRUEBAS / SERAF.</th>
                      <th style={{ width: 90 }}>REDONDEO</th>
                      <th style={{ width: 120, background: 'var(--c-hl-cash)', color: 'var(--c-hl-cash-fg)' }}>EFECTIVO</th>
                      <th style={{ width: 130, background: 'var(--c-hl-cash)', color: 'var(--c-hl-cash-fg)' }}>ENTREGADO SOBRE</th>
                      <th style={{ width: 130, background: 'var(--c-hl-cash)', color: 'var(--c-hl-cash-fg)' }}>CONTABILIZADO</th>
                      <th style={{ width: 120, background: 'var(--c-hl-cash)', color: 'var(--c-hl-cash-fg)' }}>FALTANTE/SOBRANTE</th>
                      <th style={{ width: 110 }}>COLABORADOR</th>
                    </tr>
                  </thead>
                  <tbody>
                    
                    {/* Fila de Gran Total Mensual */}
                    <tr className="font-bold text-slate-800" style={{ background: 'var(--c-hl-accent)' }}>
                      <td className="text-left font-bold text-amber-955 px-2 py-1.5" colSpan={2}>
                        {nombreMes}
                      </td>
                      <td className="text-right font-mono text-xs">{fs(totalMensual.total_consola)}</td>
                      <td className="text-right font-mono text-xs">{fs(totalMensual.yape)}</td>
                      <td className="text-right font-mono text-xs">{fs(totalMensual.openpay)}</td>
                      <td className="text-right font-mono text-xs">{fs(totalMensual.deposito)}</td>
                      <td className="text-right font-mono text-xs">{fs(totalMensual.vales)}</td>
                      {modo === 'abreviado' ? (
                        <td className="text-right font-mono text-xs" style={{ background: 'var(--c-hl-credit)' }}>
                          {fs(totalMensual.corporacion + totalMensual.licitaciones + totalMensual.particulares + totalMensual.chevron)}
                        </td>
                      ) : (
                        <>
                          <td className="text-right font-mono text-xs" style={{ background: 'var(--c-hl-neutral2)' }}>{fs(totalMensual.corporacion)}</td>
                          <td className="text-right font-mono text-xs" style={{ background: 'var(--c-hl-neutral2)' }}>{fs(totalMensual.licitaciones)}</td>
                          <td className="text-right font-mono text-xs" style={{ background: 'var(--c-hl-neutral2)' }}>{fs(totalMensual.particulares)}</td>
                          <td className="text-right font-mono text-xs" style={{ background: 'var(--c-hl-neutral2)' }}>{fs(totalMensual.chevron)}</td>
                        </>
                      )}
                      <td className="text-right font-mono text-xs" style={{ background: 'var(--c-hl-accent2)' }}>{fs(totalMensual.serafinado + totalMensual.contaminacion)}</td>
                      <td className="text-right font-mono text-xs">{fs(totalMensual.redondeo)}</td>
                      <td className="text-right font-mono text-xs text-green-800" style={{ background: 'var(--c-hl-cash2)' }}>{fs(totalMensual.efectivo_final)}</td>
                      <td className="text-right font-mono text-xs text-green-800" style={{ background: 'var(--c-hl-cash2)' }}>{fs(totalMensual.entregado_grifero)}</td>
                      <td className="text-right font-mono text-xs text-green-800" style={{ background: 'var(--c-hl-cash2)' }}>{fs(totalMensual.contabilizado_admin)}</td>
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
                      const diaVales = sumCentimos(turnosDelDia.map(c => c.dscto_vales_centimos))
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
                                <td className="text-right font-mono text-xs">{fs(c.dscto_vales_centimos)}</td>
                                
                                {modo === 'abreviado' ? (
                                  <td className="text-right font-mono text-xs font-medium" style={{ background: 'var(--c-hl-credit)' }}>
                                    {fs(totalCreditos)}
                                  </td>
                                ) : (
                                  <>
                                    <td className="text-right font-mono text-xs" style={{ background: 'var(--c-hl-neutral)' }}>{fs(c.corporacion_centimos)}</td>
                                    <td className="text-right font-mono text-xs" style={{ background: 'var(--c-hl-neutral)' }}>{fs(c.licitaciones_centimos)}</td>
                                    <td className="text-right font-mono text-xs" style={{ background: 'var(--c-hl-neutral)' }}>{fs(c.particulares_centimos)}</td>
                                    <td className="text-right font-mono text-xs" style={{ background: 'var(--c-hl-neutral)' }}>{fs(c.chevron_centimos)}</td>
                                  </>
                                )}

                                <td className="text-right font-mono text-xs" style={{ background: 'var(--c-hl-warn)' }}>
                                  {fs(c.serafinado_centimos + c.contaminacion_centimos)}
                                </td>
                                <td className="text-right font-mono text-xs">{fs(c.redondeo_centimos)}</td>
                                <td className="text-right font-mono text-xs font-semibold" style={{ background: 'var(--c-hl-cash-soft)' }}>{fs(c.efectivo_final_centimos)}</td>
                                <td className="text-right font-mono text-xs" style={{ background: 'var(--c-hl-cash-soft)' }}>{fs(c.entregado_grifero_centimos)}</td>
                                <td className="text-right font-mono text-xs" style={{ background: 'var(--c-hl-cash-soft)' }}>{fs(c.contabilizado_admin_centimos)}</td>
                                {renderDiferencia(c.faltante_sobrante_centimos)}
                                <td className="text-center text-xs text-slate-600 truncate" style={{ maxWidth: 100 }}>{c.colaborador_nombre}</td>
                              </tr>
                            )
                          })}

                          {/* Fila consolidada (DIA) */}
                          <tr className="font-bold border-b-2 border-slate-300" style={{ background: 'var(--c-hl-cash)' }}>
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
                              <td className="text-right font-mono text-xs text-green-950" style={{ background: 'var(--c-hl-credit)' }}>
                                {fs(diaCorporacion + diaLicitaciones + diaParticulares + diaChevron)}
                              </td>
                            ) : (
                              <>
                                <td className="text-right font-mono text-xs text-green-950" style={{ background: 'var(--c-hl-neutral2)' }}>{fs(diaCorporacion)}</td>
                                <td className="text-right font-mono text-xs text-green-950" style={{ background: 'var(--c-hl-neutral2)' }}>{fs(diaLicitaciones)}</td>
                                <td className="text-right font-mono text-xs text-green-950" style={{ background: 'var(--c-hl-neutral2)' }}>{fs(diaParticulares)}</td>
                                <td className="text-right font-mono text-xs text-green-950" style={{ background: 'var(--c-hl-neutral2)' }}>{fs(diaChevron)}</td>
                              </>
                            )}

                            <td className="text-right font-mono text-xs text-green-950" style={{ background: 'var(--c-hl-accent2)' }}>{fs(diaSerafinado + diaContaminacion)}</td>
                            <td className="text-right font-mono text-xs text-green-950">{fs(diaRedondeo)}</td>
                            <td className="text-right font-mono text-xs text-green-800" style={{ background: 'var(--c-hl-cash2)' }}>{fs(diaEfectivoFinal)}</td>
                            <td className="text-right font-mono text-xs text-green-800" style={{ background: 'var(--c-hl-cash2)' }}>{fs(diaEntregado)}</td>
                            <td className="text-right font-mono text-xs text-green-800" style={{ background: 'var(--c-hl-cash2)' }}>{fs(diaContabilizado)}</td>
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
