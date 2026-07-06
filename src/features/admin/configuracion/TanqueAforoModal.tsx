import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { Tanque, TanqueAforo } from '@/types'
import { ModalBox, Loading } from './_helpers'

// Acepta pegado desde Excel (tab) o texto separado por ; , o espacios.
// Cada línea: altura_cm  volumen_galones. Las líneas no numéricas (headers) se ignoran.
function parseAforoLines(text: string): { altura_cm: number; volumen_galones: number }[] {
  const porAltura = new Map<number, number>()
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line) continue
    let parts = line.split('\t')
    if (parts.length < 2) parts = line.split(';')
    if (parts.length < 2) parts = line.split(',')
    if (parts.length < 2) parts = line.split(/\s+/)
    if (parts.length < 2) continue
    const altura = parseFloat(parts[0].replace(/[^\d.-]/g, ''))
    const volumen = parseFloat(parts[1].replace(/[^\d.-]/g, ''))
    if (!isNaN(altura) && !isNaN(volumen)) porAltura.set(altura, volumen)
  }
  return Array.from(porAltura.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([altura_cm, volumen_galones]) => ({ altura_cm, volumen_galones }))
}

export default function TanqueAforoModal({
  tanque,
  onClose,
}: {
  tanque: Tanque
  onClose: () => void
}) {
  const [rows, setRows] = useState<TanqueAforo[]>([])
  const [loading, setLoading] = useState(true)
  const [pegado, setPegado] = useState('')
  const [saving, setSaving] = useState(false)

  async function load() {
    setLoading(true)
    const { data } = await supabase
      .from('tanque_aforo')
      .select('*')
      .eq('tanque_id', tanque.id)
      .order('altura_cm')
    setRows((data as TanqueAforo[]) ?? [])
    setLoading(false)
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tanque.id])

  const preview = parseAforoLines(pegado)

  async function reemplazar() {
    if (preview.length === 0) return
    setSaving(true)
    await supabase.from('tanque_aforo').delete().eq('tanque_id', tanque.id)
    await supabase.from('tanque_aforo').insert(preview.map((r) => ({ ...r, tanque_id: tanque.id })))
    setPegado('')
    setSaving(false)
    load()
  }

  async function borrarTodo() {
    if (!window.confirm('¿Borrar toda la tabla de aforo de este tanque?')) return
    await supabase.from('tanque_aforo').delete().eq('tanque_id', tanque.id)
    load()
  }

  return (
    <ModalBox onClose={onClose}>
      <h3 className="mb-1 text-sm font-semibold">Tabla de aforo — {tanque.nombre}</h3>
      <p className="mb-3 text-xs text-app-muted">
        Convierte centímetros medidos con la varilla a galones (un tanque horizontal no es lineal).
        Copia tu hoja de conversión (columna cm y columna galones) y pégala abajo, una fila por línea.
      </p>

      <textarea
        className="input h-28 font-mono text-xs"
        placeholder={'10\t50.00\n20\t108.50\n30\t...'}
        value={pegado}
        onChange={(e) => setPegado(e.target.value)}
      />
      {pegado.trim() !== '' && (
        <p className="mt-1 text-xs text-app-muted">
          {preview.length > 0
            ? `${preview.length} filas detectadas (${preview[0].altura_cm} cm – ${preview[preview.length - 1].altura_cm} cm).`
            : 'No se detectaron filas válidas — revisa que sean cm y galones separados por tab, coma o espacio.'}
        </p>
      )}
      <div className="mt-2 flex justify-end">
        <button
          className="btn-primary text-xs"
          onClick={reemplazar}
          disabled={preview.length === 0 || saving}
        >
          {saving ? 'Guardando…' : `Reemplazar tabla (${preview.length} filas)`}
        </button>
      </div>

      <div className="mt-4 border-t border-app-border pt-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-semibold text-app-text">Tabla actual ({rows.length} filas)</span>
          {rows.length > 0 && (
            <button className="btn-ghost text-xs" onClick={borrarTodo}>Borrar todo</button>
          )}
        </div>
        {loading ? (
          <Loading />
        ) : rows.length === 0 ? (
          <p className="text-xs text-app-muted">Aún no hay tabla de aforo cargada para este tanque.</p>
        ) : (
          <div className="max-h-48 overflow-y-auto">
            <table className="table-excel w-auto">
              <thead>
                <tr>
                  <th className="text-right">CM</th>
                  <th className="text-right">GALONES</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td className="text-right font-mono text-xs">{r.altura_cm}</td>
                    <td className="text-right font-mono text-xs">{r.volumen_galones}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="mt-4 flex justify-end">
        <button className="btn-ghost text-xs" onClick={onClose}>Cerrar</button>
      </div>
    </ModalBox>
  )
}
