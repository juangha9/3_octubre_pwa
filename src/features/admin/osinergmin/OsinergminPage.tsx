import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/features/auth/useAuth'
import type { OsinergminSnapshot, OsinergminTop10 } from '@/types'

const PRODUCTOS = [
  { code: 'DB5', label: 'Diesel B5' },
  { code: 'REGULAR', label: 'Gasohol Regular' },
  { code: 'PREMIUM', label: 'Gasohol Premium' },
] as const

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

      setResult({
        ok: true,
        msg: data.skipped
          ? `Revisado: sin cambios en ${data.distrito}.`
          : `Actualizado. Distrito ${data.distrito} · ${data.total_establecimientos} establecimientos.`,
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
      {/* Encabezado */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold text-app-text">
          Ranking de precios — Distrito {actual.distrito}
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
                  <span className="text-xs text-app-muted">de {actual.total_establecimientos}</span>
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
                        <td className="whitespace-normal text-xs align-top">
                          <span className="line-clamp-2 break-words" title={f.razon_social}>
                            {f.razon_social}
                            {f.es_nuestro && <span className="ml-1 text-primary-text">(nosotros)</span>}
                          </span>
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

      {/* Historial de rankings */}
      {snapshots.length > 1 && (
        <div className="mt-6">
          <h3 className="mb-2 text-sm font-semibold text-app-text">Evolución de tu ranking</h3>
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
