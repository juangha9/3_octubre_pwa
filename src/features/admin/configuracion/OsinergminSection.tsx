import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/features/auth/useAuth'
import { Field, Loading } from './_helpers'

// Configuración de la FUENTE de precios OSINERGMIN (solo superadmin).
// La acción de "actualizar precios" vive en la pestaña OSINERGMIN, no aquí.
export default function OsinergminSection() {
  const { role } = useAuth()
  const esSuperadmin = role === 'superadmin'

  const [url, setUrl] = useState('')
  const [ruc, setRuc] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [savedOk, setSavedOk] = useState(false)

  async function load() {
    setLoading(true)
    const { data: cfg } = await supabase
      .from('app_config')
      .select('clave, valor')
      .in('clave', ['osinergmin_url_excel', 'osinergmin_ruc'])
    const map = Object.fromEntries((cfg ?? []).map((r) => [r.clave, r.valor]))
    setUrl(map['osinergmin_url_excel'] ?? '')
    setRuc(map['osinergmin_ruc'] ?? '')
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  async function guardar() {
    setSaving(true)
    setSavedOk(false)
    await supabase.from('app_config').upsert([
      { clave: 'osinergmin_url_excel', valor: url.trim() },
      { clave: 'osinergmin_ruc', valor: ruc.trim() },
    ])
    setSaving(false)
    setSavedOk(true)
    setTimeout(() => setSavedOk(false), 3000)
  }

  if (loading) return <Loading />

  if (!esSuperadmin) {
    return (
      <div className="max-w-2xl">
        <p className="rounded border border-app-border bg-white p-4 text-sm text-app-muted">
          Solo el superadmin puede configurar la fuente de precios OSINERGMIN.
        </p>
      </div>
    )
  }

  return (
    <div className="max-w-2xl">
      <h2 className="mb-1 text-sm font-semibold text-app-text">Fuente de precios OSINERGMIN</h2>
      <p className="mb-4 text-xs text-app-muted">
        El sistema descarga el Excel de "Últimos Precios Registrados", encuentra tu grifo por RUC
        y calcula tu ranking de precios dentro de tu distrito. La actualización se ejecuta desde la
        pestaña <span className="font-medium">OSINERGMIN</span> (arriba).
      </p>

      <div className="space-y-3">
        <Field label="Link de descarga del Excel (.xlsx)">
          <input
            className="input"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://…/Ultimos-Precios-Registrados-EVPC.xlsx"
          />
        </Field>
        <Field label="RUC de la estación (11 dígitos)">
          <input
            className="input"
            value={ruc}
            onChange={(e) => setRuc(e.target.value.replace(/\D/g, '').slice(0, 11))}
            placeholder="20xxxxxxxxx"
            inputMode="numeric"
          />
        </Field>
        <div className="flex items-center gap-2">
          <button className="btn-primary text-xs" onClick={guardar} disabled={saving}>
            {saving ? 'Guardando…' : 'Guardar configuración'}
          </button>
          {savedOk && <span className="text-xs font-medium text-success-dark">✓ Guardado</span>}
        </div>
      </div>

      <p className="mt-4 text-xs text-app-muted">
        La actualización automática diaria se configura con un cron en Supabase
        (ver <span className="font-mono">supabase/migrations/007_osinergmin_config_cron.sql</span>).
      </p>
    </div>
  )
}
