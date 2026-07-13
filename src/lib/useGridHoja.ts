import { useCallback, useEffect, useRef, useState } from 'react'
import type { Caret } from '@/components/CeldaGrid'
import { esTeclaNumerica, sanearNumero } from '@/lib/numero'

export interface Celda { f: number; c: number }

/**
 * Configuración de un grid tipo hoja de cálculo. El hook solo sabe de
 * coordenadas: qué hay dentro de cada celda (y cómo se guarda) lo resuelve la
 * página a través de estos callbacks.
 */
export interface ConfigGrid {
  /** Última fila navegable (inclusive); la primera siempre es 0. -1 = tabla vacía. */
  filaMax: number
  colMin: number
  colMax: number
  /** El grid está a la vista. Si no, no se le roba el foco al usuario. */
  visible: boolean

  /** ¿La celda se puede abrir para editar? Las demás solo se seleccionan y copian. */
  editable: (f: number, c: number) => boolean
  /** Celda de escritura libre: admite teclear encima, pegar y vaciar con Supr. */
  texto: (f: number, c: number) => boolean
  /** Celda numérica: se filtra lo que se teclea y lo que se pega (nada de `e`, `+ - * /`). */
  numero?: (f: number, c: number) => boolean
  /** Celda numérica que sí admite signo negativo (p. ej. REDONDEO). */
  negativo?: (f: number, c: number) => boolean

  /** Valor actual del buffer editable. */
  valor: (f: number, c: number) => string
  /** Escribe en el buffer editable (sin persistir). */
  aplicar: (f: number, c: number, v: string) => void
  /** Persiste el valor de la celda. */
  guardar: (f: number, c: number, v: string) => void
  /** Devuelve el buffer al valor almacenado (Escape). */
  revertir: (f: number, c: number) => void
  /** Ctrl+Z. */
  deshacer?: () => void

  /**
   * Editor que se gobierna solo: coloca su foco, consume sus teclas y persiste
   * por su cuenta (el Combobox, vía `onCommit`). Recibe como `semilla` la 1ª
   * tecla que se pulsó sobre la celda, que si no se perdería al montarse.
   */
  editorAutonomo?: (c: number) => boolean
  /** Editor que usa ↑/↓ para lo suyo (selects, combobox) en vez de cambiar de fila. */
  flechasPropias?: (c: number) => boolean
  /** Resuelve la celda con una sola tecla, sin abrir el editor (selects). */
  teclaDirecta?: (c: number, k: string) => string | null
  /** Enter sobre una celda ya confirmada (p. ej. dar de alta la fila de entrada). */
  onEnter?: (f: number, c: number) => void
  /** El grid toma el foco: sirve para que otro grid de la misma página suelte el suyo. */
  alSeleccionar?: () => void
}

export interface GridHoja {
  sel: Celda | null
  editando: boolean
  caret: Caret
  /** 1ª tecla pulsada sobre una celda con editor autónomo (Combobox). */
  semilla: string
  esActiva: (f: number, c: number) => boolean
  esTabbable: (f: number, c: number) => boolean
  esCopiada: (f: number, c: number) => boolean
  seleccionar: (f: number, c: number) => void
  editarCelda: (f: number, c: number, caret?: Caret) => void
  /** Cierra el editor de la celda activa. Para los editores autónomos, que
      confirman por su cuenta y luego deben devolver el foco a la celda. */
  terminarEdicion: (guardar?: boolean) => void
  /** Suelta la selección (confirmando lo que estuviera en edición). */
  limpiarSeleccion: () => void
  /** Olvida selección, edición y portapapeles (p. ej. al cambiar de día). */
  reiniciar: () => void
  contiene: (n: Node | null) => boolean
  /** Se derraman sobre el <table>. */
  props: {
    ref: React.RefObject<HTMLTableElement>
    onKeyDown: (e: React.KeyboardEvent) => void
    onCopy: (e: React.ClipboardEvent) => void
    onPaste: (e: React.ClipboardEvent) => void
  }
}

/**
 * Navegación tipo hoja de cálculo sobre una tabla de `<CeldaGrid>`.
 *
 * Un clic selecciona la celda (sin abrirla, para poder copiarla); Enter, F2 o
 * doble clic la abren; teclear encima reemplaza su contenido. Las flechas
 * mueven la selección — nunca tocan el valor de una casilla numérica.
 *
 * El `<td>` es lo enfocable mientras no se edita: así las flechas y Ctrl+C/V
 * llegan al manejador de la tabla en vez de perderse dentro de un input.
 */
