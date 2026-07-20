// ─────────────────────────────────────────────────────────────────
// OCR local de los reportes de la consola (controlador de playa).
//
// Corre 100 % en el navegador con Tesseract, sin enviar la imagen a
// ningún servicio. Estrategia — la razón de que no haga falta entrenar
// un detector tipo YOLO:
//
//   1. La pantalla de la consola SIEMPRE es la misma. Lo único que
//      cambia entre screenshots es la escala y el marco alrededor.
//   2. Así que en vez de detectar objetos, se ANCLA por texto fijo: se
//      busca dónde cayeron los códigos de fila (DB5, G.PRE, G.REG, RSM,
//      o el nº de tanque). Esos rótulos son el "template".
//   3. Encontrada el ancla, los números de esa fila son simplemente lo
//      que está a su derecha, en orden. Al ser geometría RELATIVA al
//      ancla, da igual a qué tamaño se pegó la imagen.
//   4. Sobre cada fila ya ubicada se hace una segunda pasada con
//      whitelist numérica, que es donde Tesseract deja de confundir
//      dígitos con letras (5/S, 0/O, 1/l).
//
// El control de calidad final es aritmético, no estadístico: la fila RSM
// del reporte es la suma de las demás. Si Σ productos ≠ RSM, la lectura
// se marca dudosa y NO se autoconfirma.
// ─────────────────────────────────────────────────────────────────
import { createWorker, createScheduler, PSM, type Worker, type Scheduler } from 'tesseract.js'
import { blobAImageData, binarizar, reducir } from './imagen'

/**
 * Escala de la primera pasada respecto al canvas de detalle. A 0.4 el
 * reconocimiento maneja ~6 veces menos píxeles, y sigue sobrando para
 * localizar palabras (que es lo único que se le pide).
 */
const ESCALA_ANALISIS = 0.4
import type { DatosReporte, LineaProducto, LineaStock } from '@/lib/local/repo'
import type { ConsolaTipo } from '@/lib/local/db'

// ── Workers ──────────────────────────────────────────────────────
// Dos configuraciones distintas y por eso dos grupos:
//   · El PRINCIPAL hace la pasada 1 (localizar palabras, sin lista blanca).
//   · El POOL hace la pasada 2 (leer cifras, con lista blanca numérica).
// El pool va en paralelo porque la pasada 2 son ~12 recortes independientes
// —4 filas × 3 columnas— y ahí es donde se iba la mayor parte del tiempo.

const OPCIONES_WORKER = {
  // Assets propios: sin esto tesseract.js los pediría a un CDN y el OCR
  // no funcionaría sin internet (ver scripts/vendor-tesseract.mjs).
  workerPath: '/tesseract/worker.min.js',
  corePath: '/tesseract/',
  langPath: '/tesseract/',
  legacyCore: false,
  legacyLang: false,
}

/** Workers del pool. Más no ayuda: el equipo tiene los núcleos que tiene. */
const N_POOL = 3

let workerPromise: Promise<Worker> | null = null
let schedulerPromise: Promise<Scheduler> | null = null

function obtenerWorker(): Promise<Worker> {
  workerPromise ??= (async () => {
    const w = await createWorker('eng', 1, OPCIONES_WORKER)
    await w.setParameters({
      // SINGLE_BLOCK en vez de AUTO: nos ahorra el análisis de layout, que
      // es caro y aquí no aporta —la tabla se reconstruye por geometría.
      tessedit_pageseg_mode: PSM.SINGLE_BLOCK,
      preserve_interword_spaces: '1',
      // Sin DPI declarado Tesseract lo estima (y avisa en consola con
      // "Estimating resolution as …").
      user_defined_dpi: '300',
    })
    return w
  })()
  return workerPromise
}

function obtenerScheduler(): Promise<Scheduler> {
  schedulerPromise ??= (async () => {
    const s = createScheduler()
    // Se crean en paralelo: si no, se sumarían las cargas del modelo.
    const workers = await Promise.all(
      Array.from({ length: N_POOL }, async () => {
        const w = await createWorker('eng', 1, OPCIONES_WORKER)
        await w.setParameters({
          tessedit_pageseg_mode: PSM.SINGLE_LINE,
          tessedit_char_whitelist: '0123456789.,',
          user_defined_dpi: '300',
        })
        return w
      })
    )
    workers.forEach(w => s.addWorker(w))
    return s
  })()
  return schedulerPromise
}

