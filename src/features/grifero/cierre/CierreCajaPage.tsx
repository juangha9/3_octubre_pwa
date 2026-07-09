import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/features/auth/useAuth'
import { useTurnos, formatHorario } from '@/hooks/useTurnos'
import { toCentimos, formatSoles, sumCentimos } from '@/lib/money'
import { hoyLocal, formatFecha, formatHora } from '@/lib/date'
import { COIN_DEFS, BILL_DEFS, VALE_TYPES, TipoVale } from '../constants'
import DenomCounter from './DenomCounter'
import ValeModal, { ValeItem } from './ValeModal'
import ThemeToggle from '@/components/ThemeToggle'

type ValesByTipo = Record<TipoVale, ValeItem[]>

const emptyVales = (): ValesByTipo => ({
  licitacion: [],
  corporacion: [],
  citv: [],
  chevron: [],
  credito: [],
})

export default function CierreCajaPage({ base = '' }: { base?: string }) {
  const navigate = useNavigate()
  const { session, profile } = useAuth()
  const { data: turnos = [] } = useTurnos()

  const [now, setNow] = useState(new Date())
  const [turnoId, setTurnoId] = useState<number | null>(null)
  const [denoms, setDenoms] = useState<Record<string, number>>({})
  const [yapeStr, setYapeStr] = useState('')
  const [openpayStr, setOpenpayStr] = useState('')
  const [totalConsolaStr, setTotalConsolaStr] = useState('')
  const [valesByTipo, setValesByTipo] = useState<ValesByTipo>(emptyVales())
  const [modalTipo, setModalTipo] = useState<TipoVale | null>(null)
  const [guardadoOk, setGuardadoOk] = useState(false)

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30000)
    return () => clearInterval(t)
  }, [])

  // Selecciona el primer turno al cargar
  useEffect(() => {
    if (turnoId === null && turnos.length > 0) setTurnoId(turnos[0].id)
  }, [turnos, turnoId])

  const turnoSel = turnos.find((t) => t.id === turnoId)

  // ── Cálculos (todo en céntimos) ──
  const coinsTotal = COIN_DEFS.reduce((s, d) => s + (denoms[d.key] ?? 0) * d.centimos, 0)
  const billsTotal = BILL_DEFS.reduce((s, d) => s + (denoms[d.key] ?? 0) * d.centimos, 0)
  const efectivoCentimos = coinsTotal + billsTotal

  const valeTotalDe = (tipo: TipoVale) =>
    sumCentimos(valesByTipo[tipo].map((v) => toCentimos(v.montoStr)))
  const valesGrandTotal = VALE_TYPES.reduce((s, vt) => s + valeTotalDe(vt.tipo), 0)

  const yapeCentimos = toCentimos(yapeStr)
  const openpayCentimos = toCentimos(openpayStr)
  const totalCentimos = efectivoCentimos + yapeCentimos + openpayCentimos + valesGrandTotal

  const consolaCentimos = toCentimos(totalConsolaStr)
  const hayConsola = totalConsolaStr.trim() !== ''
  const difCentimos = totalCentimos - consolaCentimos
  const sobra = hayConsola && difCentimos > 0
  const falta = hayConsola && difCentimos < 0
  const exacto = hayConsola && difCentimos === 0

  // ── Guardar ──
  const guardar = useMutation({
    mutationFn: async () => {
      if (!session) throw new Error('No hay sesión activa')
      if (!turnoId) throw new Error('Selecciona un turno')

      const { data: cierre, error } = await supabase
        .from('cierres_caja')
        .insert({
          colaborador_id: session.user.id,
          turno_id: turnoId,
          fecha: hoyLocal(),
          efectivo_centimos: efectivoCentimos,
          yape_centimos: yapeCentimos,
          openpay_centimos: openpayCentimos,
          dscto_vales_centimos: valesGrandTotal,
          total_consola_centimos: hayConsola ? consolaCentimos : null,
          diferencia_centimos: hayConsola ? difCentimos : null,
          estado: 'enviado',
        })
        .select('id')
        .single()
      if (error) throw error
      const cierreId = cierre.id as string

      // Denominaciones (solo con cantidad > 0)
      const denomRows = [
        ...COIN_DEFS.map((d) => ({ def: d, tipo: 'moneda' as const })),
        ...BILL_DEFS.map((d) => ({ def: d, tipo: 'billete' as const })),
      ]
        .filter(({ def }) => (denoms[def.key] ?? 0) > 0)
        .map(({ def, tipo }) => ({
          cierre_id: cierreId,
          tipo,
          denominacion_centimos: def.centimos,
          cantidad: denoms[def.key],
        }))
      if (denomRows.length) {
        const { error: e2 } = await supabase.from('cierre_denominaciones').insert(denomRows)
        if (e2) throw e2
      }

      // Vales (aplanar todos los tipos, solo monto > 0)
      const valeRows: {
        cierre_id: string
        tipo_vale: TipoVale
        descripcion: string | null
        monto_centimos: number
        orden: number
      }[] = []
      let orden = 0
      for (const { tipo } of VALE_TYPES) {
        for (const item of valesByTipo[tipo]) {
          const monto = toCentimos(item.montoStr)
          if (monto > 0) {
            valeRows.push({
              cierre_id: cierreId,
              tipo_vale: tipo,
              descripcion: item.descripcion.trim() || null,
              monto_centimos: monto,
              orden: orden++,
            })
          }
        }
      }
      if (valeRows.length) {
        const { error: e3 } = await supabase.from('cierre_vales').insert(valeRows)
        if (e3) throw e3
      }

      return cierreId
    },
    onSuccess: () => {
      setGuardadoOk(true)
      setTimeout(() => setGuardadoOk(false), 4000)
    },
  })

  function limpiar() {
    if (!window.confirm('¿Borrar todos los datos del cierre?')) return
    setDenoms({})
    setYapeStr('')
    setOpenpayStr('')
    setTotalConsolaStr('')
    setValesByTipo(emptyVales())
  }

  return (
    <div className="min-h-screen bg-app-bg">
      {/* Top bar */}
      <div className="sticky top-0 z-20 flex h-12 items-center gap-3 border-b border-app-border bg-white px-4 shadow-sm">
        <button
          onClick={() => navigate(base || '/')}
          className="flex h-8 w-8 items-center justify-center rounded-lg bg-app-bg text-lg text-app-muted transition-colors duration-200 hover:bg-app-border"
        >
          ←
        </button>
        <div className="flex-1 text-base font-semibold text-app-text">Cierre de Caja</div>
        <ThemeToggle />
        <div className="rounded-lg border border-app-border bg-app-bg px-3 py-1 text-xs font-medium text-app-muted">
          {formatFecha(now)} · {formatHora(now)}
        </div>
      </div>

      {/* Banner de éxito */}
      {guardadoOk && (
        <div className="mx-auto mt-2 max-w-6xl px-3">
          <div className="rounded-lg border border-success-dark bg-success px-4 py-2 text-sm font-medium text-success-text transition-all duration-200">
            ✓ Cierre guardado y enviado al administrador.
          </div>
        </div>
      )}
      {guardar.isError && (
        <div className="mx-auto mt-2 max-w-6xl px-3">
          <div className="rounded-lg border border-danger-dark bg-danger px-4 py-2 text-sm font-medium text-danger-text">
            Error al guardar: {(guardar.error as Error).message}
          </div>
        </div>
      )}

      {/* Grid principal */}
      <div className="mx-auto grid max-w-6xl grid-cols-1 gap-3 p-3 lg:grid-cols-2">
        {/* ── COLUMNA IZQUIERDA ── */}
        <div className="flex flex-col gap-3">
          {/* Info de turno */}
          <div className="card !p-3">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-app-muted">
              Información de Turno
            </div>
            <div className="mb-2">
              <label className="mb-1 block text-xs font-medium text-app-muted">Colaborador</label>
              <div className="input bg-app-bg font-medium">{profile?.nombre ?? '—'}</div>
            </div>
            <div className="grid grid-cols-[1fr_1fr] gap-2">
              <div>
                <label className="mb-1 block text-xs font-medium text-app-muted">Turno</label>
                <select
                  className="input cursor-pointer font-medium"
                  value={turnoId ?? ''}
                  onChange={(e) => setTurnoId(Number(e.target.value))}
                >
                  {turnos.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.nombre}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-app-muted">Horario</label>
                <div className="input bg-app-bg text-app-muted">{formatHorario(turnoSel)}</div>
              </div>
            </div>
          </div>

          {/* Medios de pago */}
          <div className="card !p-3">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-app-muted">
              Medios de Pago
            </div>
            {/* Efectivo (auto) */}
            <div className="mb-3 flex items-center justify-between rounded-lg border border-success-dark bg-success px-3 py-2">
              <div>
                <div className="text-xs font-semibold uppercase text-success-text">Efectivo</div>
                <div className="text-xs text-success-text/70">Auto-calculado del conteo</div>
              </div>
              <div className="font-mono text-xl font-bold text-success-text">
                {formatSoles(efectivoCentimos)}
              </div>
            </div>
            {/* Yape */}
            <PagoRow label="Yape" badge="Y" badgeBg="bg-purple-600" value={yapeStr} onChange={setYapeStr} />
            {/* OpenPay */}
            <PagoRow label="OpenPay" badge="OP" badgeBg="bg-sky-700" value={openpayStr} onChange={setOpenpayStr} />
          </div>

          {/* Vales */}
          <div className="card !p-3">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-app-muted">
              Vales
            </div>
            <div className="flex flex-col gap-1.5">
              {VALE_TYPES.map((vt) => {
                const total = valeTotalDe(vt.tipo)
                const count = valesByTipo[vt.tipo].filter((v) => toCentimos(v.montoStr) > 0).length
                return (
                  <button
                    key={vt.tipo}
                    onClick={() => setModalTipo(vt.tipo)}
                    className="flex items-center justify-between rounded-lg border border-app-border bg-white px-3 py-2 text-left transition-all duration-200 hover:border-primary-dark hover:bg-blue-50"
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-app-text">{vt.label}</span>
                      {count > 0 && <span className="badge-primary">{count}</span>}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm font-semibold text-app-text">
                        {formatSoles(total)}
                      </span>
                      <span className="text-app-muted">›</span>
                    </div>
                  </button>
                )
              })}
            </div>
            <div className="mt-2 flex items-center justify-between border-t border-app-border pt-2">
              <span className="text-xs font-medium text-app-muted">Total vales</span>
              <span className="font-mono text-base font-bold text-app-text">
                {formatSoles(valesGrandTotal)}
              </span>
            </div>
          </div>

          {/* Resumen */}
          <div className="card !p-3">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-app-muted">
              Resumen
            </div>
            <div className="flex items-center justify-between border-b border-app-border py-2">
              <span className="text-sm font-medium text-app-text">Total contado</span>
              <span className="font-mono text-xl font-bold text-app-text">
                {formatSoles(totalCentimos)}
              </span>
            </div>
            <div className="flex items-center justify-between border-b border-app-border py-2">
              <span className="text-sm font-medium text-app-text">Total Consola</span>
              <div className="flex items-center gap-1">
                <span className="text-xs text-app-muted">S/</span>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  className="input-money w-32"
                  placeholder="0.00"
                  value={totalConsolaStr}
                  onChange={(e) => setTotalConsolaStr(e.target.value)}
                />
              </div>
            </div>
            <div className="flex items-center justify-between py-2">
              <span className="text-sm font-semibold text-app-text">Diferencia</span>
              {!hayConsola ? (
                <span className="text-xl font-bold text-app-muted">—</span>
              ) : (
                <div className="flex items-center gap-2">
                  <span
                    className={`font-mono text-xl font-bold ${
                      sobra ? 'text-primary-text' : falta ? 'text-danger-text' : 'text-success-text'
                    }`}
                  >
                    {formatSoles(Math.abs(difCentimos))}
                  </span>
                  {sobra && <span className="badge-primary">SOBRA</span>}
                  {falta && <span className="badge-danger">FALTA</span>}
                  {exacto && <span className="badge-success">EXACTO</span>}
                </div>
              )}
            </div>
          </div>

          {/* Acciones */}
          <div className="flex gap-2 pb-6">
            <button onClick={limpiar} className="btn-danger flex-1">
              Limpiar
            </button>
            <button
              onClick={() => guardar.mutate()}
              disabled={guardar.isPending || !turnoId}
              className="btn-success flex-[2]"
            >
              {guardar.isPending ? 'Guardando...' : 'Guardar y Enviar'}
            </button>
          </div>
        </div>

        {/* ── COLUMNA DERECHA: Conteo ── */}
        <div className="flex flex-col gap-3">
          <DenomCounter
            titulo="Monedas"
            defs={COIN_DEFS}
            cantidades={denoms}
            onChange={(key, qty) => setDenoms((p) => ({ ...p, [key]: qty }))}
          />
          <DenomCounter
            titulo="Billetes"
            defs={BILL_DEFS}
            cantidades={denoms}
            onChange={(key, qty) => setDenoms((p) => ({ ...p, [key]: qty }))}
          />
          <div className="rounded-lg bg-primary p-4 shadow-sm">
            <div className="text-xs font-semibold uppercase tracking-wide text-primary-text/70">
              Total Efectivo (Monedas + Billetes)
            </div>
            <div className="mt-1 font-mono text-3xl font-bold text-primary-text">
              {formatSoles(efectivoCentimos)}
            </div>
          </div>
        </div>
      </div>

      {/* Modal de vales */}
      {modalTipo && (
        <ValeModal
          titulo={VALE_TYPES.find((v) => v.tipo === modalTipo)!.label}
          items={valesByTipo[modalTipo]}
          onCerrar={() => setModalTipo(null)}
          onGuardar={(items) => {
            setValesByTipo((p) => ({ ...p, [modalTipo]: items }))
            setModalTipo(null)
          }}
        />
      )}
    </div>
  )
}

interface PagoRowProps {
  label: string
  badge: string
  badgeBg: string
  value: string
  onChange: (v: string) => void
}

function PagoRow({ label, badge, badgeBg, value, onChange }: PagoRowProps) {
  return (
    <div className="flex items-center gap-3 border-b border-app-border py-2 last:border-0">
      <div
        className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg ${badgeBg} text-xs font-bold text-white`}
      >
        {badge}
      </div>
      <div className="flex-1 text-sm font-medium text-app-text">{label}</div>
      <div className="flex items-center gap-1">
        <span className="text-xs text-app-muted">S/</span>
        <input
          type="number"
          step="0.01"
          min="0"
          className="input-money w-28"
          placeholder="0.00"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      </div>
    </div>
  )
}
