import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { useAuth } from '@/features/auth/useAuth'
import { useHardenNumberInputs } from '@/lib/useHardenNumberInputs'
import LoginPage from '@/features/auth/LoginPage'
import GriferoLayout from '@/features/grifero/GriferoLayout'
import AdminLayout from '@/features/admin/AdminLayout'

const ROUTER_FUTURE = { v7_startTransition: true, v7_relativeSplatPath: true }

export default function App() {
  const { session, role, loading } = useAuth()

  // Endurece todos los <input type="number"> de la app (global, una sola vez).
  useHardenNumberInputs()

  // Muestra carga mientras session o role están pendientes
  if (loading || (session && !role)) return <LoadingScreen />

  if (!session) return <LoginPage />

  return (
    <BrowserRouter future={ROUTER_FUTURE}>
      <Routes>
        {role === 'grifero' && (
          <Route path="/*" element={<GriferoLayout />} />
        )}
        {(role === 'admin_grifo' || role === 'superadmin') && (
          <Route path="/*" element={<AdminLayout />} />
        )}
      </Routes>
    </BrowserRouter>
  )
}

function LoadingScreen() {
  return (
    <div className="fixed inset-0 flex items-center justify-center bg-app-bg">
      <div className="flex flex-col items-center gap-3">
        <div className="h-10 w-10 rounded-full border-4 border-primary border-t-primary-dark animate-spin" />
        <p className="text-sm text-app-muted">Cargando...</p>
      </div>
    </div>
  )
}
