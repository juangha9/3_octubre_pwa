import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { formatFecha } from '@/lib/date'
import type { CompraConDetalle, CompraFlete, CompraLinea, PrecioDiario, Proveedor } from '@/types'
import CompraModal from './CompraModal'

const PRODUCTOS = [
  { code: 'DB5', label: 'Diesel' },
  { code: 'PREMIUM', label: 'Premium' },
  { code: 'REGULAR', label: 'Regular' },
] as const

const gl = (n: number): string => n.toLocaleString('es-PE', { maximumFractionDigits: 2 })
const solesF = (n: number): string => 'S/ ' + n.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const precio4 = (n: number): string => 'S/ ' + n.toLocaleString('es-PE', { minimumFractionDigits: 4, maximumFractionDigits: 4 })

const lineaDe = (c: CompraConDetalle, code: string): CompraLinea | undefined =>
  c.compra_lineas.find((l) => l.tipo_combustible === code)

// Monto pagado por combustible = Σ galones × precio/gl (en soles).
const montoPagado = (c: CompraConDetalle): number =>
  c.compra_lineas.reduce((s, l) => s + Number(l.galones) * Number(l.precio_gl), 0)

// Galones a los que aplica un flete (aplica_a; null/vacío = todos los productos).
function galonesFlete(c: CompraConDetalle, f: CompraFlete): number {
  const codes = f.aplica_a && f.aplica_a.length > 0 ? f.aplica_a : null
  return c.compra_lineas
    .filter((l) => !codes || codes.includes(l.tipo_combustible))
    .reduce((s, l) => s + Number(l.galones), 0)
}
// Total de fletes de la compra (en soles) = Σ tarifa/gl × galones aplicables.
const fleteSoles = (c: CompraConDetalle): number =>
  c.compra_fletes.reduce((s, f) => s + Number(f.precio_gl) * galonesFlete(c, f), 0)

type EstadoFlete = 'none' | 'pagado' | 'pendiente' | 'parcial'
function estadoFlete(c: CompraConDetalle): EstadoFlete {
  if (c.compra_fletes.length === 0) return 'none'
  const pagados = c.compra_fletes.filter((f) => f.estado_pago === 'pagado').length
  if (pagados === 0) return 'pendiente'
  if (pagados === c.compra_fletes.length) return 'pagado'
  return 'parcial'
}

function BadgeFlete({ estado }: { estado: EstadoFlete }) {
  if (estado === 'none') return <span className="text-app-muted">—</span>
  if (estado === 'pagado') return <span className="badge-success">Pagado</span>
  if (estado === 'pendiente') return <span className="badge-danger">Pendiente</span>
  return <span className="badge-warning">Parcial</span>
}