/**
 * Arranca los workers en segundo plano (idempotente). Se llama al abrir la
 * pantalla: cargar el core WASM y el modelo tarda lo suyo, y hacerlo ahora
 * evita que ese coste se sume al primer Ctrl+V.
 */
export function precalentarOcr(): void {
  // Si falla, el primer pegado lo reintentará y ahí sí se reporta.
  void obtenerWorker().catch(() => {})
  void obtenerScheduler().catch(() => {})
}

/** Libera los workers (~15 MB cada uno) al salir de la pantalla. */
export async function liberarOcr(): Promise<void> {
  const w = workerPromise
  const s = schedulerPromise
  workerPromise = null
  schedulerPromise = null
  await Promise.allSettled([
    w?.then(x => x.terminate()),
    s?.then(x => x.terminate()),
  ])
}

// ── Instrumentación ──────────────────────────────────────────────
// Solo para consola del navegador: sirve para saber en qué fase se va el
// tiempo antes de optimizar a ciegas. NO se persiste en ningún lado.

interface Tiempos {
  preproceso: number
  pasada1: number
  pasada2: number
  total: number
  celdas: number
}

function reportarTiempos(t: Tiempos) {
  const ms = (n: number) => `${Math.round(n)} ms`
  console.info(
    `[ocr] total ${ms(t.total)} · preproceso ${ms(t.preproceso)} · ` +
      `localizar ${ms(t.pasada1)} · leer ${t.celdas} celdas ${ms(t.pasada2)}`
  )
}

// ── Utilidades de parseo ─────────────────────────────────────────

const aCentimos = (soles: number | null) =>
  soles === null ? null : Math.round(soles * 100)

/**
 * Los rótulos llegan con erratas típicas del OCR (G.PRE → 6.PRE, RSM →
 * R5M). Se normaliza a solo letras/dígitos y se comparan variantes.
 */
function normalizarRotulo(txt: string): string {
  return txt.toUpperCase().replace(/[^A-Z0-9]/g, '')
}

const PRODUCTOS: { claves: string[]; producto: LineaProducto['producto'] }[] = [
  { claves: ['DB5', 'DBS', 'D85'], producto: 'DB5' },
  { claves: ['GPRE', '6PRE', 'GPR3', 'GPRF'], producto: 'PREMIUM' },
  { claves: ['GREG', '6REG', 'GR3G', 'GREC'], producto: 'REGULAR' },
]
const CLAVES_RSM = ['RSM', 'R5M', 'RSH', 'PSM']

/**
 * Formato fijo de cada columna. Saberlo de antemano es lo que permite
 * ignorar por completo comas y puntos —ver `parseCelda`—, que es donde
 * el OCR se equivoca sin remedio: la coma de miles y el punto decimal se
 * distinguen por un puñado de píxeles.
 */
type Formato = 'entero' | 'decimal3'

/** Franja horizontal que ocupa una columna en la imagen. */
interface Columna {
  x0: number
  x1: number
}

// Encabezados de columna, en el orden en que los imprime la consola. Son
// la SEGUNDA ancla (la primera es el rótulo de fila): dan la posición
// horizontal de cada columna, y con ella se puede recortar celda por celda
// en vez de leer la fila entera de un tirón.
const CABECERAS: Record<ConsolaTipo, { claves: string[]; formato: Formato }[]> = {
  ventas_dia: [
    { claves: ['VENTAS'], formato: 'entero' },
    { claves: ['VOLUMEN', 'VOLUMEM'], formato: 'decimal3' },
    { claves: ['IMPORTE', 'IMPORIE'], formato: 'decimal3' },
  ],
  stock_dia: [
    { claves: ['INICIO', 'INICIQ'], formato: 'decimal3' },
    { claves: ['FINAL', 'FLNAL'], formato: 'decimal3' },
  ],
}

/**
 * Convierte el texto de una celda a número SIN mirar los separadores.
 *
 * Es la lección de leer `8,183.170` como `8.183.170` → 8.18: distinguir
 * la coma de miles del punto decimal es justo lo que el OCR no puede
 * hacer con fiabilidad. Pero no hace falta que lo haga: la consola imprime
 * cada columna con un formato fijo, así que basta con quedarse con los
 * dígitos y colocar la coma donde corresponde. `8183170` ÷ 1000 = 8183.170,
 * salga la coma como salga.
 */
