import { useNavigate } from 'react-router-dom'

export default function VarillajePage() {
  const navigate = useNavigate()

  return (
    <div className="min-h-screen bg-app-bg">
      <div className="sticky top-0 z-20 flex h-12 items-center gap-3 border-b border-app-border bg-white px-4 shadow-sm">
        <button
          onClick={() => navigate('/')}
          className="flex h-8 w-8 items-center justify-center rounded-lg bg-app-bg text-lg text-app-muted transition-colors duration-200 hover:bg-app-border"
        >
          ←
        </button>
        <div className="flex-1 text-base font-semibold text-app-text">Varillaje</div>
      </div>

      <div className="flex flex-col items-center justify-center px-6 py-24 text-center">
        <div className="mb-5 flex h-20 w-20 items-center justify-center rounded-3xl bg-primary text-4xl">
          📏
        </div>
        <h2 className="mb-2 text-xl font-semibold text-app-text">Módulo en Desarrollo</h2>
        <p className="max-w-sm text-sm leading-relaxed text-app-muted">
          La medición y registro de tanques de combustible estará disponible próximamente.
        </p>
      </div>
    </div>
  )
}