export default function RegistroComprasPage() {
  const [compras, setCompras] = useState<CompraConDetalle[]>([])
  const [proveedores, setProveedores] = useState<Proveedor[]>([])
  const [precio, setPrecio] = useState<PrecioDiario | null>(null)
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState<{ open: boolean; compra: CompraConDetalle | null }>({ open: false, compra: null })

  async function cargar() {
    setLoading(true)
    const [cp, pr, pd] = await Promise.all([
      supabase
        .from('compras')
        .select('*, compra_lineas(*), compra_fletes(*), proveedores(nombre)')
        .order('fecha', { ascending: false })
        .order('created_at', { ascending: false }),
      supabase.from('proveedores').select('*').eq('activo', true).order('nombre'),
      supabase.from('precios_diarios').select('*').order('fecha', { ascending: false }).limit(1).maybeSingle(),
    ])
    setCompras((cp.data as CompraConDetalle[]) ?? [])
    setProveedores((pr.data as Proveedor[]) ?? [])
    setPrecio((pd.data as PrecioDiario) ?? null)
    setLoading(false)
  }

  useEffect(() => {
    cargar()
  }, [])

  // Precio de venta actual (céntimos) por producto, para la utilidad/galón.
  function ventaCentimos(code: string): number | null {
    if (!precio) return null
    if (code === 'DB5') return precio.precio_db5_centimos
    if (code === 'PREMIUM') return precio.precio_premium_centimos
    if (code === 'REGULAR') return precio.precio_regular_centimos
    return null
  }
  // Utilidad/gl = precio de venta actual − precio de compra (soles). null si falta dato.
  function utilidad(c: CompraConDetalle, code: string): number | null {
    const l = lineaDe(c, code)
    const venta = ventaCentimos(code)
    if (!l || venta == null) return null
    return venta / 100 - Number(l.precio_gl)
  }

  // Totales de las columnas (pie de tabla).
  const totales = useMemo(() => {
    const galones: Record<string, number> = { DB5: 0, PREMIUM: 0, REGULAR: 0 }
    let pagado = 0
    let flete = 0
    for (const c of compras) {
      for (const p of PRODUCTOS) galones[p.code] += Number(lineaDe(c, p.code)?.galones ?? 0)
      pagado += montoPagado(c)
      flete += fleteSoles(c)
    }
    return { galones, pagado, flete }
  }, [compras])

  async function eliminar(c: CompraConDetalle) {
    if (!window.confirm(`¿Eliminar la compra del ${formatFecha(new Date(c.fecha + 'T00:00:00'))}? Se borrarán sus líneas y fletes.`)) return
    const { error } = await supabase.from('compras').delete().eq('id', c.id)
    if (error) {
      window.alert('No se pudo eliminar: ' + error.message)
      return
    }
    cargar()
  }

  if (loading) return <p className="p-6 text-sm text-app-muted">Cargando…</p>

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Encabezado */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
        <div>
          <h3 className="text-sm font-semibold text-app-text">Registro de Compras</h3>
          <p className="text-xs text-app-muted">
            {precio
              ? `Utilidad/gl = precio de venta del ${formatFecha(new Date(precio.fecha + 'T00:00:00'))} − precio de compra.`
              : 'Registra los precios del día en Ventas para calcular la utilidad/gl.'}
          </p>
        </div>
        <button className="btn-primary text-xs" onClick={() => setModal({ open: true, compra: null })}>
          + Nueva compra
        </button>
      </div>

      {/* Tabla */}
      <div className="flex-1 overflow-auto px-4 pb-4">
        {compras.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <p className="mb-3 text-sm text-app-muted">Aún no hay compras registradas.</p>
            <button className="btn-primary text-xs" onClick={() => setModal({ open: true, compra: null })}>
              Registrar primera compra
            </button>
          </div>
        ) : (
          <table className="table-excel w-auto">
            <thead>
              <tr>
                <th rowSpan={2} className="align-bottom">FECHA</th>
                <th rowSpan={2} className="align-bottom">PROVEEDOR</th>
                <th colSpan={3} className="text-center">GALONES</th>
                <th colSpan={3} className="text-center">PRECIO / GL</th>
                <th rowSpan={2} className="text-right align-bottom">MONTO<br />PAGADO</th>
                <th rowSpan={2} className="text-right align-bottom">FLETE</th>
                <th rowSpan={2} className="text-center align-bottom">EST.<br />FLETE</th>
                <th colSpan={3} className="text-center">UTILIDAD / GL</th>
                <th rowSpan={2} className="align-bottom"></th>
              </tr>
              <tr>
                {PRODUCTOS.map((p) => <th key={'g' + p.code} className="text-right text-[11px]">{p.label}</th>)}
                {PRODUCTOS.map((p) => <th key={'p' + p.code} className="text-right text-[11px]">{p.label}</th>)}
                {PRODUCTOS.map((p) => <th key={'u' + p.code} className="text-right text-[11px]">{p.label}</th>)}
              </tr>
            </thead>
            <tbody>
              {compras.map((c) => (
                <tr key={c.id}>
                  <td className="whitespace-nowrap text-xs">{formatFecha(new Date(c.fecha + 'T00:00:00'))}</td>
                  <td className="whitespace-nowrap text-xs">{c.proveedores?.nombre ?? <span className="text-app-muted">—</span>}</td>
                  {PRODUCTOS.map((p) => {
                    const l = lineaDe(c, p.code)
                    return <td key={'g' + p.code} className="text-right font-mono text-xs">{l ? gl(Number(l.galones)) : '—'}</td>
                  })}
                  {PRODUCTOS.map((p) => {
                    const l = lineaDe(c, p.code)
                    return <td key={'p' + p.code} className="text-right font-mono text-xs">{l ? precio4(Number(l.precio_gl)) : '—'}</td>
                  })}
                  <td className="text-right font-mono text-xs font-semibold">{solesF(montoPagado(c))}</td>
                  <td
                    className="text-right font-mono text-xs"
                    title={c.compra_fletes.map((f) => `S/ ${Number(f.precio_gl).toFixed(4)}/gl × ${galonesFlete(c, f)} gl`).join('  +  ')}
                  >
                    {fleteSoles(c) > 0 ? solesF(fleteSoles(c)) : '—'}
                  </td>
                  <td className="text-center"><BadgeFlete estado={estadoFlete(c)} /></td>
                  {PRODUCTOS.map((p) => {
                    const u = utilidad(c, p.code)
                    return (
                      <td key={'u' + p.code} className={`text-right font-mono text-xs ${u == null ? 'text-app-muted' : u >= 0 ? 'text-success-text' : 'text-danger-text'}`}>
                        {u == null ? '—' : solesF(u)}
                      </td>
                    )
                  })}
                  <td>
                    <div className="flex gap-1">
                      <button className="btn-ghost text-xs" onClick={() => setModal({ open: true, compra: c })}>Editar</button>
                      <button className="btn-ghost text-xs text-danger-text" onClick={() => eliminar(c)}>Eliminar</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-app-border/40 font-semibold">
                <td className="text-xs">TOTALES</td>
                <td className="text-xs text-app-muted">{compras.length} compras</td>
                {PRODUCTOS.map((p) => <td key={'tg' + p.code} className="text-right font-mono text-xs">{gl(totales.galones[p.code])}</td>)}
                <td colSpan={3}></td>
                <td className="text-right font-mono text-xs">{solesF(totales.pagado)}</td>
                <td className="text-right font-mono text-xs">{solesF(totales.flete)}</td>
                {/* est. flete (1) + utilidad/gl (3) + acciones (1) = 5 columnas */}
                <td colSpan={5}></td>
              </tr>
            </tfoot>
          </table>
        )}
      </div>

      {modal.open && (
        <CompraModal
          compra={modal.compra}
          proveedores={proveedores}
          onClose={() => setModal({ open: false, compra: null })}
          onSaved={cargar}
        />
      )}
    </div>
  )
}
