import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/features/auth/useAuth'
import { usePersistedState } from '@/lib/usePersistedState'
import { useTheme } from '@/lib/theme'
import { hoyLocal } from '@/lib/date'
import type { OsinergminSnapshot, OsinergminTop10 } from '@/types'

const PRODUCTOS = [
  { code: 'DB5', label: 'Diesel B5' },
  { code: 'REGULAR', label: 'Gasohol Regular' },
  { code: 'PREMIUM', label: 'Gasohol Premium' },
] as const

type ProductoCode = (typeof PRODUCTOS)[number]['code']

// Colores de serie del gráfico (paleta categórica validada sobre fondo blanco
// con el validador de dataviz: ΔE adyacente ≥ 21, banda de luminosidad OK).
// El color sigue SIEMPRE al producto (no se reasigna al filtrar).
const SERIE_COLOR: Record<ProductoCode, string> = {
  DB5: '#2a78d6',      // azul
  REGULAR: '#1baf7a',  // verde aqua
  PREMIUM: '#eda100',  // ámbar
}

// Serie de contexto "total de empresas del distrito": gris neutro (no es un
// producto, es la referencia del tamaño del campo). Va aparte de la paleta.
const EMPRESAS_COLOR = '#64748B'

// Fecha local YYYY-MM-DD desplazada N días hacia atrás (para el rango por defecto).
function haceDias(n: number): string {
  const d = new Date()
  d.setDate(d.getDate() - n)
  const off = d.getTimezoneOffset() * 60000
  return new Date(d.getTime() - off).toISOString().slice(0, 10)
}

const soles = (centimos: number | null): string =>
  centimos == null ? '—' : 'S/ ' + (centimos / 100).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

// Tiempo relativo derivado de la fecha REAL de Supabase (no inventado por la app).
function tiempoRelativo(iso: string, ahora: Date): string {
  const min = Math.round((ahora.getTime() - new Date(iso).getTime()) / 60000)
  if (min < 1) return 'recién'
  if (min < 60) return `hace ${min} min`
  const h = Math.round(min / 60)
  if (h < 24) return `hace ${h} h`
  return `hace ${Math.round(h / 24)} d`
}

function rankingDe(snap: OsinergminSnapshot, code: string): number | null {
  if (code === 'DB5') return snap.ranking_db5
  if (code === 'REGULAR') return snap.ranking_regular
  if (code === 'PREMIUM') return snap.ranking_premium
  return null
}
function precioDe(snap: OsinergminSnapshot, code: string): number | null {
  if (code === 'DB5') return snap.precio_db5_centimos
  if (code === 'REGULAR') return snap.precio_regular_centimos
  if (code === 'PREMIUM') return snap.precio_premium_centimos
  return null
}
// El "de N" del puesto es el nº de grifos que venden ESE producto, no el total
// del distrito (no todos venden los tres). Los snapshots previos a la migración
// 015 no lo traen: se cae al total de la zona.
function totalDe(snap: OsinergminSnapshot, code: string): number {
  const t =
    code === 'DB5' ? snap.total_db5
    : code === 'REGULAR' ? snap.total_regular
    : code === 'PREMIUM' ? snap.total_premium
    : null
  return t ?? snap.total_establecimientos
}

// ─── Gráfico de evolución de rankings ─────────────────────────────
// SVG hecho a mano (sin librerías) para no sumar dependencias a la PWA.
// Eje Y INVERTIDO a propósito: el puesto #1 (mejor precio) va arriba.
// Líneas para leer la tendencia; barras como vista alternativa. La tabla de
// abajo sigue disponible como respaldo accesible de los mismos datos.

type TipoGrafico = 'lineas' | 'barras'

