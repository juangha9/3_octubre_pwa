import { createContext, useContext, useEffect } from 'react'
import { usePersistedState } from '@/lib/usePersistedState'

export type Theme = 'light' | 'dark'

interface ThemeCtx {
  theme: Theme
  toggle: () => void
  setTheme: (t: Theme) => void
}

const Ctx = createContext<ThemeCtx | null>(null)

/**
 * Provee el tema claro/oscuro a toda la app. Escribe `data-theme` en <html>,
 * lo que reescribe las variables CSS de index.css y re-tematiza todo.
 * La preferencia se recuerda en localStorage; el valor inicial respeta el
 * ajuste del sistema operativo la primera vez.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = usePersistedState<Theme>('app.theme', () =>
    window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  )

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
  }, [theme])

  const toggle = () => setTheme(t => (t === 'dark' ? 'light' : 'dark'))

  return <Ctx.Provider value={{ theme, toggle, setTheme }}>{children}</Ctx.Provider>
}

export function useTheme(): ThemeCtx {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useTheme debe usarse dentro de <ThemeProvider>')
  return ctx
}
