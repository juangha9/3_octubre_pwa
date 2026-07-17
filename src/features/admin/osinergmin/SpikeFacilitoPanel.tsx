// ============================================================
// SpikeFacilitoPanel — VALIDACIÓN TEMPORAL (solo superadmin)
// ============================================================
// Invoca la Edge Function `osinergmin-spike` y muestra, LADO A LADO, el ranking
// de la fuente EN VIVO de Facilito vs el último snapshot del Excel EVPC. Sirve
// para decidir, durante unos días, si cambiamos la fuente de `osinergmin-cron`.
// Es un panel desechable: borrar (junto a la función y su config) cuando termine
// la validación. Ver estado.md, sesión 2026-07-14/15.
// ============================================================
import { useState } from 'react'
import { supabase } from '@/lib/supabase'

type TopRow = {
  ranking: number; codigo: string | null; razon: string
  precio_centimos: number; es_nuestro: boolean
}
type LadoFacilito = {
  our_ranking: number | null; our_precio_centimos: number | null
  total: number; ordenado_por_precio: boolean; top: TopRow[]
}
type LadoExcel = {
  our_ranking: number | null; our_precio_centimos: number | null
  total: number | null; top: TopRow[]
}
type Veredicto = { ranking_coincide: boolean; precio_coincide: boolean; notas: string[] }
type ProdCmp = { facilito: LadoFacilito; excel: LadoExcel; veredicto: Veredicto }
type SpikeResp = {
  ok: true
  zona: { departamento: string; provincia: string; distrito: string }
  nuestro_codigo: string
  fetched_at: string
  excel_snapshot_fecha: string | null
  productos: Record<string, ProdCmp>
  resumen: { todo_coincide: boolean; notas: string[] }
}

const PRODS = [
  ['DB5', 'Diesel B5'],
  ['REGULAR', 'Gasohol Regular'],
  ['PREMIUM', 'Gasohol Premium'],
] as const

const soles = (c: number | null): string =>
  c == null ? '—' : 'S/ ' + (c / 100).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

function LadoTabla({ titulo, rank, precio, total, top }: {
  titulo: string; rank: number | null; precio: number | null; total: number | null; top: TopRow[]
}) {
  return (
    <div className="min-w-0">
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <span className="text-xs font-semibold text-app-text">{titulo}</span>
        <span className="text-xs text-app-muted">
          {rank != null ? <><span className="font-bold text-primary-text">#{rank}</span> · {soles(precio)}</> : '—'}
          {total != null && <span className="ml-1 text-app-muted">de {total}</span>}
        </span>
      </div>
      {top.length === 0 ? (
        <p className="rounded border border-app-border bg-white p-2 text-xs text-app-muted">Sin datos.</p>
      ) : (
        <table className="table-excel w-full table-fixed">
          <thead>
            <tr>
              <th style={{ width: 26 }}>#</th>
              <th>Establecimiento</th>
              <th className="text-right" style={{ width: 68 }}>Precio</th>
            </tr>
          </thead>
          <tbody>
            {top.map((r) => (
              <tr key={`${r.ranking}-${r.codigo}`} className={r.es_nuestro ? 'bg-primary/30 font-semibold' : ''}>
                <td className="text-center font-mono text-xs">{r.ranking}</td>
                <td className="truncate text-xs" title={`${r.razon}${r.codigo ? ` · cód ${r.codigo}` : ''}`}>
                  {r.razon}{r.es_nuestro && <span className="ml-1 text-primary-text">(nosotros)</span>}
                </td>
                <td className="text-right font-mono text-xs">{soles(r.precio_centimos)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

export default function SpikeFacilitoPanel() {
  const [cargando, setCargando] = useState(false)
  const [data, setData] = useState<SpikeResp | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function comparar() {
    setCargando(true)
    setError(null)
    try {
      const { data: res, error: err } = await supabase.functions.invoke('osinergmin-spike')
      if (err) {
        let msg = err.message
        try {
          const body = await (err as { context?: Response }).context?.json?.()
          if (body?.error) msg = body.error
        } catch { /* noop */ }
        throw new Error(msg)
      }
      if (!res?.ok) throw new Error(res?.error ?? 'Respuesta inesperada.')
      setData(res as SpikeResp)
    } catch (e) {
      setError((e as Error).message)
    }
    setCargando(false)
  }

  return (
    <div className="mt-6 rounded-lg border border-dashed border-app-border p-4">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-app-text">
            🧪 Validación: Facilito (en vivo) vs Excel <span className="font-normal text-app-muted">— spike temporal</span>
          </h3>
          <p className="text-xs text-app-muted">
            Compara el ranking de la fuente en vivo contra el último snapshot del Excel. No cambia nada; solo lo muestra.
          </p>
        </div>
        <button className="btn-primary text-xs" onClick={comparar} disabled={cargando}>
          {cargando ? 'Consultando Facilito…' : 'Comparar ahora'}
        </button>
      </div>

      {error && (
        <div className="mb-3 rounded border border-danger-dark bg-danger px-3 py-2 text-xs font-medium text-danger-text">
          {error}
        </div>
      )}

      {data && (
        <>
          <div className={`mb-3 rounded border px-3 py-2 text-xs ${
            data.resumen.todo_coincide
              ? 'border-success-dark bg-success text-success-text'
              : 'border-app-border bg-white text-app-text'
          }`}>
            <span className="font-semibold">
              {data.resumen.todo_coincide ? '✓ Facilito y Excel coinciden en los 3 productos.' : '≠ Hay diferencias (esperable si el Excel está desfasado):'}
            </span>
            <ul className="mt-1 list-inside list-disc text-app-muted">
              {data.resumen.notas.map((n, i) => <li key={i}>{n}</li>)}
            </ul>
          </div>

          <div className="space-y-4">
            {PRODS.map(([code, label]) => {
              const c = data.productos[code]
              if (!c) return null
              const ok = c.veredicto.ranking_coincide && c.veredicto.precio_coincide
              return (
                <div key={code} className="rounded border border-app-border p-3">
                  <div className="mb-2 flex items-center gap-2">
                    <span className="text-sm font-semibold text-app-text">{label}</span>
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                      ok ? 'bg-success text-success-text' : 'bg-warning/30 text-app-text'
                    }`}>
                      {ok ? 'coincide' : 'difiere'}
                    </span>
                    {!c.facilito.ordenado_por_precio && (
                      <span className="text-[11px] text-danger-text">⚠ Facilito no vino ordenado</span>
                    )}
                  </div>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <LadoTabla titulo="Facilito (en vivo)" rank={c.facilito.our_ranking} precio={c.facilito.our_precio_centimos} total={c.facilito.total} top={c.facilito.top} />
                    <LadoTabla titulo="Excel (último snapshot)" rank={c.excel.our_ranking} precio={c.excel.our_precio_centimos} total={c.excel.total} top={c.excel.top} />
                  </div>
                </div>
              )
            })}
          </div>

          <p className="mt-2 text-[11px] text-app-muted">
            Zona {data.zona.distrito} · nuestro código {data.nuestro_codigo} · consultado {new Date(data.fetched_at).toLocaleString('es-PE')}
          </p>
        </>
      )}
    </div>
  )
}
