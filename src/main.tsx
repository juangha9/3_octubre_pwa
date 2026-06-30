import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClient } from '@/lib/query'
import { AuthProvider } from '@/features/auth/AuthContext'
import App from './App'
import './index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthProvider>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </AuthProvider>
  </StrictMode>
)
