import { Routes, Route } from 'react-router-dom'
import HomePage from './HomePage'
import CierreCajaPage from './cierre/CierreCajaPage'
import VarillajePage from './varillaje/VarillajePage'

export default function GriferoLayout() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/cierre" element={<CierreCajaPage />} />
      <Route path="/varillaje" element={<VarillajePage />} />
    </Routes>
  )
}