function parseCelda(txt: string, formato: Formato): number | null {
  const digitos = txt.replace(/\D/g, '')
  if (digitos === '') return null
  const n = Number.parseInt(digitos, 10)
  if (!Number.isFinite(n)) return null
  return formato === 'decimal3' ? n / 1000 : n
}

// ── Periodo del reporte (encabezado) ─────────────────────────────

export interface PeriodoReporte {
  inicio: string | null
  fin: string | null
  solicitud: string | null
  /** Día al que corresponde el reporte, deducido del periodo. */
  fecha: string | null
}

/** `YYYY-MM-DD` en hora local (no UTC: `toISOString` correría el día). */
function aFechaLocal(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/**
 * Busca `Etiqueta: … dd/mm/aaaa hh:mm:ss` en el texto del encabezado.
 * Tolera lo que haya en medio (el día de la semana) y que el OCR pierda
 * algún carácter suelto.
 */
function fechaEtiquetada(texto: string, etiqueta: string): Date | null {
  const re = new RegExp(
    `${etiqueta}\\s*:?[^\\d]{0,20}(\\d{1,2})/(\\d{1,2})/(\\d{4})\\s+(\\d{1,2}):(\\d{2}):(\\d{2})`,
    'i'
  )
  const m = re.exec(texto)
  if (!m) return null
  const [, dia, mes, anio, hh, mm, ss] = m.map(Number)
  const d = new Date(anio, mes - 1, dia, hh, mm, ss)
  return Number.isNaN(d.getTime()) ? null : d
}

/**
 * Deduce a qué día pertenece el reporte a partir de su periodo.
 *
 * Un turno que cierra a las 23:58 del 17 es del 17; y uno que se alarga y
 * cierra a las 00:02 del 18 TAMBIÉN es del 17. Ambos casos salen de la
 * misma regla: tomar el cierre y restarle un margen. El margen absorbe los
 * relevos que se pasan de medianoche sin necesidad de casos especiales.
 */
const MARGEN_CIERRE_MS = 2 * 60 * 60 * 1000

export function periodoDelEncabezado(texto: string): PeriodoReporte {
  const inicio = fechaEtiquetada(texto, 'Inicio')
  const fin = fechaEtiquetada(texto, 'Final')
  const solicitud = fechaEtiquetada(texto, 'Solicitud')

  // Sin cierre legible se recurre al inicio, que para un turno que arranca
  // poco antes de medianoche ya apunta al día correcto sin restar nada.
  const base = fin ? new Date(fin.getTime() - MARGEN_CIERRE_MS) : inicio
  return {
    inicio: inicio?.toISOString() ?? null,
    fin: fin?.toISOString() ?? null,
    solicitud: solicitud?.toISOString() ?? null,
    fecha: base ? aFechaLocal(base) : null,
  }
}

// ── Agrupación de palabras en filas ──────────────────────────────

interface Palabra {
  texto: string
  x0: number
  y0: number
  x1: number
  y1: number
}

interface Fila {
  palabras: Palabra[]
  y0: number
  y1: number
}

/**
 * Tesseract ya entrega líneas, pero en tablas a veces parte una fila en
 * varias. Se reagrupa por solapamiento vertical, que es lo que de verdad
 * define "estar en la misma fila" de una tabla.
 */
function agruparEnFilas(palabras: Palabra[]): Fila[] {
  const orden = [...palabras].sort((a, b) => (a.y0 + a.y1) / 2 - (b.y0 + b.y1) / 2)
  const filas: Fila[] = []
  for (const p of orden) {
    const centro = (p.y0 + p.y1) / 2
    const actual = filas[filas.length - 1]
    // Dos palabras son de la misma fila si el centro de una cae dentro
    // del alto de la otra: tolera bases de texto ligeramente desalineadas.
    if (actual && centro >= actual.y0 && centro <= actual.y1) {
      actual.palabras.push(p)
      actual.y0 = Math.min(actual.y0, p.y0)
      actual.y1 = Math.max(actual.y1, p.y1)
    } else {
      filas.push({ palabras: [p], y0: p.y0, y1: p.y1 })
    }
  }
  for (const f of filas) f.palabras.sort((a, b) => a.x0 - b.x0)
  return filas
}

/**
 * Busca el rótulo con el que arranca una fila de datos.
 *
 * No basta con mirar la primera palabra: la consola dibuja un marcador
 * (`▶`) delante de la fila seleccionada y Tesseract lo reconoce como una
 * palabra más. Y no basta con saltar la primera no vacía: ese marcador
 * suele leerse como una letra suelta ("P", "»"), que pasaría por rótulo
 * y haría descartar la fila entera —con su importe— en silencio.
 *
 * Por eso se busca activamente una palabra que ENCAJE con lo esperado,
 * entre las tres primeras de la fila.
 */
function rotuloDeFila(
  fila: Fila,
  coincide: (clave: string) => boolean
): { palabra: Palabra; clave: string } | null {
  for (const palabra of fila.palabras.slice(0, 3)) {
    const clave = normalizarRotulo(palabra.texto)
    if (clave !== '' && coincide(clave)) return { palabra, clave }
  }
  return null
}

/** ¿Esta clave es un producto o la fila de total del reporte de ventas? */
const esRotuloVentas = (clave: string) =>
  PRODUCTOS.some(p => p.claves.includes(clave)) || CLAVES_RSM.includes(clave)

/** ¿Esta clave es un número de tanque del reporte de stock? */
const esRotuloTanque = (clave: string) => /^[123]$/.test(clave)

/**
 * Ubica las columnas a partir de la fila de encabezados.
 *
 * Las cifras van alineadas a la DERECHA, terminando más o menos donde
 * termina el encabezado de su columna. Así que cada columna va desde el
 * borde derecho del encabezado anterior hasta un pelo después del propio:
 * un corte limpio, porque el hueco entre columnas está vacío.
 *
 * Devuelve null si no se reconocen los encabezados; entonces se cae al
 * modo antiguo (leer la fila entera), que funciona pero acierta menos.
 */
function ubicarColumnas(filas: Fila[], tipo: ConsolaTipo): Columna[] | null {
  const esperados = CABECERAS[tipo]

  for (const fila of filas) {
    const encontrados: Palabra[] = []
    for (const col of esperados) {
      const p = fila.palabras.find(w => col.claves.includes(normalizarRotulo(w.texto)))
      if (!p) break
      encontrados.push(p)
    }
    if (encontrados.length !== esperados.length) continue
    // Deben aparecer de izquierda a derecha en el orden esperado; si no,
    // no es la fila de encabezados sino una coincidencia suelta.
    if (encontrados.some((h, i) => i > 0 && h.x0 <= encontrados[i - 1].x1)) continue

    // El borde izquierdo de la PRIMERA columna de datos es el encabezado
    // que la precede —"Producto" en ventas, "Producto" tras "Tanque" en
    // stock—, no la primera palabra de la fila: si no, el recorte se
    // tragaría la columna de descripción entera.
    const previa = fila.palabras
      .filter(w => w.x1 <= encontrados[0].x0)
      .reduce<Palabra | null>((mejor, w) => (!mejor || w.x1 > mejor.x1 ? w : mejor), null)

    // Margen a la derecha por si alguna cifra sobresale del encabezado.
    const margen = (fila.y1 - fila.y0) * 0.6
    return encontrados.map((h, i) => ({
      x0: i === 0 ? (previa?.x1 ?? fila.palabras[0].x1) : encontrados[i - 1].x1,
      x1: h.x1 + margen,
    }))
  }
  return null
}

// ── Lectura ──────────────────────────────────────────────────────

export interface ResultadoOcr extends DatosReporte {
  /** Cuál de los dos reportes resultó ser (se deduce del contenido). */
  tipo: ConsolaTipo
  /** Periodo que cubre el reporte, leído de su encabezado. */
  periodo: PeriodoReporte
  /** Texto completo reconocido: se guarda como respaldo auditable. */
  texto: string
  /** Motivo por el que la lectura no se puede dar por buena, si aplica. */
  advertencia: string | null
}

export interface ProgresoOcr {
  etapa: string
  progreso: number
}

/**
 * Decide qué reporte es sin preguntarle al usuario.
 *
 * Los dos se distinguen por cómo empieza cada fila: el de ventas abre con
 * el código del combustible (DB5 / G.PRE / G.REG) y cierra con RSM; el de
 * stock abre con el número de tanque (1, 2, 3) seguido de dos cifras. Esa
 * diferencia estructural es más fiable que buscar el título, que puede
 * salir mal leído o quedar fuera del recorte.
 */
function clasificar(
  filas: Fila[],
  texto: string,
  columnas: Record<ConsolaTipo, Columna[] | null>
): ConsolaTipo {
  // Los ENCABEZADOS son la única señal inequívoca. Ojo con la trampa: el
  // reporte de STOCK también lista DB5 / G.REG / G.PRE en su columna
  // Producto, así que buscar códigos de combustible da falso positivo de
  // "ventas" —fue justo lo que pasó—. `Ventas/Volumen/Importe` frente a
  // `Inicio/Final`, en cambio, no se solapan.
  if (columnas.ventas_dia && !columnas.stock_dia) return 'ventas_dia'
  if (columnas.stock_dia && !columnas.ventas_dia) return 'stock_dia'

  // Sin encabezados claros: la fila RSM solo existe en el de ventas.
  if (filas.some(f => rotuloDeFila(f, c => CLAVES_RSM.includes(c)))) return 'ventas_dia'

  // Último recurso: el título del reporte.
  return /\bSTOCK\b/i.test(texto) ? 'stock_dia' : 'ventas_dia'
}

/**
 * Lee un reporte de consola. Si no se fuerza `tipo`, se deduce del propio
 * contenido de la imagen.
 */
export async function leerReporte(
  blob: Blob,
  tipo?: ConsolaTipo,
  onProgreso?: (p: ProgresoOcr) => void
): Promise<ResultadoOcr> {
  const t0 = performance.now()
  onProgreso?.({ etapa: 'Preparando imagen', progreso: 0.1 })
  const img = await blobAImageData(blob)
  const { canvas } = binarizar(img)
  // La copia reducida se prepara aquí para que su coste cuente como
  // preprocesado y no ensucie la medición de la pasada 1.
  const canvasChico = reducir(canvas, ESCALA_ANALISIS)
  const t1 = performance.now()

  const worker = await obtenerWorker()
  onProgreso?.({ etapa: 'Reconociendo texto', progreso: 0.35 })

  // Pasada 1 — solo para UBICAR rótulos y encabezados, no para leer
  // cifras. Corre sobre la copia reducida porque el coste crece con los
  // píxeles, y luego las coordenadas se reescalan al original.
  const { data } = await worker.recognize(canvasChico, {}, { blocks: true, text: true })
  const t2 = performance.now()

  const k = 1 / ESCALA_ANALISIS
  const palabras: Palabra[] = []
  for (const bloque of data.blocks ?? []) {
    for (const parrafo of bloque.paragraphs) {
      for (const linea of parrafo.lines) {
        for (const w of linea.words) {
          palabras.push({
            texto: w.text,
            x0: w.bbox.x0 * k,
            y0: w.bbox.y0 * k,
            x1: w.bbox.x1 * k,
            y1: w.bbox.y1 * k,
          })
        }
      }
    }
  }

  const filas = agruparEnFilas(palabras)
  onProgreso?.({ etapa: 'Leyendo cifras', progreso: 0.65 })

  // Pasada 2 — solo dígitos, recorte por celda, repartida entre el pool.
  const scheduler = await obtenerScheduler()
  let celdasLeidas = 0

  const anchoImagen = canvas.width
  // Se buscan los dos juegos de encabezados: cuál aparezca es, además, lo
  // que decide de qué reporte se trata.
  const candidatas: Record<ConsolaTipo, Columna[] | null> = {
    ventas_dia: ubicarColumnas(filas, 'ventas_dia'),
    stock_dia: ubicarColumnas(filas, 'stock_dia'),
  }
  const tipoFinal = tipo ?? clasificar(filas, data.text ?? '', candidatas)
  const columnas = candidatas[tipoFinal]

  const formatos = CABECERAS[tipoFinal].map(c => c.formato)

  /** Lee un recorte y devuelve los tokens que contienen algún dígito. */
  async function leerTokens(rect: {
    left: number
    top: number
    width: number
    height: number
  }): Promise<string[]> {
    // Tesseract se queja ("Image too small to scale!!") y devuelve basura
    // con recortes de pocos píxeles. Mejor descartarlos aquí: esa celda
    // quedará como ilegible, que es la verdad, y la validación lo verá.
    if (rect.width < 8 || rect.height < 8) return []
    celdasLeidas++
    // Por el scheduler: se encola y lo atiende el primer worker libre.
    const r = await scheduler.addJob('recognize', canvas, { rectangle: rect }, { text: true })
    return r.data.text.split(/\s+/).filter(t => /\d/.test(t))
  }

  async function numerosDeFila(fila: Fila, desdeX: number): Promise<number[]> {
    const alto = fila.y1 - fila.y0
    // Aire vertical: sin él se cortan comas y puntos decimales.
    const margen = Math.round(alto * 0.35)
    const top = Math.max(0, fila.y0 - margen)
    const height = alto + margen * 2

    if (!columnas) {
      // Sin encabezados reconocidos: la fila entera de un tirón, y las
      // columnas se asignan por posición.
      const left = Math.max(0, Math.round(desdeX))
      const tokens = await leerTokens({ left, top, width: anchoImagen - left, height })
      return formatos.map((f, i) =>
        tokens[i] === undefined ? NaN : (parseCelda(tokens[i], f) ?? NaN)
      )
    }

    // Celda por celda. Cada recorte lleva UN solo número y ocupa toda la
    // ventana que ve Tesseract, que es donde deja de equivocarse. Las
    // celdas son independientes, así que van todas a la vez al pool.
    return Promise.all(
      columnas.map(async (col, i) => {
        const left = Math.max(0, Math.round(Math.max(col.x0, desdeX)))
        const width = Math.round(Math.min(col.x1, anchoImagen)) - left
        const tokens = await leerTokens({ left, top, width, height })
        // Si por el recorte se coló algo de la columna vecina, el bueno es
        // el último: las cifras están alineadas a la derecha.
        const token = tokens[tokens.length - 1]
        return token === undefined ? NaN : (parseCelda(token, formatos[i]) ?? NaN)
      })
    )
  }

  const resultado =
    tipoFinal === 'ventas_dia'
      ? await leerVentas(filas, numerosDeFila)
      : await leerStock(filas, numerosDeFila)

  const t3 = performance.now()
  reportarTiempos({
    preproceso: t1 - t0,
    pasada1: t2 - t1,
    pasada2: t3 - t2,
    total: t3 - t0,
    celdas: celdasLeidas,
  })

  onProgreso?.({ etapa: 'Listo', progreso: 1 })
  const texto = data.text ?? ''
  // Sale del texto que la pasada 1 ya reconoció: cero llamadas extra.
  return { ...resultado, tipo: tipoFinal, texto, periodo: periodoDelEncabezado(texto) }
}

type LectorNumeros = (fila: Fila, desdeX: number) => Promise<number[]>

/** Lo que devuelve cada parser: el resto lo pone quien orquesta. */
type LecturaParcial = Omit<ResultadoOcr, 'tipo' | 'texto' | 'periodo'>

/** Celda i de la fila, o null si esa celda no se pudo leer (NaN/ausente). */
const cifra = (nums: number[], i: number): number | null =>
  Number.isFinite(nums[i]) ? nums[i] : null

/** REPORTE PRODUCTO: filas por combustible + fila RSM (el total). */
async function leerVentas(filas: Fila[], numerosDeFila: LectorNumeros): Promise<LecturaParcial> {
  const productos: LineaProducto[] = []
  let rsm: { ventas: number | null; volumen: number | null; importe: number | null } | null = null

  // Primero se identifican TODAS las filas de interés y después se leen a
  // la vez: son independientes entre sí, y así el pool de workers trabaja
  // en paralelo en vez de quedarse esperando fila a fila.
  const objetivo = filas.flatMap(fila => {
    const enc = rotuloDeFila(fila, esRotuloVentas)
    if (!enc) return []
    const prod = PRODUCTOS.find(p => p.claves.includes(enc.clave))
    const esRsm = CLAVES_RSM.includes(enc.clave)
    if (!prod && !esRsm) return []
    return [{ fila, desdeX: enc.palabra.x1, prod, esRsm }]
  })

  const lecturas = await Promise.all(
    objetivo.map(async o => ({ ...o, nums: await numerosDeFila(o.fila, o.desdeX) }))
  )

  for (const { nums, prod, esRsm } of lecturas) {
    // Las tres cifras de la fila, en el orden que imprime la consola:
    // Ventas (entero) · Volumen (galones, 3 decimales) · Importe (S/).
    const [ventas, volumen, importe] = [cifra(nums, 0), cifra(nums, 1), cifra(nums, 2)]

    if (esRsm) {
      rsm = { ventas, volumen, importe }
    } else if (prod) {
      productos.push({
        producto: prod.producto,
        ventas: ventas === null ? null : Math.round(ventas),
        volumen_gl: volumen,
        importe_centimos: aCentimos(importe),
      })
    }
  }

  // Validación aritmética: la fila RSM debe ser la suma de las demás.
  let validacion_ok: boolean | null = null
  let advertencia: string | null = null

  if (!rsm || rsm.importe === null) {
    advertencia = 'No se encontró la fila de total (RSM) en la imagen.'
  } else if (productos.length === 0) {
    advertencia = 'No se reconoció ninguna fila de producto.'
  } else if (productos.some(p => p.importe_centimos === null)) {
    // Sin todas las líneas no se puede comprobar el total contra su suma,
    // y un total sin comprobar no puede hacer de auditor.
    validacion_ok = false
    advertencia =
      'No se pudo leer el importe de algún producto, así que el total no ' +
      'se pudo verificar contra la suma de las líneas.'
  } else {
    const sumaImporte = productos.reduce((a, p) => a + (p.importe_centimos ?? 0), 0)
    const totalImporte = aCentimos(rsm.importe)!
    // Tolerancia de 1 céntimo por producto: la consola redondea cada fila.
    validacion_ok = Math.abs(sumaImporte - totalImporte) <= productos.length
    if (!validacion_ok) {
      advertencia =
        'La suma de los productos no coincide con el total del reporte: ' +
        'revisa las cifras antes de confirmar.'
    }
  }

  return {
    ventas_total: rsm?.ventas === null || rsm?.ventas === undefined ? null : Math.round(rsm.ventas),
    volumen_total_gl: rsm?.volumen ?? null,
    importe_total_centimos: aCentimos(rsm?.importe ?? null),
    validacion_ok,
    fuente: 'ocr_local',
    productos,
    advertencia,
  }
}

/** REPORTE STOCK: una fila por tanque con Inicio/Final en galones. */
async function leerStock(filas: Fila[], numerosDeFila: LectorNumeros): Promise<LecturaParcial> {
  // La consola numera 1=DB5, 2=G.REG, 3=G.PRE.
  const PRODUCTO_POR_TANQUE: Record<number, string> = { 1: 'DB5', 2: 'REGULAR', 3: 'PREMIUM' }
  const stock: LineaStock[] = []

  // Igual que en ventas: se localizan las filas y se leen todas a la vez.
  const objetivo = filas.flatMap(fila => {
    // El ancla aquí es el número de tanque solo, al inicio de la fila.
    const enc = rotuloDeFila(fila, esRotuloTanque)
    return enc ? [{ fila, desdeX: enc.palabra.x1, clave: enc.clave }] : []
  })

  const lecturas = await Promise.all(
    objetivo.map(async o => ({ ...o, nums: await numerosDeFila(o.fila, o.desdeX) }))
  )

  for (const { nums, clave } of lecturas) {
    const inicio = cifra(nums, 0)
    const fin = cifra(nums, 1)
    if (inicio === null && fin === null) continue

    const tanque = Number(clave)
    stock.push({
      tanque_num: tanque,
      // El id real del tanque en la app lo resuelve quien guarda: aquí
      // solo sabemos el número que imprime la consola.
      tanque_id: null,
      producto: PRODUCTO_POR_TANQUE[tanque] ?? null,
      inicio_gl: inicio,
      final_gl: fin,
    })
  }

  return {
    ventas_total: null,
    volumen_total_gl: null,
    importe_total_centimos: null,
    validacion_ok: stock.length > 0 ? true : null,
    fuente: 'ocr_local',
    stock,
    advertencia:
      stock.length === 0 ? 'No se reconoció ninguna fila de tanque en la imagen.' : null,
  }
}
