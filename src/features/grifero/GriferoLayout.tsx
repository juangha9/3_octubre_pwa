import { Routes, Route, Navigate } from 'react-router-dom'
import HomePage from './HomePage'
import CierreCajaPage from './cierre/CierreCajaPage'
import VarillajePage from './varillaje/VarillajePage'

/**
 * Layout de la app del grifero.
 *
 * `base` permite montar exactamente la misma interfaz en dos lugares:
 *   - Rol grifero  → base='' (rutas /, /cierre, /varillaje)
 *   - Superadmin   → base='/grifero' (rutas /grifero, /grifero/cierre, …)
 * Los hijos usan `base` para construir su navegación, así el diseño es idéntico
 * en ambos casos sin duplicar componentes.
 */
export default function GriferoLayout({ base = '' }: { base?: string }) {
  return (
    <Routes>
      <Route index element={<HomePage base={base} />} />
      <Route path="cierre" element={<CierreCajaPage base={base} />} />
      <Route path="varillaje" element={<VarillajePage base={base} />} />
      {/* URL heredada que no coincide → volver al inicio del grifero */}
      <Route path="*" element={<Navigate to={base || '/'} replace />} />
    </Routes>
  )
}
