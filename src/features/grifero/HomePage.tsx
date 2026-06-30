import { useNavigate } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/features/auth/useAuth'

export default function HomePage() {
  const navigate = useNavigate()
  const { profile } = useAuth()
  const [now, setNow] = useState(new Date())

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30000)
    return () => clearInterval(t)
  }, [])

  const fecha = now.toLocaleDateString('es-PE', {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  })
  const hora = now.toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' })

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-app-bg px-6 py-12">
      <div className="mb-10 text-center">
        <div className="mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-3xl bg-primary text-4xl shadow-sm">
          ⛽
        </div>
        <h1 className="text-2xl font-bold text-app-text">Sistema Grifero</h1>
        {profile && (
          <p className="mt-1 text-sm text-app-muted">
            Hola, <span className="font-medium text-app-text">{profile.nombre}</span>
          </p>
        )}
        <p className="mt-1 text-xs uppercase tracking-widest text-app-muted">
          Selecciona una operación
        </p>
      </div>

      <div className="flex w-full max-w-md flex-col gap-4">
        <OperationCard
          icon="💰"
          iconBg="bg-success"
          title="Cierre de Caja"
          subtitle="Conteo de efectivo y cierre de turno"
          onClick={() => navigate('/cierre')}
        />
        <OperationCard
          icon="📏"
          iconBg="bg-primary"
          title="Varillaje"
          subtitle="Medición de tanques de combustible"
          onClick={() => navigate('/varillaje')}
        />
      </div>

      <div className="mt-12 flex items-center gap-2 text-xs text-app-muted">
        <span className="capitalize">{fecha}</span>
        <span>·</span>
        <span>{hora}</span>
      </div>

      <button
        onClick={() => supabase.auth.signOut()}
        className="btn-ghost mt-6 text-xs"
      >
        Cerrar sesión
      </button>
    </div>
  )
}

interface OperationCardProps {
  icon: string
  iconBg: string
  title: string
  subtitle: string
  onClick: () => void
}

function OperationCard({ icon, iconBg, title, subtitle, onClick }: OperationCardProps) {
  return (
    <button
      onClick={onClick}
      className="card flex items-center gap-4 text-left hover:-translate-y-0.5 hover:shadow-md"
    >
      <div
        className={`flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-2xl ${iconBg} text-2xl`}
      >
        {icon}
      </div>
      <div>
        <div className="text-lg font-semibold text-app-text">{title}</div>
        <div className="text-sm text-app-muted">{subtitle}</div>
      </div>
    </button>
  )
}
