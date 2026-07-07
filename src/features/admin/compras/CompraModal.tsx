import { useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { hoyLocal } from '@/lib/date'
import type { CompraConDetalle, Proveedor } from '@/types'

// Orden de productos como en la hoja real "COMPRAS" (Diesel, Premium, Regular).
const PRODUCTOS = [
  { code: 'DB5', label: 'Diesel B5' },
  { code: 'PREMIUM', label: 'Premium' },
  { code: 'REGULAR', label: 'Regular' },
] as const

const numf = (s: string | undefined): number => {
  const n = parseFloat((s ?? '').replace(',', '.'))
  return isNaN(n) ? 0 : n
}

type LineaInput = { galones: string; precio: string }
type FleteInput = {
  transportista: string
  precio: string // tarifa por galón (soles)
  aplica_a: string[]
  estado_pago: 'pagado' | 'pendiente'
  fecha_pago: string
}

export default function CompraModal({
  compra,
  proveedores,
  onClose,
  onSaved,
}: {
  compra: CompraConDetalle | null
  proveedores: Proveedor[]
  onClose: () => void
  onSaved: () => void
}) {
  const [fecha, setFecha] = useState(compra?.fecha ?? hoyLocal())
  const [proveedorId, setProveedorId] = useState(compra?.proveedor_id ?? '')
  const [notas, setNotas] = useState(compra?.notas ?? '')

  // Líneas: una entrada por producto (vacío = no incluido en la compra).
  const [lineas, setLineas] = useState<Record<string, LineaInput>>(() => {
    const init: Record<string, LineaInput> = {}
    for (const p of PRODUCTOS) {
      const l = compra?.compra_lineas.find((x) => x.tipo_combustible === p.code)
      init[p.code] = l ? { galones: String(l.galones), precio: String(l.precio_gl) } : { galones: '', precio: '' }
    }
    return init
  })

  const [fletes, setFletes] = useState<FleteInput[]>(() =>
    (compra?.compra_fletes ?? []).map((f) => ({
      transportista: f.transportista ?? '',
      precio: String(f.precio_gl),
      aplica_a: f.aplica_a ?? [],
      estado_pago: f.estado_pago,
      fecha_pago: f.fecha_pago ?? '',
    })),
  )

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function setLinea(code: string, campo: keyof LineaInput, val: string) {
    setLineas((prev) => ({ ...prev, [code]: { ...prev[code], [campo]: val } }))
  }
  function setFlete(i: number, patch: Partial<FleteInput>) {
    setFletes((prev) => prev.map((f, idx) => (idx === i ? { ...f, ...patch } : f)))
  }
  function toggleAplica(i: number, code: string) {
    setFletes((prev) =>
      prev.map((f, idx) => {
        if (idx !== i) return f
        const has = f.aplica_a.includes(code)
        return { ...f, aplica_a: has ? f.aplica_a.filter((c) => c !== code) : [...f.aplica_a, code] }
      }),
    )
  }

  // Importe por línea y total pagado (en soles, solo para vista previa).
  const importe = (code: string) => numf(lineas[code]?.galones) * numf(lineas[code]?.precio)
  const totalPagado = useMemo(
    () => PRODUCTOS.reduce((s, p) => s + importe(p.code), 0),
    [lineas], // eslint-disable-line react-hooks/exhaustive-deps
  )

  // Productos efectivamente en la compra (con galones > 0).
  // Tipado como string[] para poder cruzarlo con aplica_a (viene como string[]).
  const productosEnCompra: string[] = PRODUCTOS.filter((p) => numf(lineas[p.code]?.galones) > 0).map((p) => p.code)

  // El flete se cotiza POR GALÓN. Galones a los que aplica (los seleccionados;
  // ninguno = todos) y su total = tarifa/gl × esos galones.
  const galonesFlete = (f: FleteInput): number => {
    const sel = f.aplica_a.filter((c) => productosEnCompra.includes(c))
    const codes = sel.length === 0 ? productosEnCompra : sel
    return codes.reduce((s, code) => s + numf(lineas[code]?.galones), 0)
  }
  const totalFleteDe = (f: FleteInput): number => numf(f.precio) * galonesFlete(f)
  const totalFlete = fletes.reduce((s, f) => s + totalFleteDe(f), 0)

  async function guardar() {
    setError(null)
    const lineasPayload = PRODUCTOS.filter((p) => numf(lineas[p.code]?.galones) > 0).map((p) => ({
      tipo_combustible: p.code,
      galones: numf(lineas[p.code].galones),
      precio_gl: numf(lineas[p.code].precio),
    }))

    if (!fecha) return setError('Falta la fecha.')
    if (lineasPayload.length === 0) return setError('Ingresa al menos un producto con galones.')
    if (lineasPayload.some((l) => l.precio_gl <= 0)) return setError('Cada producto necesita su precio por galón.')

    const fletesPayload = fletes
      .filter((f) => numf(f.precio) > 0)
      .map((f) => {
        // aplica_a se guarda solo si es un SUBCONJUNTO; vacío o "todos" → null.
        const sel = f.aplica_a.filter((c) => productosEnCompra.includes(c))
        const aplica_a = sel.length === 0 || sel.length === productosEnCompra.length ? null : sel
        return {
          transportista: f.transportista.trim() || null,
          precio_gl: numf(f.precio),
          aplica_a,
          estado_pago: f.estado_pago,
          fecha_pago: f.estado_pago === 'pagado' ? f.fecha_pago || null : null,
        }
      })

    const payload: Record<string, unknown> = {
      fecha,
      proveedor_id: proveedorId || null,
      notas: notas.trim() || null,
      lineas: lineasPayload,
      fletes: fletesPayload,
    }
    if (compra) payload.id = compra.id

    setSaving(true)
    const { error: err } = await supabase.rpc('fn_guardar_compra', { p: payload })
    setSaving(false)
    if (err) {
      setError(err.message)
      return
    }
    onSaved()
    onClose()
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="mx-4 max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-lg border border-app-border bg-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="mb-3 text-sm font-semibold text-app-text">
          {compra ? 'Editar compra' : 'Nueva compra'}
        </h3>

        {/* Cabecera: fecha + proveedor */}
        <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs text-app-muted">Fecha</label>
            <input type="date" className="input" value={fecha} onChange={(e) => setFecha(e.target.value)} />
          </div>
          <div>
            <label className="mb-1 block text-xs text-app-muted">Proveedor</label>
            <select className="input" value={proveedorId} onChange={(e) => setProveedorId(e.target.value)}>
              <option value="">— Sin especificar —</option>
              {proveedores.map((p) => (
                <option key={p.id} value={p.id}>{p.nombre}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Productos */}
        <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-app-muted">Productos</h4>
        <table className="table-excel mb-1 w-full">
          <thead>
            <tr>
              <th>PRODUCTO</th>
              <th className="text-right">GALONES</th>
              <th className="text-right">PRECIO/GL (S/)</th>
              <th className="text-right">IMPORTE</th>
            </tr>
          </thead>
          <tbody>
            {PRODUCTOS.map((p) => (
              <tr key={p.code}>
                <td className="font-medium">{p.label}</td>
                <td className="text-right">
                  <input
                    type="number" min="0" step="0.01" placeholder="0"
                    className="w-full bg-transparent text-right outline-none"
                    value={lineas[p.code].galones}
                    onChange={(e) => setLinea(p.code, 'galones', e.target.value)}
                  />
                </td>
                <td className="text-right">
                  <input
                    type="number" min="0" step="0.0001" placeholder="0.0000"
                    className="w-full bg-transparent text-right outline-none"
                    value={lineas[p.code].precio}
                    onChange={(e) => setLinea(p.code, 'precio', e.target.value)}
                  />
                </td>
                <td className="text-right font-mono text-xs text-app-muted">
                  {importe(p.code) > 0 ? 'S/ ' + importe(p.code).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="font-semibold">
              <td colSpan={3} className="text-right text-xs">MONTO PAGADO (combustible)</td>
              <td className="text-right font-mono text-xs">
                S/ {totalPagado.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </td>
            </tr>
          </tfoot>
        </table>
        <p className="mb-4 text-[11px] text-app-muted">Deja en blanco los productos que no vinieron en esta compra.</p>

        {/* Fletes */}
        <div className="mb-1 flex items-center justify-between">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-app-muted">
            Fletes {totalFlete > 0 && <span className="ml-1 font-mono normal-case text-app-muted">· S/ {totalFlete.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>}
          </h4>
          <button
            className="btn-ghost text-xs"
            disabled={fletes.length >= 3}
            onClick={() => setFletes((prev) => [...prev, { transportista: '', precio: '', aplica_a: [], estado_pago: 'pendiente', fecha_pago: '' }])}
          >
            + Agregar flete {fletes.length >= 3 && '(máx. 3)'}
          </button>
        </div>

        {fletes.length === 0 ? (
          <p className="mb-4 rounded border border-dashed border-app-border p-2 text-[11px] text-app-muted">
            Sin fletes. Agrega hasta 3 (distintos transportistas) si esta compra tuvo costo de flete.
          </p>
        ) : (
          <div className="mb-4 space-y-2">
            {fletes.map((f, i) => (
              <div key={i} className="rounded border border-app-border p-2">
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-12">
                  <input
                    className="input sm:col-span-4" placeholder="Transportista"
                    value={f.transportista} onChange={(e) => setFlete(i, { transportista: e.target.value })}
                  />
                  <input
                    type="number" min="0" step="0.0001" placeholder="Tarifa/gl S/"
                    className="input-money sm:col-span-3"
                    value={f.precio} onChange={(e) => setFlete(i, { precio: e.target.value })}
                  />
                  <select
                    className="input sm:col-span-3"
                    value={f.estado_pago} onChange={(e) => setFlete(i, { estado_pago: e.target.value as 'pagado' | 'pendiente' })}
                  >
                    <option value="pendiente">Pendiente</option>
                    <option value="pagado">Pagado</option>
                  </select>
                  <button
                    className="btn-ghost text-xs text-danger-text sm:col-span-2"
                    onClick={() => setFletes((prev) => prev.filter((_, idx) => idx !== i))}
                  >
                    Quitar
                  </button>
                </div>
                {numf(f.precio) > 0 && galonesFlete(f) > 0 && (
                  <div className="mt-1 text-right font-mono text-[11px] text-app-muted">
                    Total flete: <span className="text-app-text">S/ {totalFleteDe(f).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                    {' '}= tarifa × {galonesFlete(f).toLocaleString('es-PE', { maximumFractionDigits: 2 })} gl
                  </div>
                )}
                <div className="mt-2 flex flex-wrap items-center gap-3">
                  <span className="text-[11px] text-app-muted">Aplica a:</span>
                  {PRODUCTOS.map((p) => {
                    const enCompra = productosEnCompra.includes(p.code)
                    return (
                      <label key={p.code} className={`flex items-center gap-1 text-[11px] ${enCompra ? 'text-app-text' : 'text-app-muted opacity-50'}`}>
                        <input
                          type="checkbox" disabled={!enCompra}
                          checked={f.aplica_a.includes(p.code)}
                          onChange={() => toggleAplica(i, p.code)}
                        />
                        {p.label}
                      </label>
                    )
                  })}
                  <span className="text-[11px] text-app-muted">(ninguno = todos)</span>
                  {f.estado_pago === 'pagado' && (
                    <label className="ml-auto flex items-center gap-1 text-[11px] text-app-muted">
                      Pago:
                      <input
                        type="date" className="input !w-auto !py-0.5 text-xs"
                        value={f.fecha_pago} onChange={(e) => setFlete(i, { fecha_pago: e.target.value })}
                      />
                    </label>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Notas */}
        <div className="mb-2">
          <label className="mb-1 block text-xs text-app-muted">Notas (opcional)</label>
          <textarea className="input h-16" value={notas} onChange={(e) => setNotas(e.target.value)} />
        </div>

        {error && (
          <div className="mb-2 rounded border border-danger-dark bg-danger px-3 py-2 text-xs font-medium text-danger-text">
            {error}
          </div>
        )}

        <div className="mt-2 flex justify-end gap-2">
          <button className="btn-ghost text-xs" onClick={onClose}>Cancelar</button>
          <button className="btn-primary text-xs" onClick={guardar} disabled={saving}>
            {saving ? 'Guardando…' : 'Guardar compra'}
          </button>
        </div>
      </div>
    </div>
  )
}