// `refreshKey` cambia cuando la página recibe un snapshot nuevo (Realtime) →
// el gráfico re-consulta su rango para no quedar desfasado.
function RankingChart({ refreshKey }: { refreshKey: string | number | null }) {
  // Colores del SVG según tema: los atributos de presentación SVG (stroke/fill)
  // no resuelven var(--…) de CSS, así que se eligen aquí en JS.
  const { theme } = useTheme()
  const dark = theme === 'dark'
  const CHART = {
    grid: dark ? '#334155' : '#E2E8F0',
    axis: dark ? '#475569' : '#CBD5E1',
    label: dark ? '#94A3B8' : '#64748B',
    labelStrong: dark ? '#CBD5E1' : '#334155',
    pointStroke: dark ? '#1E293B' : '#FFFFFF',
    dotOff: dark ? '#475569' : '#CBD5E1',
  }
  const [tipo, setTipo] = usePersistedState<TipoGrafico>('osinergmin.grafico.tipo', 'lineas')
  const [visiblesRaw, setVisibles] = usePersistedState<ProductoCode[]>(
    'osinergmin.grafico.productos',
    PRODUCTOS.map(p => p.code),
  )
  // Comparar el ranking con el total de empresas del distrito (tamaño del campo).
  const [verEmpresas, setVerEmpresas] = usePersistedState('osinergmin.grafico.empresas', false)
  // Rango de fechas propio del gráfico (por defecto, últimos 30 días).
  const [desde, setDesde] = usePersistedState('osinergmin.grafico.desde', () => haceDias(30))
  // `hasta` se persiste, pero mientras el usuario no lo fije a mano SIGUE a "hoy".
  // Guardar la fecha absoluta hacía que, al día siguiente, el gráfico dejara
  // fuera el snapshot más reciente y mostrara un puesto distinto al de las
  // tarjetas de arriba (que siempre leen el último snapshot).
  const [hastaFijo, setHastaFijo] = usePersistedState('osinergmin.grafico.hasta', hoyLocal)
  const [hastaSigueHoy, setHastaSigueHoy] = usePersistedState('osinergmin.grafico.hastaSigueHoy', true)
  const hasta = hastaSigueHoy ? hoyLocal() : hastaFijo
  function aplicarHasta(v: string) {
    setHastaFijo(v)
    setHastaSigueHoy(v === hoyLocal())
  }
  const [hoverIdx, setHoverIdx] = useState<number | null>(null)

  // Datos del rango (se cargan aquí, sin depender del límite de la página)
  const [serie, setSerie] = useState<OsinergminSnapshot[]>([])
  const [cargando, setCargando] = useState(true)

  const desdeRef = useRef<HTMLInputElement>(null)
  const hastaRef = useRef<HTMLInputElement>(null)
  const encadenarHastaRef = useRef(false)

  // Ancho responsivo del contenedor
  const contRef = useRef<HTMLDivElement>(null)
  const [ancho, setAncho] = useState(0)
  useEffect(() => {
    const el = contRef.current
    if (!el) return
    const ro = new ResizeObserver(entries => setAncho(entries[0].contentRect.width))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Carga los snapshots del rango (fecha_consulta entre desde y hasta), asc.
  // `fecha_consulta` es timestamptz: hay que mandar instantes UTC. Comparar
  // contra el texto "YYYY-MM-DD" lo interpretaba como medianoche UTC y recortaba
  // las últimas 5 horas del día en Perú (UTC-5) — justo donde suele caer el
  // snapshot más reciente del cron.
  useEffect(() => {
    let cancel = false
    setCargando(true)
    supabase
      .from('osinergmin_snapshots')
      .select('*')
      .gte('fecha_consulta', new Date(`${desde}T00:00:00`).toISOString())
      .lte('fecha_consulta', new Date(`${hasta}T23:59:59.999`).toISOString())
      .order('fecha_consulta', { ascending: true })
      .then(({ data }) => {
        if (cancel) return
        setSerie((data as OsinergminSnapshot[]) ?? [])
        setCargando(false)
      })
    return () => { cancel = true }
  }, [desde, hasta, refreshKey])

  // Rango coherente (si se cruzan las fechas, se corrige la otra)
  function cambiarDesde(v: string) {
    if (!v) return
    setDesde(v)
    if (hasta && v > hasta) aplicarHasta(v)
    if (encadenarHastaRef.current) {
      encadenarHastaRef.current = false
      try { hastaRef.current?.showPicker() } catch { /* requiere gesto; se ignora */ }
    }
  }
  function cambiarHasta(v: string) {
    if (!v) return
    aplicarHasta(v)
    if (desde && v < desde) setDesde(v)
  }
  function abrirCalendarios() {
    encadenarHastaRef.current = true
    try { desdeRef.current?.showPicker() } catch { desdeRef.current?.focus() }
  }
  function preset(dias: number) {
    setDesde(haceDias(dias))
    aplicarHasta(hoyLocal())
  }

  // Sanea lo persistido (por si quedó un valor viejo en localStorage)
  const visibles = useMemo(
    () => {
      const v = visiblesRaw.filter(c => PRODUCTOS.some(p => p.code === c))
      return v.length > 0 ? v : PRODUCTOS.map(p => p.code)
    },
    [visiblesRaw],
  )

  // El usuario elige ver 3, 2 o 1 producto; siempre queda al menos uno.
  function toggleProducto(code: ProductoCode) {
    setVisibles(() => {
      if (visibles.includes(code)) {
        return visibles.length > 1 ? visibles.filter(c => c !== code) : visibles
      }
      const next = new Set([...visibles, code])
      return PRODUCTOS.map(p => p.code).filter(c => next.has(c))
    })
  }

  const n = serie.length

  // ── Geometría ──
  const H = 240
  const mt = 14, mb = 26, ml = 38, mr = 92
  const plotW = Math.max(ancho - ml - mr, 60)
  const plotH = H - mt - mb
  const band = plotW / Math.max(n, 1)
  const x = (i: number) => ml + band * (i + 0.5)

  const maxRank = useMemo(() => {
    let m = 0
    for (const s of serie) for (const c of visibles) m = Math.max(m, rankingDe(s, c) ?? 0)
    return m
  }, [serie, visibles])
  const maxEmpresas = useMemo(() => {
    let m = 0
    for (const s of serie) m = Math.max(m, s.total_establecimientos ?? 0)
    return m
  }, [serie])
  // Dominio 1 → yMax (con holgura para que el último puesto no quede en 0px).
  // Con el comparativo activo, el eje llega hasta el total de empresas (así el
  // puesto se lee EN CONTEXTO: #5 de 12 no es lo mismo que #5 de 60).
  const yMax = verEmpresas
    ? Math.max(maxEmpresas + 1, maxRank + 1, 5)
    : Math.max(maxRank + 1, 5)
  const y = (rank: number) => mt + ((rank - 1) / (yMax - 1)) * plotH
  const tickStep = Math.max(1, Math.ceil((yMax - 1) / 5))
  const ticks: number[] = []
  for (let r = 1; r <= yMax; r += tickStep) ticks.push(r)

  // Índices de fechas a rotular (≈6, sin choques)
  const labelStep = Math.max(1, Math.ceil(n / 6))
  const fechaCorta = (iso: string) =>
    new Date(iso).toLocaleDateString('es-PE', { day: '2-digit', month: '2-digit' })

  // Puntos por producto (saltando snapshots sin dato para ese producto)
  const puntosDe = (code: ProductoCode) => {
    const pts: { i: number; r: number }[] = []
    for (let i = 0; i < n; i++) {
      const r = rankingDe(serie[i], code)
      if (r != null) pts.push({ i, r })
    }
    return pts
  }

  // Path de línea con cortes donde falta el dato
  const pathDe = (code: ProductoCode) => {
    let d = ''
    let prevI = -2
    for (const { i, r } of puntosDe(code)) {
      d += `${i === prevI + 1 && d ? ' L' : ' M'}${x(i).toFixed(1)},${y(r).toFixed(1)}`
      prevI = i
    }
    return d.trim()
  }

  // Barra con punta redondeada (4px) solo en el extremo del dato; base recta.
  const barPath = (bx: number, top: number, w: number, bottom: number) => {
    const rr = Math.min(4, w / 2, Math.max(bottom - top, 0))
    return (
      `M${bx},${bottom} L${bx},${top + rr}` +
      ` Q${bx},${top} ${bx + rr},${top}` +
      ` L${bx + w - rr},${top}` +
      ` Q${bx + w},${top} ${bx + w},${top + rr}` +
      ` L${bx + w},${bottom} Z`
    )
  }

  // Etiquetas al final de cada línea ("#3 DB5"), separadas si chocan
  const endLabels = useMemo(() => {
    const labels: { code: ProductoCode; yPunto: number; yLabel: number; rank: number }[] = []
    for (const code of visibles) {
      const pts = puntosDe(code)
      if (pts.length === 0) continue
      const ult = pts[pts.length - 1]
      const yy = y(ult.r)
      labels.push({ code, yPunto: yy, yLabel: yy, rank: ult.r })
    }
    labels.sort((a, b) => a.yPunto - b.yPunto)
    for (let i = 1; i < labels.length; i++) {
      if (labels[i].yLabel - labels[i - 1].yLabel < 13) {
        labels[i].yLabel = labels[i - 1].yLabel + 13
      }
    }
    return labels
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serie, visibles, yMax, plotH])

  const visProductos = PRODUCTOS.filter(p => visibles.includes(p.code))
  const hayDatos = maxRank > 0 || (verEmpresas && maxEmpresas > 0)

  // Path de la línea de "total de empresas" (contexto), con cortes si faltara.
  const pathEmpresas = useMemo(() => {
    let d = ''
    let prevI = -2
    for (let i = 0; i < n; i++) {
      const v = serie[i].total_establecimientos
      if (v == null) continue
      d += `${i === prevI + 1 && d ? ' L' : ' M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`
      prevI = i
    }
    return d.trim()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serie, n, yMax, plotH, plotW, ancho])

  // Hover: snapshot más cercano al cursor
  function onMove(e: React.MouseEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect()
    const mx = e.clientX - rect.left
    if (mx < ml || mx > ml + plotW || n === 0) { setHoverIdx(null); return }
    const idx = Math.min(n - 1, Math.max(0, Math.floor((mx - ml) / band)))
    setHoverIdx(idx)
  }

  const snapHover = hoverIdx != null ? serie[hoverIdx] : null
  const tooltipIzquierda = hoverIdx != null && hoverIdx > n / 2

  return (
    <div className="card !p-4">
      {/* Fila 1 — leyenda/filtro de productos + comparativo + tipo de gráfico */}
      <div className="mb-2 flex flex-wrap items-center gap-2">
        {PRODUCTOS.map(p => {
          const on = visibles.includes(p.code)
          return (
            <button
              key={p.code}
              onClick={() => toggleProducto(p.code)}
              className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors ${
                on
                  ? 'border-app-border bg-white text-app-text'
                  : 'border-app-border bg-slate-100 text-app-muted'
              }`}
              title={on ? 'Clic para ocultar este producto' : 'Clic para mostrar este producto'}
            >
              <span
                className="inline-block h-2.5 w-2.5 rounded-full"
                style={{ background: on ? SERIE_COLOR[p.code] : CHART.dotOff }}
              />
              {p.label}
            </button>
          )
        })}

        {/* Comparativo con el nº de empresas del distrito (tamaño del campo) */}
        <button
          onClick={() => setVerEmpresas(v => !v)}
          className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors ${
            verEmpresas ? 'border-app-border bg-white text-app-text' : 'border-app-border bg-slate-100 text-app-muted'
          }`}
          title="Añade la línea del total de empresas del distrito para leer tu puesto en contexto"
        >
          <span
            className="inline-block h-0 w-3.5 border-t-2 border-dashed"
            style={{ borderColor: verEmpresas ? EMPRESAS_COLOR : CHART.dotOff }}
          />
          Nº empresas
        </button>

        <div className="ml-auto flex overflow-hidden rounded border border-app-border bg-white">
          {([['lineas', 'LÍNEAS'], ['barras', 'BARRAS']] as [TipoGrafico, string][]).map(([m, label]) => (
            <button
              key={m}
              onClick={() => setTipo(m)}
              className={`px-2 py-1 text-[11px] font-bold transition-colors ${
                tipo === m ? 'bg-primary text-primary-text' : 'bg-white text-app-muted hover:bg-slate-50'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Fila 2 — rango de fechas (escribir o elegir en calendario) + presets */}
      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        <button
          className="btn-ghost px-1.5 py-1"
          onClick={abrirCalendarios}
          title="Elegir el rango en los calendarios (desde y luego hasta)"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <rect x="3" y="4" width="18" height="17" rx="2" />
            <line x1="16" y1="2" x2="16" y2="6" />
            <line x1="8" y1="2" x2="8" y2="6" />
            <line x1="3" y1="10" x2="21" y2="10" />
          </svg>
        </button>
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
        <div className="ml-1 flex gap-1">
          {([[7, '7d'], [30, '30d'], [90, '90d'], [365, '1a']] as [number, string][]).map(([d, l]) => (
            <button
              key={d}
              onClick={() => preset(d)}
              className="rounded border border-app-border px-1.5 py-0.5 text-[11px] text-app-muted transition-colors hover:bg-app-border hover:text-app-text"
            >
              {l}
            </button>
          ))}
        </div>
      </div>

      <div ref={contRef} className="relative">
        {cargando ? (
          <p className="py-10 text-center text-xs text-app-muted">Cargando…</p>
        ) : !hayDatos ? (
          <p className="py-10 text-center text-xs text-app-muted">
            Sin rankings en el rango de fechas seleccionado.
          </p>
        ) : ancho > 0 && (
          <svg
            width={ancho}
            height={H}
            onMouseMove={onMove}
            onMouseLeave={() => setHoverIdx(null)}
            role="img"
            aria-label="Evolución del ranking de precios por producto"
          >
            {/* Rejilla horizontal + etiquetas de puesto */}
            {ticks.map(r => (
              <g key={r}>
                <line x1={ml} x2={ml + plotW} y1={y(r)} y2={y(r)} stroke={CHART.grid} strokeWidth={1} />
                <text x={ml - 6} y={y(r) + 3} textAnchor="end" fontSize={10} fill={CHART.label}>
                  #{r}
                </text>
              </g>
            ))}
            {/* Línea base inferior */}
            <line x1={ml} x2={ml + plotW} y1={mt + plotH} y2={mt + plotH} stroke={CHART.axis} strokeWidth={1} />

            {/* Fechas del eje X */}
            {serie.map((s, i) =>
              (i % labelStep === 0 || i === n - 1) ? (
                <text key={s.id} x={x(i)} y={H - 8} textAnchor="middle" fontSize={10} fill={CHART.label}>
                  {fechaCorta(s.fecha_consulta)}
                </text>
              ) : null
            )}

            {/* Resaltado de la banda al pasar el mouse */}
            {hoverIdx != null && (
              <rect
                x={ml + band * hoverIdx} y={mt} width={band} height={plotH}
                fill="rgba(148,163,184,0.12)"
              />
            )}

            {/* ── Comparativo: total de empresas (contexto, gris punteado) ── */}
            {verEmpresas && maxEmpresas > 0 && (
              <>
                <path
                  d={pathEmpresas}
                  fill="none"
                  stroke={EMPRESAS_COLOR}
                  strokeWidth={2}
                  strokeDasharray="5 4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  opacity={0.85}
                />
                {(() => {
                  const ult = serie[n - 1]?.total_establecimientos
                  if (ult == null) return null
                  return (
                    <text x={ml + plotW + 8} y={y(ult) + 3} fontSize={10} fill={EMPRESAS_COLOR}>
                      <tspan fontWeight={700}>{ult}</tspan>
                      <tspan dx={3} fontSize={9}>empresas</tspan>
                    </text>
                  )
                })()}
              </>
            )}

            {/* ── Barras ── */}
            {tipo === 'barras' && serie.map((s, i) => {
              const conDato = visProductos.filter(p => rankingDe(s, p.code) != null)
              const k = conDato.length
              if (k === 0) return null
              const barW = Math.max(2, Math.min(24, (band * 0.8 - 2 * (k - 1)) / k))
              const groupW = k * barW + 2 * (k - 1)
              const x0 = x(i) - groupW / 2
              return (
                <g key={s.id}>
                  {conDato.map((p, j) => {
                    const r = rankingDe(s, p.code)!
                    const top = y(r)
                    return (
                      <path
                        key={p.code}
                        d={barPath(x0 + j * (barW + 2), top, barW, mt + plotH)}
                        fill={SERIE_COLOR[p.code]}
                      />
                    )
                  })}
                  {/* Puesto sobre las barras del último snapshot (si hay sitio) */}
                  {i === n - 1 && barW >= 14 && conDato.map((p, j) => (
                    <text
                      key={`lbl-${p.code}`}
                      x={x0 + j * (barW + 2) + barW / 2}
                      y={y(rankingDe(s, p.code)!) - 4}
                      textAnchor="middle" fontSize={9} fontWeight={600} fill={CHART.labelStrong}
                    >
                      #{rankingDe(s, p.code)}
                    </text>
                  ))}
                </g>
              )
            })}

            {/* ── Líneas ── */}
            {tipo === 'lineas' && (
              <>
                {hoverIdx != null && (
                  <line
                    x1={x(hoverIdx)} x2={x(hoverIdx)} y1={mt} y2={mt + plotH}
                    stroke={CHART.axis} strokeWidth={1}
                  />
                )}
                {visProductos.map(p => (
                  <path
                    key={p.code}
                    d={pathDe(p.code)}
                    fill="none"
                    stroke={SERIE_COLOR[p.code]}
                    strokeWidth={2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                ))}
                {/* Puntos con anillo blanco para cruces legibles */}
                {visProductos.map(p =>
                  puntosDe(p.code).map(({ i, r }) => (
                    <circle
                      key={`${p.code}-${i}`}
                      cx={x(i)} cy={y(r)} r={4}
                      fill={SERIE_COLOR[p.code]} stroke={CHART.pointStroke} strokeWidth={2}
                    />
                  ))
                )}
                {/* Etiqueta al final de cada línea: "#puesto CÓDIGO" */}
                {endLabels.map(l => (
                  <g key={l.code}>
                    {Math.abs(l.yLabel - l.yPunto) > 5 && (
                      <line
                        x1={ml + plotW - band / 2 + 6} y1={l.yPunto}
                        x2={ml + plotW + 4} y2={l.yLabel - 3}
                        stroke={CHART.axis} strokeWidth={1}
                      />
                    )}
                    <text x={ml + plotW + 8} y={l.yLabel} fontSize={10} fill={CHART.labelStrong}>
                      <tspan fontWeight={700}>#{l.rank}</tspan>
                      <tspan fill={CHART.label} dx={3} fontSize={9}>{l.code}</tspan>
                    </text>
                  </g>
                ))}
              </>
            )}
          </svg>
        )}

        {/* Tooltip del snapshot bajo el cursor */}
        {snapHover && hayDatos && (
          <div
            className="pointer-events-none absolute z-10 w-56 rounded border border-app-border bg-white p-2 shadow-lg"
            style={{
              top: 6,
              left: tooltipIzquierda ? undefined : Math.min(x(hoverIdx!) + 10, ancho - 230),
              right: tooltipIzquierda ? Math.min(ancho - x(hoverIdx!) + 10, ancho - 230) : undefined,
            }}
          >
            <div className="mb-1 flex items-baseline justify-between gap-2">
              <span className="text-xs font-medium text-app-text">
                {new Date(snapHover.fecha_consulta).toLocaleString('es-PE', {
                  day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit',
                })}
              </span>
              <span className="whitespace-nowrap text-[11px] text-app-muted" style={{ color: verEmpresas ? EMPRESAS_COLOR : undefined }}>
                {snapHover.total_establecimientos} empresas
              </span>
            </div>
            {visProductos.map(p => {
              const r = rankingDe(snapHover, p.code)
              const precio = precioDe(snapHover, p.code)
              return (
                <div key={p.code} className="flex items-center gap-1.5 py-0.5 text-xs">
                  <span className="inline-block h-2 w-2 rounded-full" style={{ background: SERIE_COLOR[p.code] }} />
                  <span className="text-app-muted">{p.label}</span>
                  <span className="ml-auto font-mono font-semibold text-app-text">
                    {r != null ? `#${r}` : '—'}
                  </span>
                  <span className="font-mono text-app-muted">{soles(precio)}</span>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

export default function OsinergminPage() {
  const { role } = useAuth()
  const esSuperadmin = role === 'superadmin'

  const [snapshots, setSnapshots] = useState<OsinergminSnapshot[]>([])
  const [top10, setTop10] = useState<OsinergminTop10[]>([])
  const [loading, setLoading] = useState(true)

  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null)
  const [now, setNow] = useState(new Date())

  // `silent`: recarga en segundo plano (sin spinner) para el auto-refresco.
  async function cargar(silent = false) {
    if (!silent) setLoading(true)
    const { data: snaps } = await supabase
      .from('osinergmin_snapshots')
      .select('*')
      .order('fecha_consulta', { ascending: false })
      .limit(30)
    const lista = (snaps as OsinergminSnapshot[]) ?? []
    setSnapshots(lista)
    if (lista.length > 0) {
      const { data: t10 } = await supabase
        .from('osinergmin_top10')
        .select('*')
        .eq('snapshot_id', lista[0].id)
        .order('producto')
        .order('ranking')
      setTop10((t10 as OsinergminTop10[]) ?? [])
    } else {
      setTop10([])
    }
    if (!silent) setLoading(false)
  }

  useEffect(() => {
    cargar()
    // Reloj para el "hace X" (recalculado desde la fecha real de la BD).
    const reloj = setInterval(() => setNow(new Date()), 30000)

    // Realtime: Supabase EMPUJA el cambio cuando el cron toca la tabla; la app
    // solo re-consulta ante un cambio real (sin polling cada minuto).
    const canal = supabase
      .channel('osinergmin-snapshots')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'osinergmin_snapshots' },
        () => cargar(true),
      )
      .subscribe()

    // Red de seguridad: si Realtime se hubiera desconectado, al volver el foco
    // a la pestaña se re-consulta una vez.
    const onFocus = () => cargar(true)
    window.addEventListener('focus', onFocus)

    return () => {
      clearInterval(reloj)
      supabase.removeChannel(canal)
      window.removeEventListener('focus', onFocus)
    }
  }, [])

  async function actualizarAhora() {
    setRunning(true)
    setResult(null)
    try {
      // Todo el trabajo (descarga + parseo + ranking + guardado) lo hace la
      // Edge Function en el servidor con el parser liviano — mucho más rápido
      // que descargar y parsear en el navegador. Se autoriza como superadmin.
      const { data, error } = await supabase.functions.invoke('osinergmin-cron')
      if (error) {
        let msg = error.message
        try {
          const body = await (error as { context?: Response }).context?.json?.()
          if (body?.error) msg = body.error
        } catch { /* noop */ }
        throw new Error(msg)
      }
      if (!data?.ok) throw new Error(data?.error ?? 'Respuesta inesperada.')

      // `avisos`: columnas opcionales que el Excel dejó de traer (p. ej. la de
      // fecha, que desempata). No invalidan el ranking, pero deben verse: un
      // cambio de cabecera silencioso ya degradó el desempate una vez.
      const avisos: string[] = data.avisos ?? []
      const base = data.skipped
        ? `Revisado: sin cambios en ${data.distrito}.`
        : `Actualizado. ${data.distrito}, ${data.provincia} · ${data.total_establecimientos} establecimientos.`
      setResult({
        ok: avisos.length === 0,
        msg: avisos.length > 0 ? `${base} Ojo: ${avisos.join(' ')}` : base,
      })
      cargar()
    } catch (e) {
      setResult({ ok: false, msg: (e as Error).message })
    }
    setRunning(false)
  }

  const actual = snapshots[0] ?? null

  const top10PorProducto = useMemo(() => {
    const map: Record<string, OsinergminTop10[]> = {}
    for (const t of top10) (map[t.producto] ??= []).push(t)
    return map
  }, [top10])

  const BotonActualizar = esSuperadmin ? (
    <button className="btn-primary text-xs" onClick={actualizarAhora} disabled={running}>
      {running ? 'Procesando…' : 'Actualizar precios ahora'}
    </button>
  ) : null

  const BannerResultado = result ? (
    <div
      className={`mb-3 rounded-lg border px-3 py-2 text-xs font-medium ${
        result.ok
          ? 'border-success-dark bg-success text-success-text'
          : 'border-danger-dark bg-danger text-danger-text'
      }`}
    >
      {result.msg}
    </div>
  ) : null

  if (loading) return <div className="p-6 text-sm text-app-muted">Cargando…</div>

  if (!actual) {
    return (
      <div className="flex h-full flex-col items-center justify-center p-6">
        <div className="max-w-md text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary text-3xl">📊</div>
          <h2 className="mb-2 text-lg font-semibold text-app-text">Sin datos de OSINERGMIN</h2>
          <p className="mb-4 text-sm text-app-muted">
            Configura el link del Excel y tu RUC en <span className="font-medium">Configuración → OSINERGMIN</span>,
            luego pulsa el botón para traer los precios.
          </p>
          <div className="mx-auto max-w-sm">{BannerResultado}</div>
          {BotonActualizar}
        </div>
      </div>
    )
  }

  return (
    <div className="h-full overflow-auto p-4">
      {/* Encabezado. La zona lleva provincia y departamento porque el distrito
          solo no identifica el mercado: hay distritos homónimos (MIRAFLORES
          existe en Arequipa y en Lima). */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold text-app-text">
          Ranking de precios — Distrito {actual.distrito}
          {actual.provincia && (
            <span className="font-normal text-app-muted">
              {' '}· {actual.provincia}, {actual.departamento}
            </span>
          )}
        </h2>
        <div className="flex items-center gap-3">
          <span className="text-xs text-app-muted">
            {actual.total_establecimientos} establecimientos ·{' '}
            {new Date(actual.fecha_consulta).toLocaleString('es-PE')}{' '}
            <span className="text-app-text">({tiempoRelativo(actual.fecha_consulta, now)})</span>
          </span>
          {BotonActualizar}
        </div>
      </div>
      {BannerResultado}

      {/* Procedencia de los datos. Está a la vista a propósito: la web de
          OSINERGMIN (facilito) consulta una base viva y llega a mostrar algún
          grifo que el volcado oficial NO trae — el 2026-07-10 la web listaba 13
          grifos con Gasohol Regular en Miraflores y el Excel solo 12 (faltaba
          GRUPO CONSTRUCTOR FAMEK). Sin esta nota, esa diferencia se lee como un
          error de la app y no lo es. Facilito no se puede consultar desde el
          servidor: su buscador exige un token de reCAPTCHA v3. */}
      <p className="mb-4 text-xs text-app-muted">
        Fuente: <span className="text-app-text">Excel oficial «Últimos Precios Registrados — EVPC»</span> de
        OSINERGMIN (SCOP), el único canal que publican para consulta automática. La web de OSINERGMIN
        consulta una base viva y puede mostrar algún grifo que aún no está en ese Excel; si ves una
        diferencia, es eso y no un fallo del cálculo.
      </p>

      {/* Tarjetas de posición actual */}
      <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
        {PRODUCTOS.map((p) => {
          const rank = rankingDe(actual, p.code)
          const precio = precioDe(actual, p.code)
          return (
            <div key={p.code} className="card !p-4">
              <div className="text-xs font-semibold uppercase tracking-wide text-app-muted">{p.label}</div>
              <div className="mt-1 flex items-baseline gap-2">
                <span className="text-3xl font-bold text-primary-text">
                  {rank != null ? `#${rank}` : '—'}
                </span>
                {rank != null && (
                  <span className="text-xs text-app-muted">
                    de {totalDe(actual, p.code)} que lo venden
                  </span>
                )}
              </div>
              <div className="mt-1 font-mono text-sm text-app-text">{soles(precio)}</div>
              <div className="mt-0.5 text-xs text-app-muted">tu precio de venta</div>
            </div>
          )
        })}
      </div>

      {/* Top 10 por producto */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {PRODUCTOS.map((p) => {
          const filas = top10PorProducto[p.code] ?? []
          return (
            <div key={p.code}>
              <h3 className="mb-2 text-sm font-semibold text-app-text">
                {filas.length > 10 ? 'Top 10 + tu posición' : 'Top 10'} — {p.label}
              </h3>
              {filas.length === 0 ? (
                <p className="rounded border border-app-border bg-white p-3 text-xs text-app-muted">
                  Sin datos para este producto en tu distrito.
                </p>
              ) : (
                <table className="table-excel w-full table-fixed">
                  <thead>
                    <tr>
                      <th style={{ width: 32 }}>#</th>
                      <th>Establecimiento</th>
                      <th className="text-right" style={{ width: 82 }}>Precio</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filas.map((f) => (
                      <tr key={f.id} className={f.es_nuestro ? 'bg-primary/30 font-semibold' : ''}>
                        <td className="text-center font-mono text-xs align-top">{f.ranking}</td>
                        {/* La dirección va debajo del nombre porque una misma
                            empresa puede tener dos grifos en el distrito (p. ej.
                            COESTI): sin ella, dos filas se leen idénticas. */}
                        <td className="whitespace-normal text-xs align-top">
                          <span className="line-clamp-2 break-words" title={f.razon_social}>
                            {f.razon_social}
                            {f.es_nuestro && <span className="ml-1 text-primary-text">(nosotros)</span>}
                          </span>
                          {f.direccion && (
                            <span
                              className="mt-0.5 line-clamp-1 break-words text-[11px] font-normal text-app-muted"
                              title={f.direccion}
                            >
                              {f.direccion}
                            </span>
                          )}
                        </td>
                        <td className="whitespace-nowrap text-right align-top font-mono text-xs">
                          {soles(f.precio_centimos)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )
        })}
      </div>

      {/* Historial de rankings: gráfico + tabla de respaldo */}
      {snapshots.length > 1 && (
        <div className="mt-6">
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-sm font-semibold text-app-text">Evolución de tu ranking</h3>
            <span className="text-xs text-app-muted">#1 = el precio más bajo del distrito (eje invertido: subir es mejor)</span>
          </div>
          {/* El gráfico carga su propio rango de fechas; `refreshKey` lo hace
              re-consultar cuando llega un snapshot nuevo por Realtime. Incluye
              la fecha porque, si el Top 10 no cambió, el cron solo refresca
              `fecha_consulta` del snapshot existente (mismo id). */}
          <RankingChart refreshKey={actual ? `${actual.id}:${actual.fecha_consulta}` : null} />

          <h3 className="mb-2 mt-5 text-sm font-semibold text-app-text">Detalle por consulta</h3>
          <table className="table-excel w-auto">
            <thead>
              <tr>
                <th>Fecha</th>
                <th className="text-right">DB5</th>
                <th className="text-right">Regular</th>
                <th className="text-right">Premium</th>
                <th className="text-right">Estab.</th>
              </tr>
            </thead>
            <tbody>
              {snapshots.map((s) => (
                <tr key={s.id}>
                  <td className="text-xs">{new Date(s.fecha_consulta).toLocaleDateString('es-PE')}</td>
                  <td className="text-right font-mono text-xs">{s.ranking_db5 != null ? `#${s.ranking_db5}` : '—'}</td>
                  <td className="text-right font-mono text-xs">{s.ranking_regular != null ? `#${s.ranking_regular}` : '—'}</td>
                  <td className="text-right font-mono text-xs">{s.ranking_premium != null ? `#${s.ranking_premium}` : '—'}</td>
                  <td className="text-right font-mono text-xs">{s.total_establecimientos}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
