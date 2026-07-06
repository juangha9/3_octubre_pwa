import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { usePersistedState } from '@/lib/usePersistedState'
import type { Proveedor, Tanque, VarillajeStockRow } from '@/types'

// ─── Productos ────────────────────────────────────────────────────
// Códigos según `tipos_combustible` (DB5 / REGULAR / PREMIUM).
const PRODUCTOS = [
  { code: 'DB5',     label: 'DIESEL',  nombre: 'Diesel B5' },
  { code: 'REGULAR', label: 'REGULAR', nombre: 'Gasohol Regular' },
  { code: 'PREMIUM', label: 'PREMIUM', nombre: 'Gasohol Premium' },
] as const

// ─── Helpers de formato / parseo ──────────────────────────────────
// El Cotizador es una herramienta de decisión que vive en localStorage,
// NO persiste en BD, por eso trabaja con números normales (permite hasta
// 4 decimales en el precio/galón, como en el Excel) en vez de céntimos.
const num = (s: string | undefined): number => {
  const n = parseFloat((s ?? '').replace(',', '.'))
  return isNaN(n) ? 0 : n
}
const soles = (n: number): string =>
  'S/ ' + n.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const gl = (n: number): string =>
  n.toLocaleString('es-PE', { maximumFractionDigits: 2 })

// Antigüedad del último varillaje, para dejar claro qué tan fresco es el stock.
function haceCuanto(iso: string): string {
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
  if (min < 1) return 'recién'
  if (min < 60) return `hace ${min} min`
  const h = Math.round(min / 60)
  if (h < 24) return `hace ${h} h`
  return `hace ${Math.round(h / 24)} d`
}

// Stock por producto agregado desde las últimas lecturas de varillaje.
type StockProducto = { galones: number; medidoEn: string; tanquesMedidos: number }

// Estilo de input dentro de celdas de tabla (fondo transparente para dejar
// ver el semáforo verde/rojo del td).
const cellInput =
  'w-full bg-transparent text-right outline-none rounded px-1 py-0.5 ' +
  'focus:bg-white focus:ring-1 focus:ring-primary-dark'

type PreciosMap = Record<string, Record<string, string>> // provId → code → precio
type SimpleMap = Record<string, string>                   // code|provId → valor

// ─── Componente ───────────────────────────────────────────────────

