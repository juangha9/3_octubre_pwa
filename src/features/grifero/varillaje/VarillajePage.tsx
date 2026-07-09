import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/features/auth/useAuth'
import { useTurnos, formatHorario } from '@/hooks/useTurnos'
import { hoyLocal, formatFecha, formatHora } from '@/lib/date'
import ThemeToggle from '@/components/ThemeToggle'
import type { Tanque, VarillajeLectura } from '@/types'

type TipoControl = 'cambio_turno' | 'control_osinergmin'

// El grifero NUNCA maneja galones: solo registra la altura en cm. La conversión
// cm→galones la hace el servidor (trigger) y solo el administrador la ve. Por eso
// aquí no se pide, ni se lee, ni se muestra `volumen_galones`.
type LecturaGrifero = Pick<
  VarillajeLectura,
  'id' | 'tanque_id' | 'fecha' | 'tipo' | 'turno_id' | 'altura_cm' | 'created_at'
>

function tiempoDesde(iso: string): string {
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
  if (min < 60) return `hace ${min} min`
  const horas = Math.round(min / 60)
  if (horas < 24) return `hace ${horas} h`
  return `hace ${Math.round(horas / 24)} d`
}

export default function VarillajePage({ base = '' }: { base?: string }) {
  const navigate = useNavigate()
  const { session } = useAuth()
  const { data: turnos = [] } = useTurnos()

  const [now, setNow] = useState(new Date())
  const [tanques, setTanques] = useState<Tanque[]>([])
  const [ultimaPorTanque, setUltimaPorTanque] = useState<Record<number, LecturaGrifero>>({})
  const [historial, setHistorial] = useState<LecturaGrifero[]>([])
  const [loading, setLoading] = useState(true)

  const [tipo, setTipo] = useState<TipoControl>('cambio_turno')
  const [turnoId, setTurnoId] = useState<number | null>(null)
  const [alturas, setAlturas] = useState<Record<number, string>>({})
  const [guardadoOk, setGuardadoOk] = useState(false)

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    if (turnoId === null && turnos.length > 0) setTurnoId(turnos[0].id)
  }, [turnos, turnoId])

  async function cargar() {
    setLoading(true)
    const { data: tq } = await supabase
      .from('tanques')
      .select('*')
      .eq('activo', true)
      .order('layout_fila')
      .order('layout_columna')
    const activos = (tq as Tanque[]) ?? []
    setTanques(activos)

    const ids = activos.map((t) => t.id)
    if (ids.length > 0) {
      // Selección explícita SIN volumen_galones: el grifero no recibe galones.
      const { data: lec } = await supabase
        .from('varillaje_lecturas')
        .select('id, tanque_id, fecha, tipo, turno_id, altura_cm, created_at')
        .in('tanque_id', ids)
        .order('created_at', { ascending: false })
        .limit(80)

      const lecturas = (lec as LecturaGrifero[]) ?? []
      const ultima: Record<number, LecturaGrifero> = {}
      for (const l of lecturas) {
        if (!ultima[l.tanque_id]) ultima[l.tanque_id] = l
      }
      setUltimaPorTanque(ultima)
      setHistorial(lecturas.slice(0, 15))
    } else {
      setUltimaPorTanque({})
      setHistorial([])
    }
    setLoading(false)
  }

  useEffect(() => {
    cargar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function setAltura(tanqueId: number, v: string) {
    setAlturas((prev) => ({ ...prev, [tanqueId]: v }))
  }

  const filas = Math.max(1, ...tanques.map((t) => t.layout_fila ?? 1))
  const columnas = Math.max(1, ...tanques.map((t) => t.layout_columna ?? 1))

  const porCelda = useMemo(() => {
    const map = new Map<string, Tanque>()
    for (const t of tanques) {
      if (t.layout_fila != null && t.layout_columna != null) {
        map.set(`${t.layout_fila}-${t.layout_columna}`, t)
      }
    }
    return map
  }, [tanques])

  const pendientes = tanques.filter((t) => {
    const v = parseFloat(alturas[t.id] ?? '')
    return !isNaN(v) && v > 0
  })

  const guardar = useMutation({
    mutationFn: async () => {
      if (!session) throw new Error('No hay sesión activa')
      if (tipo === 'cambio_turno' && !turnoId) throw new Error('Selecciona un turno')
      if (pendientes.length === 0) throw new Error('Ingresa al menos una altura medida')

      // Se envía solo la altura; el servidor calcula el volumen (trigger).
      const filasInsert = pendientes.map((t) => ({
        tanque_id: t.id,
        fecha: hoyLocal(),
        tipo,
        turno_id: tipo === 'cambio_turno' ? turnoId : null,
        colaborador_id: session.user.id,
        altura_cm: parseFloat(alturas[t.id]),
      }))
      const { error } = await supabase.from('varillaje_lecturas').insert(filasInsert)
      if (error) throw error
    },
    onSuccess: () => {
      setAlturas({})
      setGuardadoOk(true)
      setTimeout(() => setGuardadoOk(false), 4000)
      cargar()
    },
  })

  if (loading) {
    return <p className="p-6 text-sm text-app-muted">Cargando…</p>
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
        <div className="flex-1 text-base font-semibold text-app-text">Varillaje</div>
        <ThemeToggle />
        <div className="rounded-lg border border-app-border bg-app-bg px-3 py-1 text-xs font-medium text-app-muted">
          {formatFecha(now)} · {formatHora(now)}
        </div>
      </div>

      {guardadoOk && (
        <div className="mx-auto mt-2 max-w-4xl px-3">
          <div className="rounded-lg border border-success-dark bg-success px-4 py-2 text-sm font-medium text-success-text">
            ✓ Lecturas guardadas.
          </div>
        </div>
      )}
      {guardar.isError && (
        <div className="mx-auto mt-2 max-w-4xl px-3">
          <div className="rounded-lg border border-danger-dark bg-danger px-4 py-2 text-sm font-medium text-danger-text">
            Error al guardar: {(guardar.error as Error).message}
          </div>
        </div>
      )}

      <div className="mx-auto max-w-4xl p-3">
        {tanques.length === 0 ? (
          <p className="rounded border border-app-border bg-white p-4 text-sm text-app-muted">
            No hay tanques activos configurados. Pide al administrador que los agregue en Configuración → Tanques.
          </p>
        ) : (
          <>
            {/* Tipo de control */}
            <div className="card mb-3 !p-3">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-app-muted">
                Tipo de control
              </div>
              <div className="mb-3 flex gap-2">
                <button
                  onClick={() => setTipo('cambio_turno')}
                  className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition-colors duration-150 ${
                    tipo === 'cambio_turno'
                      ? 'border-primary-dark bg-primary text-primary-text'
                      : 'border-app-border bg-white text-app-muted'
                  }`}
                >
                  Cambio de turno
                </button>
                <button
                  onClick={() => setTipo('control_osinergmin')}
                  className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition-colors duration-150 ${
                    tipo === 'control_osinergmin'
                      ? 'border-primary-dark bg-primary text-primary-text'
                      : 'border-app-border bg-white text-app-muted'
                  }`}
                >
                  Control diario (OSINERGMIN)
                </button>
              </div>
              {tipo === 'cambio_turno' && (
                <div>
                  <label className="mb-1 block text-xs font-medium text-app-muted">Turno</label>
                  <select
                    className="input cursor-pointer font-medium"
                    value={turnoId ?? ''}
                    onChange={(e) => setTurnoId(Number(e.target.value))}
                  >
                    {turnos.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.nombre} ({formatHorario(t)})
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            {/* Grilla de tanques — misma disposición armada por el superadmin */}
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-app-muted">
              Medición por tanque
            </div>
            <div
              className="mb-4 grid gap-3"
              style={{
                gridTemplateColumns: `repeat(${columnas}, minmax(150px, 1fr))`,
                gridTemplateRows: `repeat(${filas}, auto)`,
              }}
            >
              {Array.from({ length: filas }).flatMap((_, fi) =>
                Array.from({ length: columnas }).map((_, ci) => {
                  const fila = fi + 1
                  const columna = ci + 1
                  const tanque = porCelda.get(`${fila}-${columna}`)
                  if (!tanque) return <div key={`${fila}-${columna}`} />

                  const alturaStr = alturas[tanque.id] ?? ''
                  const ultima = ultimaPorTanque[tanque.id]

                  return (
                    <div key={`${fila}-${columna}`} className="card !p-3">
                      <div className="mb-1 flex items-center gap-2">
                        <span className="text-lg">🛢️</span>
                        <span className="text-sm font-semibold text-app-text">{tanque.nombre}</span>
                      </div>
                      <p className="mb-2 text-xs text-app-muted">
                        {ultima
                          ? `Última medición: ${ultima.altura_cm} cm (${tiempoDesde(ultima.created_at)})`
                          : 'Sin mediciones previas.'}
                      </p>

                      <label className="mb-1 block text-xs font-medium text-app-muted">
                        Altura medida (cm)
                      </label>
                      <input
                        type="number"
                        min="0"
                        step="0.5"
                        placeholder="0"
                        className="input"
                        value={alturaStr}
                        onChange={(e) => setAltura(tanque.id, e.target.value)}
                      />
                    </div>
                  )
                })
              )}
            </div>

            <button
              onClick={() => guardar.mutate()}
              disabled={guardar.isPending || pendientes.length === 0}
              className="btn-primary w-full text-sm"
            >
              {guardar.isPending ? 'Guardando…' : `Guardar lecturas (${pendientes.length})`}
            </button>

            {/* Historial reciente — solo cm, sin galones */}
            {historial.length > 0 && (
              <div className="mt-6">
                <h3 className="mb-2 text-sm font-semibold text-app-text">Mis mediciones recientes</h3>
                <table className="table-excel w-auto">
                  <thead>
                    <tr>
                      <th>Fecha</th>
                      <th>Tanque</th>
                      <th>Tipo</th>
                      <th className="text-right">Altura (cm)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {historial.map((l) => (
                      <tr key={l.id}>
                        <td className="text-xs">{new Date(l.created_at).toLocaleString('es-PE')}</td>
                        <td className="text-xs">{tanques.find((t) => t.id === l.tanque_id)?.nombre ?? '—'}</td>
                        <td className="text-xs">
                          {l.tipo === 'cambio_turno' ? 'Cambio de turno' : 'OSINERGMIN'}
                        </td>
                        <td className="text-right font-mono text-xs">{l.altura_cm}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
