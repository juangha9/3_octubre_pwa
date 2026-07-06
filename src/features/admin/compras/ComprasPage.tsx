import { usePersistedState } from '@/lib/usePersistedState'
import CotizadorPage from './CotizadorPage'
import RegistroComprasPage from './RegistroComprasPage'

type Tab = 'cotizador' | 'registro'

export default function ComprasPage() {
  const [tab, setTab] = usePersistedState<Tab>('compras.tab', 'cotizador')

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col overflow-hidden">
      {/* ── Barra superior con pestañas ── */}
      <div className="border-b border-app-border bg-white px-4 py-2">
        <div className="flex gap-1">
          {([['cotizador', 'Cotizador'], ['registro', 'Registro de Compras']] as [Tab, string][]).map(([k, l]) => (
            <button key={k} onClick={() => setTab(k)}
              className={`rounded px-2.5 py-1 text-xs transition-colors duration-150 ${
                tab === k
                  ? 'bg-primary text-primary-text font-medium'
                  : 'text-app-muted hover:bg-app-border hover:text-app-text'
              }`}
            >{l}</button>
          ))}
        </div>
      </div>

      {/* ── Contenido ── */}
      <div className="flex-1 overflow-hidden">
        {tab === 'cotizador' ? <CotizadorPage /> : <RegistroComprasPage />}
      </div>
    </div>
  )
}
