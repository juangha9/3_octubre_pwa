import { DenomDef } from '../constants'
import { formatSoles } from '@/lib/money'

interface DenomCounterProps {
  titulo: string
  defs: DenomDef[]
  cantidades: Record<string, number>
  onChange: (key: string, cantidad: number) => void
}

export default function DenomCounter({ titulo, defs, cantidades, onChange }: DenomCounterProps) {
  const total = defs.reduce((sum, d) => sum + (cantidades[d.key] ?? 0) * d.centimos, 0)

  return (
    <div className="card !p-3">
      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-app-muted">
        {titulo}
      </div>

      <table className="table-excel">
        <thead>
          <tr>
            <th>Denominación</th>
            <th className="text-center" style={{ width: 110 }}>
              Cantidad
            </th>
            <th className="text-right" style={{ width: 90 }}>
              Total
            </th>
          </tr>
        </thead>
        <tbody>
          {defs.map((d) => {
            const qty = cantidades[d.key] ?? 0
            return (
              <tr key={d.key}>
                <td className="font-medium">{d.label}</td>
                <td>
                  <div className="flex items-center justify-center gap-1">
                    <button
                      onClick={() => onChange(d.key, Math.max(0, qty - 1))}
                      className="flex h-6 w-6 items-center justify-center rounded border border-app-border bg-app-bg text-app-muted transition-colors duration-200 hover:bg-app-border"
                    >
                      −
                    </button>
                    <input
                      type="number"
                      min="0"
                      className="h-6 w-12 rounded border border-app-border text-center text-sm font-semibold text-app-text outline-none focus:border-primary-dark focus:ring-1 focus:ring-primary-dark"
                      value={qty === 0 ? '' : qty}
                      placeholder="0"
                      onChange={(e) => onChange(d.key, Math.max(0, parseInt(e.target.value) || 0))}
                    />
                    <button
                      onClick={() => onChange(d.key, qty + 1)}
                      className="flex h-6 w-6 items-center justify-center rounded border border-app-border bg-app-bg text-app-muted transition-colors duration-200 hover:bg-app-border"
                    >
                      +
                    </button>
                  </div>
                </td>
                <td className="text-right font-mono text-success-text">
                  {qty > 0 ? formatSoles(qty * d.centimos) : '—'}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>

      <div className="mt-2 flex items-center justify-between border-t border-app-border pt-2">
        <span className="text-xs font-medium text-app-muted">Total {titulo.toLowerCase()}</span>
        <span className="font-mono text-sm font-bold text-success-text">{formatSoles(total)}</span>
      </div>
    </div>
  )
}
