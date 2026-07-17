import { useEffect } from 'react'
import { Routes, Route, NavLink, Navigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/features/auth/useAuth'
import { iniciarSync } from '@/lib/local/sync'
import ThemeToggle from '@/components/ThemeToggle'
import SyncBadge from '@/components/SyncBadge'
import VentasPage from './ventas/VentasDelDiaPage'
import CorporativoPage from './corporativo/CorporativoPage'
import ComprasPage from './compras/ComprasPage'
import ConfiguracionPage from './configuracion/ConfiguracionPage'
import OsinergminPage from './osinergmin/OsinergminPage'
import GriferoLayout from '@/features/grifero/GriferoLayout'

// `soloSuperadmin`: opciones del grifero visibles únicamente para el superadmin.
const NAV_ITEMS = [
  { to: '/', label: 'Ventas', end: true },
  { to: '/seguimiento', label: 'Seguimiento' },
  { to: '/compras', label: 'Compras' },
  { to: '/grifero', label: 'Grifero', soloSuperadmin: true },
  { to: '/osinergmin', label: 'OSINERGMIN' },
  { to: '/configuracion', label: 'Configuración' },
]

export default function AdminLayout() {
  const { role } = useAuth()
  const esSuperadmin = role === 'superadmin'
  const navItems = NAV_ITEMS.filter((item) => esSuperadmin || !item.soloSuperadmin)

  // Arranca el motor local-first (hidratación + outbox + pull periódico).
  // Vive aquí porque las tablas espejo tienen RLS de admin: solo tiene
  // sentido con una sesión de administración activa.
  useEffect(() => {
    iniciarSync()
  }, [])

  async function handleLogout() {
    await supabase.auth.signOut()
  }

  return (
    <div className="flex h-screen flex-col bg-app-bg">
      {/* Top nav */}
      <header className="flex items-center gap-1 border-b border-app-border bg-white px-4 py-1.5 shadow-sm">
        <span className="mr-3 text-sm font-semibold text-primary-text">Sistema Grifo</span>
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) =>
              `rounded px-2.5 py-1 text-sm transition-all duration-200 ease-in-out ${
                isActive
                  ? 'bg-primary text-primary-text font-medium'
                  : 'text-app-muted hover:bg-app-border hover:text-app-text'
              }`
            }
          >
            {item.label}
          </NavLink>
        ))}
        <div className="ml-auto flex items-center gap-2">
          <SyncBadge />
          <ThemeToggle />
          <button
            onClick={handleLogout}
            className="btn-ghost text-xs"
          >
            Salir
          </button>
        </div>
      </header>

      {/* Content */}
      <main className="flex flex-1 overflow-hidden">
        <Routes>
          <Route path="/" element={<VentasPage />} />
          <Route path="/seguimiento" element={<CorporativoPage />} />
          <Route path="/compras" element={<ComprasPage />} />
          {/* App del grifero embebida, idéntica a como la ve el grifero.
              Su navegación interna usa base="/grifero". */}
          {esSuperadmin && (
            <Route
              path="/grifero/*"
              element={
                <div className="h-full w-full overflow-auto">
                  <GriferoLayout base="/grifero" />
                </div>
              }
            />
          )}
          <Route path="/osinergmin" element={<OsinergminPage />} />
          <Route path="/configuracion" element={<ConfiguracionPage />} />
          {/* URL heredada de otro rol que no coincide → volver a Ventas */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  )
}
