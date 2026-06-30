import { Routes, Route, NavLink } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import VentasDelDiaPage from './ventas/VentasDelDiaPage'
import VentasDiariasPage from './ventas/VentasDiariasPage'
import ConfiguracionPage from './configuracion/ConfiguracionPage'

function Placeholder({ title }: { title: string }) {
  return (
    <div className="flex flex-1 items-center justify-center">
      <p className="text-app-muted">{title} — en construcción</p>
    </div>
  )
}

const NAV_ITEMS = [
  { to: '/', label: 'Ventas del Día', end: true },
  { to: '/ventas-diarias', label: 'Ventas Diarias' },
  { to: '/corporativo', label: 'Corporativo / Vales' },
  { to: '/compras', label: 'Compras' },
  { to: '/osinergmin', label: 'OSINERGMIN' },
  { to: '/configuracion', label: 'Configuración' },
]

export default function AdminLayout() {
  async function handleLogout() {
    await supabase.auth.signOut()
  }

  return (
    <div className="flex h-screen flex-col bg-app-bg">
      {/* Top nav */}
      <header className="flex items-center gap-1 border-b border-app-border bg-white px-4 py-1.5 shadow-sm">
        <span className="mr-3 text-sm font-semibold text-primary-text">Sistema Grifo</span>
        {NAV_ITEMS.map((item) => (
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
        <button
          onClick={handleLogout}
          className="btn-ghost ml-auto text-xs"
        >
          Salir
        </button>
      </header>

      {/* Content */}
      <main className="flex flex-1 overflow-hidden">
        <Routes>
          <Route path="/" element={<VentasDelDiaPage />} />
          <Route path="/ventas-diarias" element={<VentasDiariasPage />} />
          <Route path="/corporativo" element={<Placeholder title="Corporativo / Vales" />} />
          <Route path="/compras" element={<Placeholder title="Compras de Combustible" />} />
          <Route path="/osinergmin" element={<Placeholder title="OSINERGMIN" />} />
          <Route path="/configuracion" element={<ConfiguracionPage />} />
        </Routes>
      </main>
    </div>
  )
}
