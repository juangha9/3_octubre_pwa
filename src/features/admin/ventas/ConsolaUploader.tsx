// ─────────────────────────────────────────────────────────────────
// Carga de los reportes de consola del día (fase 3 + OCR local).
//
// Una sola zona de pegado: el usuario hace Ctrl+V y el sistema decide
// solo si lo pegado es el REPORTE PRODUCTO (de donde sale el TOTAL
// CONSOLA del día) o el REPORTE STOCK, mirando cómo empiezan las filas
// de la tabla. Se admite uno de cada tipo por día; repetir uno pregunta
// antes de reemplazarlo.
//
// Todo es local-first: la imagen se guarda en Dexie y se lee con OCR en
// el propio navegador. La subida a Storage y la escritura en Supabase
// van por el outbox, así que pegar sin internet funciona igual.
// ─────────────────────────────────────────────────────────────────
import { useCallback, useEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { formatSoles } from '@/lib/money'
import type { ConsolaTipo } from '@/lib/local/db'
import {
  guardarReporteConsola,
  leerReportesDia,
  eliminarReporteConsola,
  asegurarImagenLocal,
} from '@/lib/local/repo'
import {
  leerReporte,
  liberarOcr,
  precalentarOcr,
  type ProgresoOcr,
  type ResultadoOcr,
} from '@/lib/ocr/consola'
import { aWebP } from '@/lib/ocr/imagen'

const ROTULO: Record<ConsolaTipo, string> = {
  ventas_dia: 'Ventas',
  stock_dia: 'Stock',
}

/**
 * "2026-07-17" → "17/07/2026". A mano y no vía `Date`: `new Date('2026-07-17')`
 * se interpreta como medianoche UTC, y en Perú (UTC-5) mostraría el día
 * anterior — justo el error que este aviso existe para evitar.
 */
const formatDia = (iso: string) => iso.split('-').reverse().join('/')

interface Props {
  fecha: string
  /** Cambia el día abierto en Ventas (al aceptar la fecha del reporte). */
  onIrAFecha?: (fecha: string) => void
}

/** Tarjeta con título: la que vive en la columna de Registro Rápido. */
export default function ConsolaUploader({ fecha, onIrAFecha }: Props) {
  return (
    <div className="card space-y-3">
      <h3 className="border-b border-app-border pb-1.5 text-sm font-bold text-app-text">
        Reportes de Consola
      </h3>
      <ConsolaPanel fecha={fecha} onIrAFecha={onIrAFecha} />
    </div>
  )
}

/**
 * El panel en sí (zona de pegado + estado), sin envoltorio. Se usa suelto
 * dentro del modal que abre la celda Σ de la tabla de turnos, para que la
 * carga esté disponible también en modo COMPLETO.
 */
export function ConsolaPanel({ fecha, onIrAFecha }: Props) {
  const [procesando, setProcesando] = useState(false)
  const [progreso, setProgreso] = useState<ProgresoOcr | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [arrastrando, setArrastrando] = useState(false)
  const contenedor = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLInputElement>(null)

  // Lectura hecha que espera confirmación para pisar la que ya existe.
  const [porConfirmar, setPorConfirmar] = useState<
    { webp: Blob; datos: ResultadoOcr; dia: string } | null
  >(null)
  // Lectura cuya fecha no coincide con el día abierto.
  const [porFecha, setPorFecha] = useState<
    { webp: Blob; datos: ResultadoOcr; sugerida: string } | null
  >(null)
  // Imagen abierta a tamaño completo. Se guarda el BLOB, no la URL de la
  // miniatura: esa se revoca cada vez que useLiveQuery refresca, y la
  // ampliada se rompería sola al guardar cualquier otra cosa del día.
  const [ampliada, setAmpliada] = useState<Blob | null>(null)
  const [ampliadaUrl, setAmpliadaUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!ampliada) {
      setAmpliadaUrl(null)
      return
    }
    const u = URL.createObjectURL(ampliada)
    setAmpliadaUrl(u)
    return () => URL.revokeObjectURL(u)
  }, [ampliada])
  /** Reporte cuyo borrado espera confirmación. */
  const [porEliminar, setPorEliminar] = useState<ConsolaTipo | null>(null)

  const reportes = useLiveQuery(() => leerReportesDia(fecha), [fecha])

  // Imágenes pegadas en OTRA máquina: la fila se sincroniza pero el blob vive
  // en el Dexie de aquella. Si falta la miniatura y hay ruta en Storage, se
  // baja y se cachea (el useLiveQuery de arriba la mostrará al cachearse).
  useEffect(() => {
    if (!reportes) return
    for (const tipo of ['ventas_dia', 'stock_dia'] as ConsolaTipo[]) {
      const r = reportes[tipo]
      if (r && !r.blob && r.imagen_path) void asegurarImagenLocal(fecha, tipo, r.imagen_path)
    }
  }, [reportes, fecha])

  // Cargar el core WASM y el modelo tarda; hacerlo al abrir la pantalla
  // evita que ese coste caiga sobre el primer Ctrl+V. Al salir se suelta,
  // que son ~15 MB.
  useEffect(() => {
    precalentarOcr()
    return () => void liberarOcr()
  }, [])

  const guardar = useCallback(
    async (webp: Blob, datos: ResultadoOcr, dia: string) => {
      await guardarReporteConsola(dia, datos.tipo, webp, {
        ...datos,
        extraido: { texto: datos.texto, productos: datos.productos, stock: datos.stock },
      })
      setError(datos.advertencia)
      if (dia !== fecha) onIrAFecha?.(dia)
    },
    [fecha, onIrAFecha]
  )

  /** Guarda en `dia`, preguntando antes si ya hay un reporte de ese tipo. */
  const intentarGuardar = useCallback(
    async (webp: Blob, datos: ResultadoOcr, dia: string) => {
      const ya = await leerReportesDia(dia)
      if (ya[datos.tipo]) {
        setPorConfirmar({ webp, datos, dia })
        return
      }
      await guardar(webp, datos, dia)
    },
    [guardar]
  )

  const procesar = useCallback(
    async (archivo: Blob) => {
      setError(null)
      setProcesando(true)
      setProgreso({ etapa: 'Preparando imagen', progreso: 0.05 })
      try {
        // WebP primero: es lo que se guarda y se sube (~50–200 KB), y es
        // también lo que lee el OCR, para que lo leído sea exactamente lo
        // archivado.
        const webp = await aWebP(archivo)
        // Sin forzar tipo: lo deduce del contenido de la imagen.
        const datos = await leerReporte(webp, undefined, setProgreso)

        // El reporte dice a qué día pertenece. Si no es el que está
        // abierto, decide el usuario: puede que se haya pegado la imagen
        // equivocada, o que el OCR leyera mal la fecha. Se guarda lo que
        // eligió y queda el rastro de la discrepancia.
        const dia = datos.periodo.fecha
        if (dia && dia !== fecha) {
          setPorFecha({ webp, datos, sugerida: dia })
          return
        }
        await intentarGuardar(webp, datos, fecha)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'No se pudo leer la imagen.')
      } finally {
        setProcesando(false)
        setProgreso(null)
      }
    },
    [fecha, intentarGuardar]
  )

  // Ctrl+V en cualquier parte de la tarjeta (o con el foco fuera de un input).
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (!contenedor.current) return
      const dentro = contenedor.current.contains(document.activeElement)
      const enBody = document.activeElement === document.body
      if (!dentro && !enBody) return

      const item = Array.from(e.clipboardData?.items ?? []).find(i =>
        i.type.startsWith('image/')
      )
      if (!item) return
      const archivo = item.getAsFile()
      if (!archivo) return
      e.preventDefault()
      void procesar(archivo)
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [procesar])

  return (
    <div className="space-y-3" ref={contenedor} tabIndex={-1}>
      <div
        className={`flex h-20 cursor-pointer flex-col items-center justify-center rounded border-2 border-dashed text-xs transition-colors ${
          arrastrando ? 'border-blue-500 bg-blue-50/50' : 'border-app-border hover:border-blue-400'
        }`}
        onClick={() => !procesando && input.current?.click()}
        onDragOver={e => {
          e.preventDefault()
          setArrastrando(true)
        }}
        onDragLeave={() => setArrastrando(false)}
        onDrop={e => {
          e.preventDefault()
          setArrastrando(false)
          const f = Array.from(e.dataTransfer.files).find(x => x.type.startsWith('image/'))
          if (f) void procesar(f)
        }}
      >
        {procesando ? (
          <>
            <span className="mb-1.5 text-app-muted">{progreso?.etapa ?? 'Leyendo…'}</span>
            <div className="h-1 w-32 overflow-hidden rounded bg-app-border">
              <div
                className="h-full bg-blue-500 transition-all"
                style={{ width: `${Math.round((progreso?.progreso ?? 0) * 100)}%` }}
              />
            </div>
          </>
        ) : (
          <>
            <span className="font-semibold text-app-text">
              <kbd className="font-mono">Ctrl+V</kbd> para pegar
            </span>
            <span className="mt-0.5 text-[11px] text-app-muted">
              se reconoce solo si es ventas o stock
            </span>
          </>
        )}
      </div>

      <div className="space-y-1">
        {(['ventas_dia', 'stock_dia'] as ConsolaTipo[]).map(tipo => (
          <Estado
            key={tipo}
            tipo={tipo}
            reporte={reportes?.[tipo] ?? null}
            onAmpliar={setAmpliada}
            onEliminar={() => setPorEliminar(tipo)}
          />
        ))}
      </div>

      {error && (
        <div className="alert-warning !px-2 !py-1.5 !text-[11px]">
          {error}
        </div>
      )}

      <input
        ref={input}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={e => {
          const f = e.target.files?.[0]
          if (f) void procesar(f)
          e.target.value = ''
        }}
      />

      {porFecha && (
        <div className="modal-overlay" onClick={() => setPorFecha(null)}>
          <div className="modal-box !max-w-md p-4" onClick={e => e.stopPropagation()}>
            <h3 className="mb-2 text-sm font-bold text-app-text">
              La fecha del reporte no coincide
            </h3>
            <p className="mb-2 text-xs text-app-muted">
              El encabezado dice que este reporte cubre el{' '}
              <strong className="text-app-text">{formatDia(porFecha.sugerida)}</strong>, pero
              tienes abierto el <strong className="text-app-text">{formatDia(fecha)}</strong>.
            </p>
            {porFecha.datos.periodo.fin && (
              <p className="mb-2 font-mono text-[11px] text-app-muted">
                Cierre del periodo: {new Date(porFecha.datos.periodo.fin).toLocaleString('es-PE')}
              </p>
            )}
            {/* El dato de la discrepancia se guarda igual (`fecha_detectada`
                frente a `fecha`), pero eso es asunto interno: al usuario solo
                se le dice lo que necesita para decidir. */}
            <p className="alert-warning mb-3">
              Si la fecha del reporte está mal leída, guárdalo en el día abierto.
            </p>
            <div className="flex flex-wrap justify-end gap-2">
              <button className="btn-ghost h-8 px-3 text-xs" onClick={() => setPorFecha(null)}>
                Cancelar
              </button>
              <button
                className="btn-ghost h-8 px-3 text-xs"
                onClick={() => {
                  const p = porFecha
                  setPorFecha(null)
                  void intentarGuardar(p.webp, p.datos, fecha)
                }}
              >
                Guardar en el {formatDia(fecha)}
              </button>
              <button
                className="btn-primary h-8 px-3 text-xs"
                onClick={() => {
                  const p = porFecha
                  setPorFecha(null)
                  void intentarGuardar(p.webp, p.datos, p.sugerida)
                }}
              >
                Ir al {formatDia(porFecha.sugerida)}
              </button>
            </div>
          </div>
        </div>
      )}

      {ampliadaUrl && (
        <div className="modal-overlay" onClick={() => setAmpliada(null)}>
          <img
            src={ampliadaUrl}
            alt="Reporte de consola"
            className="max-h-[90vh] max-w-[90vw] rounded-lg border border-app-border shadow-xl"
            onClick={e => e.stopPropagation()}
          />
        </div>
      )}

      {porEliminar && (
        <div className="modal-overlay" onClick={() => setPorEliminar(null)}>
          <div className="modal-box !max-w-sm p-4" onClick={e => e.stopPropagation()}>
            <h3 className="mb-2 text-sm font-bold text-app-text">
              Eliminar el reporte de {ROTULO[porEliminar].toLowerCase()}
            </h3>
            <p className="mb-3 text-xs text-app-muted">
              {porEliminar === 'ventas_dia'
                ? 'La fila Σ se quedará sin total de consola y no habrá contra qué contrastar los turnos.'
                : 'Se quitará la imagen de stock de este día.'}{' '}
              Podrás volver a cargarlo cuando quieras.
            </p>
            <div className="flex justify-end gap-2">
              <button className="btn-ghost h-8 px-3 text-xs" onClick={() => setPorEliminar(null)}>
                Cancelar
              </button>
              <button
                className="btn bg-red-600 text-white hover:bg-red-700 h-8 px-3 text-xs"
                onClick={() => {
                  const t = porEliminar
                  setPorEliminar(null)
                  setError(null)
                  void eliminarReporteConsola(fecha, t)
                }}
              >
                Eliminar
              </button>
            </div>
          </div>
        </div>
      )}

      {porConfirmar && (
        <div className="modal-overlay" onClick={() => setPorConfirmar(null)}>
          <div className="modal-box !max-w-sm p-4" onClick={e => e.stopPropagation()}>
            <h3 className="mb-2 text-sm font-bold text-app-text">Ya hay un reporte cargado</h3>
            <p className="mb-1 text-xs text-app-muted">
              Esta imagen se reconoció como el reporte de{' '}
              <strong className="text-app-text">
                {ROTULO[porConfirmar.datos.tipo].toLowerCase()}
              </strong>
              , y ya hay uno para el {formatDia(porConfirmar.dia)}.
            </p>
            {porConfirmar.datos.tipo === 'ventas_dia' &&
              porConfirmar.datos.importe_total_centimos !== null && (
                <p className="mb-3 text-xs text-app-muted">
                  El nuevo marca{' '}
                  <span className="font-mono font-bold text-app-text">
                    {formatSoles(porConfirmar.datos.importe_total_centimos)}
                  </span>
                  .
                </p>
              )}
            <div className="flex justify-end gap-2">
              <button className="btn-ghost h-8 px-3 text-xs" onClick={() => setPorConfirmar(null)}>
                Cancelar
              </button>
              <button
                className="btn-primary h-8 px-3 text-xs"
                onClick={() => {
                  const p = porConfirmar
                  setPorConfirmar(null)
                  void guardar(p.webp, p.datos, p.dia)
                }}
              >
                Reemplazar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Una línea de estado por tipo de reporte ──────────────────────

interface EstadoProps {
  tipo: ConsolaTipo
  reporte:
    | {
        blob: Blob | null
        importe_total_centimos: number | null
        validacion_ok: boolean | null
        extraido: Record<string, unknown> | null
      }
    | null
  onAmpliar: (blob: Blob) => void
  onEliminar: () => void
}

/** Líneas por producto tal como las leyó el OCR (viven en `extraido`). */
interface LineaLeida {
  producto?: string
  importe_centimos?: number | null
}

function Estado({ tipo, reporte, onAmpliar, onEliminar }: EstadoProps) {
  const [url, setUrl] = useState<string | null>(null)

  // Miniatura desde el blob local: se ve aunque no haya internet.
  useEffect(() => {
    if (!reporte?.blob) {
      setUrl(null)
      return
    }
    const u = URL.createObjectURL(reporte.blob)
    setUrl(u)
    return () => URL.revokeObjectURL(u)
  }, [reporte?.blob])

  const dudoso = reporte?.validacion_ok === false

  // Si el OCR dice que no cuadra, tiene que enseñar POR QUÉ: se listan las
  // líneas que leyó y su suma frente al total. Sin esto el aviso solo
  // genera desconfianza —el usuario ve un total correcto y una alarma— y
  // encima no hay forma de saber qué celda se leyó mal.
  const lineas = dudoso
    ? ((reporte?.extraido?.productos as LineaLeida[] | undefined) ?? [])
    : []
  const sumaLineas = lineas.reduce((a, l) => a + (l.importe_centimos ?? 0), 0)

  return (
    <>
    <div className="flex items-center gap-2 rounded border border-app-border px-2 py-1">
      {url ? (
        // `group` + `object-top`: la miniatura muestra la cabecera del
        // reporte, que es la parte por la que se reconoce de un vistazo.
        <div className="group relative h-12 w-12 shrink-0">
          <button
            type="button"
            title="Ver la imagen completa"
            onClick={() => reporte?.blob && onAmpliar(reporte.blob)}
            className="h-full w-full overflow-hidden rounded border border-app-border"
          >
            <img src={url} alt="" className="h-full w-full object-cover object-top" />
          </button>
          <button
            type="button"
            title="Eliminar este reporte"
            onClick={onEliminar}
            className="absolute -right-1.5 -top-1.5 hidden h-4 w-4 items-center justify-center rounded-full bg-red-600 text-[10px] font-bold leading-none text-white shadow group-hover:flex hover:bg-red-700"
          >
            ✕
          </button>
        </div>
      ) : (
        <div className="h-12 w-12 shrink-0 rounded border border-dashed border-app-border" />
      )}
      <span className="text-xs font-semibold text-app-text">{ROTULO[tipo]}</span>

      <span className="ml-auto flex items-center gap-1.5 text-[11px]">
        {!reporte ? (
          <span className="text-app-muted">pendiente</span>
        ) : (
          <>
            {tipo === 'ventas_dia' && reporte.importe_total_centimos !== null && (
              <span className="font-mono font-bold text-app-text">
                {formatSoles(reporte.importe_total_centimos)}
              </span>
            )}
            {dudoso ? (
              <span title="Las cifras del reporte no cuadran entre sí" className="text-amber-600">
                ⚠
              </span>
            ) : (
              <span title="Lectura validada" className="text-green-700">
                ✓
              </span>
            )}
          </>
        )}
      </span>
    </div>

    {lineas.length > 0 && (
      <div className="rounded border border-app-border px-2 py-1 text-[11px]">
        <div className="mb-0.5 text-app-muted">Lo que leyó el OCR:</div>
        {lineas.map((l, i) => (
          <div key={i} className="flex justify-between font-mono">
            <span className="text-app-muted">{l.producto ?? '?'}</span>
            <span>
              {l.importe_centimos == null ? '— ilegible' : formatSoles(l.importe_centimos)}
            </span>
          </div>
        ))}
        <div className="mt-0.5 flex justify-between border-t border-app-border pt-0.5 font-mono font-bold text-amber-600">
          <span>suma</span>
          <span>{formatSoles(sumaLineas)}</span>
        </div>
        <div className="flex justify-between font-mono text-app-muted">
          <span>total del reporte</span>
          <span>{formatSoles(reporte?.importe_total_centimos ?? 0)}</span>
        </div>
      </div>
    )}
    </>
  )
}