export default function CotizadorPage() {
  const [proveedores, setProveedores] = useState<Proveedor[]>([])
  const [tanques, setTanques] = useState<Tanque[]>([])
  const [loading, setLoading] = useState(true)

  // Stock actual traído del Varillaje (última lectura por tanque → galones).
  const [stockVar, setStockVar] = useState<Record<string, StockProducto>>({})
  const [stockRefreshing, setStockRefreshing] = useState(false)

  // Estado de trabajo persistido (auto-guardado, sin botones). El stock actual
  // NO se persiste ni se edita a mano: viene siempre del varillaje (`stockVar`).
  const [aComprar, setAComprar]   = usePersistedState<SimpleMap>('compras.cotizador.aComprar', {})
  const [precios, setPrecios]     = usePersistedState<PreciosMap>('compras.cotizador.precios', {})
  const [descuentos, setDescuentos] = usePersistedState<SimpleMap>('compras.cotizador.descuentos', {})

  useEffect(() => {
    setLoading(true)
    Promise.all([
      supabase.from('proveedores').select('*').eq('activo', true).order('nombre'),
      supabase.from('tanques').select('*').eq('activo', true).order('id'),
    ])
      .then(([pr, tq]) => {
        setProveedores((pr.data as Proveedor[]) ?? [])
        setTanques((tq.data as Tanque[]) ?? [])
      })
      .catch(err => console.error('Error al cargar catálogos del cotizador:', err))
      .finally(() => setLoading(false))
  }, [])

  // Carga el stock desde el Varillaje (server-side, solo admin+). Agrega por
  // producto la última lectura de cada tanque y anota qué tan reciente es.
  async function cargarStockVarillaje() {
    setStockRefreshing(true)
    const { data, error } = await supabase.rpc('fn_stock_actual')
    if (error) {
      // Sin permiso o error de red: sin stock conocido (se mostrará «—»).
      console.warn('No se pudo cargar el stock del varillaje:', error.message)
      setStockVar({})
    } else {
      const map: Record<string, StockProducto> = {}
      for (const row of (data as VarillajeStockRow[]) ?? []) {
        const code = row.tipo_combustible_codigo
        const cur = map[code] ?? { galones: 0, medidoEn: row.medido_en, tanquesMedidos: 0 }
        cur.galones += Number(row.volumen_galones)
        cur.tanquesMedidos += 1
        if (new Date(row.medido_en) > new Date(cur.medidoEn)) cur.medidoEn = row.medido_en
        map[code] = cur
      }
      setStockVar(map)
    }
    setStockRefreshing(false)
  }

  useEffect(() => { cargarStockVarillaje() }, [])

  // ── Setters de celda ──
  function setPrecio(provId: string, code: string, val: string) {
    setPrecios(prev => ({ ...prev, [provId]: { ...(prev[provId] ?? {}), [code]: val } }))
  }

  // ── Capacidad y nº de tanques por producto (suma de ese combustible) ──
  const capacidad = useMemo(() => {
    const map: Record<string, number> = {}
    for (const p of PRODUCTOS) {
      map[p.code] = tanques
        .filter(t => t.tipo_combustible_codigo === p.code)
        .reduce((s, t) => s + (t.capacidad_galones ?? 0), 0)
    }
    return map
  }, [tanques])

  const totalTanques = useMemo(() => {
    const map: Record<string, number> = {}
    for (const t of tanques) map[t.tipo_combustible_codigo] = (map[t.tipo_combustible_codigo] ?? 0) + 1
    return map
  }, [tanques])

  // ── Cálculos por proveedor ──
  const lineTotal = (provId: string, code: string) =>
    num(aComprar[code]) * num(precios[provId]?.[code])
  const subtotalProductos = (provId: string) =>
    PRODUCTOS.reduce((s, p) => s + lineTotal(provId, p.code), 0)
  const totalProveedor = (provId: string) =>
    subtotalProductos(provId) - num(descuentos[provId])

  // Semáforo: el precio/gl más barato (verde) y más caro (rojo) por producto.
  function precioCellClass(code: string, price: number): string {
    if (price <= 0) return ''
    const todos = proveedores.map(p => num(precios[p.id]?.[code])).filter(v => v > 0)
    if (todos.length < 2) return ''
    const min = Math.min(...todos)
    const max = Math.max(...todos)
    if (price === min) return 'bg-green-100'
    if (price === max) return 'bg-red-100'
    return ''
  }

  // ── Optimizador "mejor precio" (compra dividida) ──
  const productosActivos = useMemo(
    () => PRODUCTOS.filter(p => num(aComprar[p.code]) > 0),
    [aComprar]
  )

  const mejorPorProducto = useMemo(() =>
    productosActivos.map(p => {
      const cands = proveedores
        .map(pr => ({ prov: pr, price: num(precios[pr.id]?.[p.code]) }))
        .filter(x => x.price > 0)
      const best = cands.reduce<{ prov: Proveedor; price: number } | null>(
        (a, b) => (!a || b.price < a.price ? b : a), null
      )
      return {
        producto: p,
        prov: best?.prov ?? null,
        price: best?.price ?? 0,
        total: (best?.price ?? 0) * num(aComprar[p.code]),
      }
    }),
    [productosActivos, proveedores, precios, aComprar]
  )

  const totalOptimo = mejorPorProducto.reduce((s, m) => s + m.total, 0)

  // Mejor proveedor único: el más barato entre los que cotizan TODOS los
  // productos pedidos (comparación justa contra la compra dividida).
  const mejorSingle = useMemo(() => {
    const completos = proveedores.filter(pr =>
      productosActivos.length > 0 &&
      productosActivos.every(p => num(precios[pr.id]?.[p.code]) > 0)
    )
    return completos.reduce<Proveedor | null>(
      (best, pr) => (!best || totalProveedor(pr.id) < totalProveedor(best.id) ? pr : best),
      null
    )
  }, [proveedores, productosActivos, precios, aComprar, descuentos]) // eslint-disable-line react-hooks/exhaustive-deps

  const ahorroDividido = mejorSingle ? totalProveedor(mejorSingle.id) - totalOptimo : 0

  // ─── Render ─────────────────────────────────────────────────────
  if (loading) {
    return <p className="p-6 text-sm text-app-muted">Cargando…</p>
  }

  return (
    <div className="h-full overflow-auto p-4">
      {/* ── Panel de contexto: tanques / stock / a comprar ── */}
      <div className="mb-4">
        <div className="mb-2 flex items-center justify-between" style={{ maxWidth: 640 }}>
          <h3 className="text-sm font-semibold text-app-text">Tanques y pedido</h3>
          <button
            onClick={cargarStockVarillaje}
            disabled={stockRefreshing}
            className="text-xs text-primary-text hover:underline disabled:opacity-50"
            title="Recargar el stock desde la última medición de varillaje"
          >
            {stockRefreshing ? 'Actualizando…' : '↻ Stock del varillaje'}
          </button>
        </div>
        <table className="table-excel" style={{ maxWidth: 640 }}>
          <thead>
            <tr>
              <th>PRODUCTO</th>
              <th className="text-right">CAPACIDAD (GL)</th>
              <th className="text-right">STOCK ACTUAL (GL)</th>
              <th className="text-right">DISPONIBLE (GL)</th>
              <th className="text-right">A COMPRAR (GL)</th>
            </tr>
          </thead>
          <tbody>
            {PRODUCTOS.map(p => {
              const cap = capacidad[p.code]
              const sv = stockVar[p.code]
              // Sin lectura de varillaje NO hay stock conocido → stock y
              // disponible se muestran "—" (no se asume tanque lleno ni vacío).
              const disp = sv && cap > 0 ? Math.max(cap - sv.galones, 0) : null
              const comprar = num(aComprar[p.code])
              const excede = disp != null && comprar > disp
              const parcial = sv && totalTanques[p.code] > sv.tanquesMedidos
              return (
                <tr key={p.code}>
                  <td className="font-medium">{p.label}</td>
                  <td className="text-right font-mono text-xs">{cap > 0 ? gl(cap) : '—'}</td>
                  {sv ? (
                    <td className="text-right align-top">
                      <div className="font-mono text-xs text-app-text">{gl(sv.galones)}</div>
                      <div className="text-[10px] leading-tight text-app-muted">
                        varillaje · {haceCuanto(sv.medidoEn)}
                        {parcial && <><br/>⚠ {sv.tanquesMedidos}/{totalTanques[p.code]} tanques medidos</>}
                      </div>
                    </td>
                  ) : (
                    <td className="text-right font-mono text-xs text-app-muted">—</td>
                  )}
                  <td className="text-right font-mono text-xs text-app-muted">
                    {disp != null ? gl(disp) : '—'}
                  </td>
                  <td className={`text-right ${excede ? 'bg-red-100' : ''}`}>
                    <input
                      type="number" min="0" step="0.01" placeholder="0"
                      className={cellInput} value={aComprar[p.code] ?? ''}
                      onChange={e => setAComprar(prev => ({ ...prev, [p.code]: e.target.value }))}
                    />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        <p className="mt-1 text-xs text-app-muted">
          El stock actual proviene del <span className="font-medium">último varillaje</span> de cada tanque
          (galones vía tabla de aforo); no es editable. Los productos sin lectura muestran «—».
          En rojo: lo que quieres comprar excede el espacio libre del tanque.
        </p>
      </div>

      {/* ── Tabla comparativa de proveedores ── */}
      <h3 className="mb-2 text-sm font-semibold text-app-text">Comparativo de proveedores</h3>
      {proveedores.length === 0 ? (
        <p className="rounded border border-app-border bg-white p-4 text-sm text-app-muted">
          No hay proveedores activos. Agrégalos en <span className="font-medium">Configuración → Proveedores</span>.
        </p>
      ) : (
        <table className="table-excel w-auto">
          <thead>
            <tr>
              <th rowSpan={2} className="align-bottom">PROVEEDOR</th>
              {PRODUCTOS.map(p => (
                <th key={p.code} colSpan={2} className="text-center">{p.label}</th>
              ))}
              <th rowSpan={2} className="text-right align-bottom">DESCUENTO<br/>(saldo a favor)</th>
              <th rowSpan={2} className="text-right align-bottom">TOTAL A PAGAR</th>
            </tr>
            <tr>
              {PRODUCTOS.map(p => [
                <th key={p.code + '-pu'} className="text-right text-[11px]">Precio/gl</th>,
                <th key={p.code + '-st'} className="text-right text-[11px]">Subtotal</th>,
              ])}
            </tr>
          </thead>
          <tbody>
            {proveedores.map(pr => (
              <tr key={pr.id}>
                <td className="font-medium">{pr.nombre}</td>
                {PRODUCTOS.map(p => {
                  const price = num(precios[pr.id]?.[p.code])
                  const activo = num(aComprar[p.code]) > 0
                  return [
                    <td key={p.code + '-pu'} className={`text-right ${precioCellClass(p.code, price)}`}>
                      <input
                        type="number" min="0" step="0.0001" placeholder="0.0000"
                        className={cellInput} value={precios[pr.id]?.[p.code] ?? ''}
                        onChange={e => setPrecio(pr.id, p.code, e.target.value)}
                      />
                    </td>,
                    <td key={p.code + '-st'} className="text-right font-mono text-xs text-app-muted">
                      {activo && price > 0 ? soles(lineTotal(pr.id, p.code)) : '—'}
                    </td>,
                  ]
                })}
                <td className="text-right">
                  <input
                    type="number" min="0" step="0.01" placeholder="0.00"
                    className={cellInput} value={descuentos[pr.id] ?? ''}
                    onChange={e => setDescuentos(prev => ({ ...prev, [pr.id]: e.target.value }))}
                  />
                </td>
                <td className="text-right font-mono text-xs font-semibold">
                  {subtotalProductos(pr.id) > 0 ? soles(totalProveedor(pr.id)) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* ── Optimizador: mejor precio (compra dividida) ── */}
      {productosActivos.length > 0 && mejorPorProducto.some(m => m.prov) && (
        <div className="mt-6 max-w-2xl">
          <h3 className="mb-2 text-sm font-semibold text-app-text">
            Mejor precio — comprar cada producto al proveedor más barato
          </h3>
          <table className="table-excel">
            <thead>
              <tr>
                <th>PRODUCTO</th>
                <th>PROVEEDOR MÁS BARATO</th>
                <th className="text-right">PRECIO/GL</th>
                <th className="text-right">GALONES</th>
                <th className="text-right">SUBTOTAL</th>
              </tr>
            </thead>
            <tbody>
              {mejorPorProducto.map(m => (
                <tr key={m.producto.code}>
                  <td className="font-medium">{m.producto.label}</td>
                  <td>{m.prov ? m.prov.nombre : <span className="text-app-muted">— sin cotización —</span>}</td>
                  <td className="text-right font-mono text-xs">{m.price > 0 ? soles(m.price) : '—'}</td>
                  <td className="text-right font-mono text-xs">{gl(num(aComprar[m.producto.code]))}</td>
                  <td className="text-right font-mono text-xs font-medium">{m.total > 0 ? soles(m.total) : '—'}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-green-50 font-semibold">
                <td colSpan={4} className="text-right text-xs">TOTAL ÓPTIMO (compra dividida)</td>
                <td className="text-right font-mono text-xs text-green-800">{soles(totalOptimo)}</td>
              </tr>
            </tfoot>
          </table>

          {mejorSingle && (
            <p className="mt-2 text-xs text-app-muted">
              Mejor proveedor único (cotiza todo): <span className="font-medium text-app-text">{mejorSingle.nombre}</span>
              {' '}— {soles(totalProveedor(mejorSingle.id))}.{' '}
              {ahorroDividido > 0.005 ? (
                <span className="font-medium text-green-700">
                  Comprando dividido ahorras {soles(ahorroDividido)}.
                </span>
              ) : (
                <span>Conviene comprarle todo a un solo proveedor.</span>
              )}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