export function useGridHoja(cfg: ConfigGrid): GridHoja {
  // El config se rehace en cada render; leerlo por ref evita que los manejadores
  // que sobreviven al render (listeners de `document`) trabajen con datos viejos.
  const cfgRef = useRef(cfg)
  cfgRef.current = cfg

  const ref = useRef<HTMLTableElement>(null)
  const [sel, setSel] = useState<Celda | null>(null)
  const [editando, setEditando] = useState(false)
  const [caret, setCaret] = useState<Caret>('todo')
  const [semilla, setSemilla] = useState('')
  // Celda cuyo contenido está en el portapapeles (borde animado, como Excel).
  const [copiada, setCopiada] = useState<Celda | null>(null)

  // Guard síncrono: `editando` viaja por setState y no frena un segundo intento
  // de cerrar la edición dentro del mismo evento (clic en otro grid: primero lo
  // cierra el que toma el foco y después el listener de `document`).
  const editandoRef = useRef(false)

  const esActiva = (f: number, c: number) => !!sel && sel.f === f && sel.c === c
  // Roving tabindex: una sola celda entra en el orden de tabulación. Sin
  // selección todavía, es la primera, para poder llegar al grid con Tab.
  const esTabbable = (f: number, c: number) =>
    sel ? esActiva(f, c) : f === 0 && c === cfg.colMin
  const esCopiada = (f: number, c: number) => !!copiada && copiada.f === f && copiada.c === c

  /** Texto de una celda; es lo que se lleva Ctrl+C. */
  function textoCelda({ f, c }: Celda): string {
    const el = ref.current?.querySelector(`[data-celda="${f}-${c}"]`)
    if (!el) return ''
    return (el.getAttribute('data-copia') ?? el.textContent ?? '').trim()
  }

  function salirEdicion(guardar: boolean) {
    if (!editandoRef.current || !sel) {
      editandoRef.current = false
      setEditando(false)
      return
    }
    editandoRef.current = false
    setEditando(false)
    setSemilla('')

    const { f, c } = sel
    const g = cfgRef.current

    // El editor autónomo persiste por su cuenta, así que guardar aquí duplicaría
    // el UPDATE. Pero hay que provocarle el blur ANTES de desmontarlo: React no
    // emite blur al quitar del DOM un nodo enfocado, y lo tecleado se perdería.
    if (g.editorAutonomo?.(c)) {
      const activo = document.activeElement
      if (activo instanceof HTMLElement && ref.current?.contains(activo)) activo.blur()
      if (!guardar) g.revertir(f, c)
      return
    }

    if (!guardar) { g.revertir(f, c); return }
    g.guardar(f, c, g.valor(f, c))
  }

  // Los listeners de `document` y `limpiarSeleccion` necesitan la versión de
  // `salirEdicion` de este render (la que ve el `sel` y el config actuales).
  const salirRef = useRef(salirEdicion)
  salirRef.current = salirEdicion

  function editarCelda(f: number, c: number, caretInicial: Caret = 'todo', semillaInicial = '') {
    const g = cfgRef.current
    if (!g.editable(f, c)) return
    g.alSeleccionar?.()
    setSel({ f, c })
    setCaret(g.editorAutonomo?.(c) ? 'ninguno' : caretInicial)
    setSemilla(semillaInicial)
    editandoRef.current = true
    setEditando(true)
  }

  function seleccionar(f: number, c: number) {
    if (editandoRef.current && sel) {
      if (sel.f === f && sel.c === c) return // clic dentro de la celda en edición
      salirEdicion(true)
    }
    cfgRef.current.alSeleccionar?.()
    setSel({ f, c })
  }

  const limpiarSeleccion = useCallback(() => {
    salirRef.current(true)
    setSel(null)
  }, [])

  const reiniciar = useCallback(() => {
    editandoRef.current = false
    setEditando(false)
    setSel(null)
    setCopiada(null)
    setSemilla('')
  }, [])

  function mover(df: number, dc: number) {
    const g = cfgRef.current
    if (g.filaMax < 0) return
    setSel(prev => {
      const base = prev ?? { f: 0, c: g.colMin }
      return {
        f: Math.min(Math.max(base.f + df, 0), g.filaMax),
        c: Math.min(Math.max(base.c + dc, g.colMin), g.colMax),
      }
    })
  }

  /** En los extremos del grid se deja pasar el Tab para poder salir de la tabla. */
  function tabSaleDelGrid(c: number, shift: boolean): boolean {
    const destino = c + (shift ? -1 : 1)
    return destino < cfg.colMin || destino > cfg.colMax
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (!sel) return
    const g = cfgRef.current
    const { f, c } = sel

    if (editando) {
      if (e.key === 'Escape') { e.preventDefault(); salirEdicion(false) }
      else if (e.key === 'Enter') {
        e.preventDefault()
        salirEdicion(true)
        g.onEnter?.(f, c)
        mover(1, 0)
      }
      else if (e.key === 'Tab') {
        salirEdicion(true)
        if (tabSaleDelGrid(c, e.shiftKey)) return
        e.preventDefault()
        mover(0, e.shiftKey ? -1 : 1)
      }
      else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        // En los editores que las usan (combobox, selects) las flechas recorren
        // el menú. En el resto confirman y cambian de fila; en los <input> de
        // tipo number eso impide además que la flecha altere el valor.
        if (g.flechasPropias?.(c)) return
        e.preventDefault()
        salirEdicion(true)
        mover(e.key === 'ArrowUp' ? -1 : 1, 0)
      }
      // Izquierda/derecha mueven el cursor dentro del texto, como en Sheets.
      return
    }

    const k = e.key
    if (k === 'ArrowUp') { e.preventDefault(); mover(-1, 0) }
    else if (k === 'ArrowDown') { e.preventDefault(); mover(1, 0) }
    else if (k === 'ArrowLeft') { e.preventDefault(); mover(0, -1) }
    else if (k === 'ArrowRight') { e.preventDefault(); mover(0, 1) }
    else if (k === 'Tab') {
      if (tabSaleDelGrid(c, e.shiftKey)) return
      e.preventDefault()
      mover(0, e.shiftKey ? -1 : 1)
    }
    else if (k === 'Escape') { setCopiada(null) } // apaga las hormigas, como en Excel
    else if (k === 'Enter' || k === 'F2') { e.preventDefault(); editarCelda(f, c) }
    else if (e.ctrlKey || e.metaKey) {
      const tecla = k.toLowerCase()
      if (tecla === 'z') { e.preventDefault(); g.deshacer?.() }
      // Con `clipboard` disponible (contexto seguro) copiamos aquí; si no, se deja
      // pasar y lo recoge `onCopy`. El pegado siempre va por `onPaste`.
      else if (tecla === 'c') {
        setCopiada({ f, c })
        if (navigator.clipboard?.writeText) {
          e.preventDefault()
          navigator.clipboard.writeText(textoCelda(sel)).catch(() => {})
        }
      }
    }
    else if (e.altKey) return
    else if (k === 'Delete' || k === 'Backspace') {
      if (!g.texto(f, c) || !g.editable(f, c)) return
      e.preventDefault()
      g.aplicar(f, c, '')
      g.guardar(f, c, '')
    }
    else if (k.length === 1) {
      if (!g.editable(f, c)) return
      // En una casilla numérica, una tecla que no puede formar un número (`e`,
      // `+`, `*`…) no abre nada: se descarta, como en una hoja de cálculo.
      if (g.numero?.(f, c) && !esTeclaNumerica(k, g.negativo?.(f, c))) {
        e.preventDefault()
        return
      }
      e.preventDefault()
      // El editor autónomo (Combobox) se monta ya con la tecla dentro: si no, se
      // perdería la 1ª letra mientras el input aparece y toma el foco.
      if (g.editorAutonomo?.(c)) { editarCelda(f, c, 'fin', k); return }
      // Teclear sobre una celda reemplaza su contenido, como en una hoja de cálculo.
      if (g.texto(f, c)) {
        g.aplicar(f, c, k)
        editarCelda(f, c, 'fin')
        return
      }
      // Los selects se resuelven con la propia tecla (1..4 / R, P, D) y se guardan
      // al vuelo, sin llegar a abrirse.
      const directo = g.teclaDirecta?.(c, k) ?? null
      if (directo) {
        g.aplicar(f, c, directo)
        g.guardar(f, c, directo)
        return
      }
      editarCelda(f, c)
    }
  }

  function onCopy(e: React.ClipboardEvent) {
    if (!sel || editando) return
    e.clipboardData.setData('text/plain', textoCelda(sel))
    setCopiada({ ...sel })
    e.preventDefault()
  }

  function onPaste(e: React.ClipboardEvent) {
    if (!sel || editando) return
    const g = cfgRef.current
    const { f, c } = sel
    if (!g.texto(f, c) || !g.editable(f, c)) return
    e.preventDefault()
    setCopiada(null) // el pegado consume el portapapeles, igual que en Excel
    // Pegar desde Excel arrastra tabuladores y saltos: se toma solo la 1ª celda.
    let texto = e.clipboardData.getData('text/plain').split(/[\r\n\t]/)[0].trim()
    if (g.numero?.(f, c)) texto = sanearNumero(texto, g.negativo?.(f, c))
    g.aplicar(f, c, texto)
    g.guardar(f, c, texto)
  }

  // Mover la selección enfoca el <td>, que es quien recibe las teclas.
  useEffect(() => {
    if (!sel || editando || !cfg.visible) return
    ref.current?.querySelector<HTMLElement>(`[data-celda="${sel.f}-${sel.c}"]`)?.focus()
  }, [sel, editando, cfg.visible])

  // Al borrar filas la selección puede quedar fuera de rango.
  useEffect(() => {
    setSel(prev => (prev && prev.f > cfg.filaMax ? { ...prev, f: Math.max(cfg.filaMax, 0) } : prev))
  }, [cfg.filaMax])

  // Clic fuera de la tabla estando en edición: confirmar, no perder lo escrito.
  useEffect(() => {
    if (!editando) return
    function onDown(ev: MouseEvent) {
      if (ref.current?.contains(ev.target as Node)) return
      salirRef.current(true)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [editando])

  return {
    sel,
    editando,
    caret,
    semilla,
    esActiva,
    esTabbable,
    esCopiada,
    seleccionar,
    editarCelda,
    terminarEdicion: (guardar = true) => salirEdicion(guardar),
    limpiarSeleccion,
    reiniciar,
    contiene: (n: Node | null) => !!n && !!ref.current?.contains(n),
    props: { ref, onKeyDown, onCopy, onPaste },
  }
}
