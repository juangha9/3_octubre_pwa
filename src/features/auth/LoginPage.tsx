import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import ThemeToggle from '@/components/ThemeToggle'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    const { error: err } = await supabase.auth.signInWithPassword({ email, password })
    if (err) setError(err.message)
    setLoading(false)
  }

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-app-bg">
      <ThemeToggle className="absolute right-4 top-4" />
      <div className="card w-full max-w-xs">
        <h1 className="mb-6 text-center text-lg font-semibold text-primary-text">
          Sistema Grifo
        </h1>
        <form onSubmit={handleLogin} className="flex flex-col gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-app-muted">Correo</label>
            <input
              type="email"
              className="input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              required
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-app-muted">Contraseña</label>
            <input
              type="password"
              className="input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
          </div>
          {error && <p className="text-xs text-danger-text">{error}</p>}
          <button type="submit" className="btn-primary mt-1" disabled={loading}>
            {loading ? 'Ingresando...' : 'Ingresar'}
          </button>
        </form>
      </div>
    </div>
  )
}
