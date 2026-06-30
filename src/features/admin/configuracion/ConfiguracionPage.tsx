import { useState } from 'react'
import TurnosSection from './TurnosSection'
import TiposCombustibleSection from './TiposCombustibleSection'
import TanquesSection from './TanquesSection'
import EmpresasSection from './EmpresasSection'
import ProveedoresSection from './ProveedoresSection'
import AppConfigSection from './AppConfigSection'

const TABS = [
  { key: 'turnos',       label: 'Turnos' },
  { key: 'combustibles', label: 'Combustibles' },
  { key: 'tanques',      label: 'Tanques' },
  { key: 'empresas',     label: 'Empresas' },
  { key: 'proveedores',  label: 'Proveedores' },
  { key: 'sistema',      label: 'Sistema' },
] as const

type TabKey = (typeof TABS)[number]['key']

export default function ConfiguracionPage() {
  const [tab, setTab] = useState<TabKey>('turnos')

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Sub-tab bar */}
      <div className="flex gap-0.5 border-b border-app-border bg-white px-4">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`rounded-t px-3 py-1.5 text-sm transition-colors duration-150 ${
              tab === t.key
                ? 'border-b-2 border-primary-dark bg-primary/20 font-medium text-primary-text'
                : 'text-app-muted hover:text-app-text'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Section */}
      <div className="flex-1 overflow-y-auto p-4">
        {tab === 'turnos'       && <TurnosSection />}
        {tab === 'combustibles' && <TiposCombustibleSection />}
        {tab === 'tanques'      && <TanquesSection />}
        {tab === 'empresas'     && <EmpresasSection />}
        {tab === 'proveedores'  && <ProveedoresSection />}
        {tab === 'sistema'      && <AppConfigSection />}
      </div>
    </div>
  )
}
