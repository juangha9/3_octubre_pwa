// ─────────────────────────────────────────────────────────────────
// Preprocesado de la imagen antes del OCR.
//
// Los screenshots de la consola llegan a cualquier escala y con el marco
// de la ventana alrededor. Tesseract acierta mucho más si le damos la
// imagen a un tamaño cómodo y en blanco y negro puro, así que aquí se
// hace: escalar → escala de grises → binarizar (Otsu).
//
// Todo con <canvas>: sin OpenCV ni dependencias extra.
// ─────────────────────────────────────────────────────────────────

// Altura objetivo del texto para el OCR. Estos screenshots vienen chicos
// (~350 px de alto) y con 3x Tesseract todavía confundía dígitos —se vio
// leer 15,899.500 como 15,839.500—, así que se apunta más alto: cuantos
// más píxeles por glifo, menos ambigüedad entre 9/3, 5/S y 0/O.
const ALTO_OBJETIVO = 2600
const ESCALA_MAX = 6

export async function blobAImageData(blob: Blob): Promise<ImageData> {
  const bitmap = await createImageBitmap(blob)
  // Solo se amplía; reducir un screenshot ya pequeño perdería trazo.
  const escala = Math.max(1, Math.min(ESCALA_MAX, ALTO_OBJETIVO / bitmap.height))
  const w = Math.round(bitmap.width * escala)
  const h = Math.round(bitmap.height * escala)

  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(bitmap, 0, 0, w, h)
  bitmap.close()
  return ctx.getImageData(0, 0, w, h)
}

/**
 * Umbral de Otsu: parte el histograma en dos grupos (fondo y texto)
 * buscando el corte que maximiza la varianza entre ambos. Se calcula solo
 * porque la consola puede imprimir claro sobre oscuro o al revés.
 */
function umbralOtsu(grises: Uint8Array): number {
  const hist = new Array(256).fill(0)
  for (const g of grises) hist[g]++

  const total = grises.length
  let suma = 0
  for (let i = 0; i < 256; i++) suma += i * hist[i]

  let sumaB = 0
  let pesoB = 0
  let maxVar = -1
  let umbral = 128

  for (let t = 0; t < 256; t++) {
    pesoB += hist[t]
    if (pesoB === 0) continue
    const pesoF = total - pesoB
    if (pesoF === 0) break
    sumaB += t * hist[t]
    const mediaB = sumaB / pesoB
    const mediaF = (suma - sumaB) / pesoF
    const varEntre = pesoB * pesoF * (mediaB - mediaF) ** 2
    if (varEntre > maxVar) {
      maxVar = varEntre
      umbral = t
    }
  }
  return umbral
}

/**
 * Devuelve la imagen binarizada y, además, el mapa de bits "tinta"
 * (true = píxel de texto) que usa el detector de filas.
 *
 * Si el original era claro sobre oscuro, se invierte: Tesseract espera
 * texto oscuro sobre fondo claro.
 */
export function binarizar(img: ImageData): { canvas: HTMLCanvasElement; tinta: Uint8Array } {
  const { width, height, data } = img
  const grises = new Uint8Array(width * height)
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    // Luminancia perceptual (Rec. 601).
    grises[p] = (data[i] * 299 + data[i + 1] * 587 + data[i + 2] * 114) / 1000
  }

  const umbral = umbralOtsu(grises)

  // ¿Domina el claro o el oscuro? El fondo es siempre lo mayoritario.
  let oscuros = 0
  for (const g of grises) if (g <= umbral) oscuros++
  const fondoOscuro = oscuros > grises.length / 2

  const salida = new ImageData(width, height)
  const tinta = new Uint8Array(width * height)
  for (let p = 0, i = 0; p < grises.length; p++, i += 4) {
    const esOscuro = grises[p] <= umbral
    const esTinta = fondoOscuro ? !esOscuro : esOscuro
    const v = esTinta ? 0 : 255
    salida.data[i] = salida.data[i + 1] = salida.data[i + 2] = v
    salida.data[i + 3] = 255
    tinta[p] = esTinta ? 1 : 0
  }

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  canvas.getContext('2d')!.putImageData(salida, 0, 0)
  return { canvas, tinta }
}

/**
 * Copia reducida del canvas ya binarizado.
 *
 * La primera pasada del OCR solo necesita SABER DÓNDE están las palabras
 * (rótulos de fila y encabezados de columna), no leer cifras con
 * precisión. Y el tiempo de reconocimiento crece con el número de
 * píxeles, así que hacerla sobre una copia reducida es el ahorro más
 * grande disponible. Las cifras se siguen leyendo sobre el original.
 */
export function reducir(canvas: HTMLCanvasElement, factor: number): HTMLCanvasElement {
  const chico = document.createElement('canvas')
  chico.width = Math.max(1, Math.round(canvas.width * factor))
  chico.height = Math.max(1, Math.round(canvas.height * factor))
  const ctx = chico.getContext('2d')!
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(canvas, 0, 0, chico.width, chico.height)
  return chico
}

/**
 * Convierte a WebP para guardar y subir. Un screenshot de consola baja de
 * ~1 MB PNG a ~50–200 KB sin perder legibilidad.
 */
export async function aWebP(blob: Blob, calidad = 0.85): Promise<Blob> {
  const bitmap = await createImageBitmap(blob)
  const canvas = document.createElement('canvas')
  canvas.width = bitmap.width
  canvas.height = bitmap.height
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0)
  bitmap.close()
  const webp = await new Promise<Blob | null>(res =>
    canvas.toBlob(res, 'image/webp', calidad)
  )
  // Si el navegador no sabe codificar WebP, se guarda el original.
  return webp ?? blob
}
