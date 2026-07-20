// ─────────────────────────────────────────────────────────────────
// Copia los assets de Tesseract a public/tesseract/.
//
// Por defecto tesseract.js baja el worker, el core WASM y el modelo de
// idioma desde un CDN. Eso rompería el requisito de que el OCR funcione
// SIN INTERNET, así que se sirven desde nuestro propio origen y el
// service worker los precachea.
//
// Se ejecuta solo en `postinstall`: los archivos quedan en public/ y no
// se versionan (ver .gitignore).
// ─────────────────────────────────────────────────────────────────
import { createRequire } from 'node:module'
import { mkdir, copyFile, writeFile, access } from 'node:fs/promises'
import { dirname, join } from 'node:path'

const require = createRequire(import.meta.url)
const DEST = join(process.cwd(), 'public', 'tesseract')

// Modelo `fast` (~2 MB) en vez del estándar (~10 MB): solo leemos dígitos
// y un puñado de códigos en mayúsculas, no hace falta más precisión.
const TRAINEDDATA =
  'https://raw.githubusercontent.com/naptha/tessdata/gh-pages/4.0.0_fast/eng.traineddata.gz'

const existe = async p => access(p).then(() => true, () => false)

async function main() {
  await mkdir(DEST, { recursive: true })

  const worker = require.resolve('tesseract.js/dist/worker.min.js')
  await copyFile(worker, join(DEST, 'worker.min.js'))

  // Variantes LSTM: no usamos el motor legacy, así que basta con estas.
  // Hay que copiar LAS TRES: tesseract.js detecta en tiempo de ejecución
  // qué extensiones WASM soporta el navegador y pide `relaxedsimd`,
  // `simd` o la básica según el caso. Copiar solo algunas provoca un
  // "failed to load importScripts" en los navegadores que piden la que
  // falta (pasó con relaxedsimd en Chrome).
  const coreDir = dirname(require.resolve('tesseract.js-core/package.json'))
  for (const f of [
    'tesseract-core-lstm.wasm.js',
    'tesseract-core-lstm.wasm',
    'tesseract-core-simd-lstm.wasm.js',
    'tesseract-core-simd-lstm.wasm',
    'tesseract-core-relaxedsimd-lstm.wasm.js',
    'tesseract-core-relaxedsimd-lstm.wasm',
  ]) {
    await copyFile(join(coreDir, f), join(DEST, f))
  }

  const lang = join(DEST, 'eng.traineddata.gz')
  if (await existe(lang)) {
    console.log('[tesseract] modelo ya presente, no se vuelve a bajar')
  } else {
    console.log('[tesseract] bajando eng.traineddata.gz…')
    const res = await fetch(TRAINEDDATA)
    if (!res.ok) throw new Error(`descarga falló: HTTP ${res.status}`)
    await writeFile(lang, Buffer.from(await res.arrayBuffer()))
  }

  console.log('[tesseract] assets listos en public/tesseract/')
}

main().catch(err => {
  // No romper el install: la app funciona igual, solo que el OCR pedirá
  // los assets al CDN (y por tanto no andará sin internet).
  console.error('[tesseract] no se pudieron preparar los assets:', err.message)
  process.exitCode = 0
})
