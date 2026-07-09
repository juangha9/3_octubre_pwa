import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClient } from '@/lib/query'
import { AuthProvider } from '@/features/auth/AuthContext'
import { ThemeProvider } from '@/lib/theme'
import App from './App'
import './index.css'

// Aplica el tema ANTES del primer render (evita parpadeo y garantiza que
// `data-theme` esté puesto aunque un efecto tarde). Debe coincidir con la
// clave/lógica de <ThemeProvider>.
;(() => {
  try {
    const raw = localStorage.getItem('app.theme')
    const stored = raw ? (JSON.parse(raw) as string) : null
    const theme =
      stored === 'light' || stored === 'dark'
        ? stored
        : window.matchMedia?.('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light'
    document.documentElement.setAttribute('data-theme', theme)
  } catch {
    /* sin localStorage → el ThemeProvider lo aplicará en su efecto */
  }
})()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <AuthProvider>
        <QueryClientProvider client={queryClient}>
          <App />
        </QueryClientProvider>
      </AuthProvider>
    </ThemeProvider>
  </StrictMode>
)
