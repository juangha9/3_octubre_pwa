import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { Tanque } from '@/types'

/**
 * Editor de disposición visual: el superadmin arrastra cada tanque a la
 * celda de la grilla que corresponde a su ubicación física real. Esta misma
 * disposición la reproduce la pantalla de Varillaje del grifero.
 * Se auto-guarda en `tanques.layout_fila/layout_columna` al soltar.
 */
export default function TanqueLayoutEditor({
  tanques,
  onChanged,
}: {
  tanques: Tanque[]
  onChanged: () => void
}) {
  const [dragId, setDragId] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)

  // Primera vez: asigna una posición en fila 1 a los tanques que aún no tienen.
  useEffect(() => {
    const sinPosicion = tanques.filter((t) => t.layout_fila == null || t.layout_columna == null)
    if (sinPosicion.length === 0) return
    const colsFila1 = tanques
      .filter((t) => (t.layout_fila ?? 1) === 1 && t.layout_columna != null)
      .map((t) => t.layout_columna as number)
    let siguienteCol = colsFila1.length > 0 ? Math.max(...colsFila1) + 1 : 1

    ;(async () => {
      for (const t of sinPosicion) {
        await supabase
          .from('tanques')
          .update({ layout_fila: 1, layout_columna: siguienteCol })
          .eq('id', t.id)
        siguienteCol++
      }
      onChanged()
    })()
  }, [tanques, onChanged])

  const porCelda = useMemo(() => {
    const map = new Map<string, Tanque>()
    for (const t of tanques) {
      if (t.layout_fila != null && t.layout_columna != null) {
        map.set(`${t.layout_fila}-${t.layout_columna}`, t)
      }
    }
    return map
  }, [tanques])

  // +1 fila y +1 columna de "aire" para poder arrastrar a una posición nueva.
  const filas = Math.max(1, ...tanques.map((t) => t.layout_fila ?? 1)) + 1
  const columnas = Math.max(1, ...tanques.map((t) => t.layout_columna ?? 1)) + 1

  async function moverA(fila: number, columna: number) {
    if (dragId == null || busy) return
    const arrastrado = tanques.find((t) => t.id === dragId)
    if (!arrastrado) return
    const destino = porCelda.get(`${fila}-${columna}`)
    if (destino && destino.id === dragId) {
      setDragId(null)
      return
    }

    setBusy(true)
    if (destino) {
      // Intercambia posiciones para no dejar al tanque destino sin lugar.
      await Promise.all([
        supabase.from('tanques').update({ layout_fila: fila, layout_columna: columna }).eq('id', arrastrado.id),
        supabase
          .from('tanques')
          .update({ layout_fila: arrastrado.layout_fila, layout_columna: arrastrado.layout_columna })
          .eq('id', destino.id),
      ])
    } else {
      await supabase.from('tanques').update({ layout_fila: fila, layout_columna: columna }).eq('id', arrastrado.id)
    }
    setBusy(false)
    setDragId(null)
    onChanged()
  }

  return (
    <div className="mb-5">
      <div className="mb-2 flex items-baseline justify-between">
        <h3 className="text-sm font-semibold text-app-text">Disposición visual (Varillaje)</h3>
        <p className="text-xs text-app-muted">
          Arrastra cada tanque a su posición real. Así lo verá el grifero al medir. Se guarda al instante.
        </p>
      </div>
      <div
        className="inline-grid gap-2 rounded-lg border border-app-border bg-white p-3"
        style={{
          gridTemplateColumns: `repeat(${columnas}, 130px)`,
          gridTemplateRows: `repeat(${filas}, 76px)`,
        }}
      >
        {Array.from({ length: filas }).flatMap((_, fi) =>
          Array.from({ length: columnas }).map((_, ci) => {
            const fila = fi + 1
            const columna = ci + 1
            const tanque = porCelda.get(`${fila}-${columna}`)
            return (
              <div
                key={`${fila}-${columna}`}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => moverA(fila, columna)}
                className={`flex items-center justify-center rounded-md border-2 border-dashed text-center text-xs transition-colors duration-150 ${
                  tanque ? 'border-transparent' : 'border-app-border text-app-muted hover:border-primary-dark'
                }`}
              >
                {tanque ? (
                  <div
                    draggable
                    onDragStart={() => setDragId(tanque.id)}
                    onDragEnd={() => setDragId(null)}
                    className={`flex h-full w-full cursor-grab flex-col items-center justify-center gap-0.5 rounded-md border p-2 shadow-sm transition-opacity duration-150 ${
                      tanque.activo
                        ? 'border-primary-dark bg-primary/30 text-primary-text'
                        : 'border-app-border bg-app-bg text-app-muted'
                    } ${dragId === tanque.id ? 'opacity-30' : 'opacity-100'}`}
                  >
                    <span className="text-lg">🛢️</span>
                    <span className="text-center font-medium leading-tight">{tanque.nombre}</span>
                    {!tanque.activo && <span className="text-[10px]">(inactivo)</span>}
                  </div>
                ) : (
                  '— vacío —'
                )}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
