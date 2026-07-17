import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import type { Profile, Role } from '@/types'

interface AuthState {
  session: Session | null
  profile: Profile | null
  role: Role | null
  loading: boolean
}

const AuthContext = createContext<AuthState>({
  session: null,
  profile: null,
  role: null,
  loading: true,
})

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)
  const profileRef = useRef<Profile | null>(null)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      if (data.session) fetchProfile(data.session.user.id)
      else setLoading(false)
    })

    const { data: listener } = supabase.auth.onAuthStateChange((event, s) => {
      // TOKEN_REFRESHED y SIGNED_IN se disparan cuando el tab vuelve al foco.
      // Si ya tenemos perfil, solo actualizar el token sin mostrar pantalla de carga.
      if (
        (event === 'TOKEN_REFRESHED' || event === 'SIGNED_IN') &&
        profileRef.current !== null
      ) {
        setSession(s)
        return
      }
      setSession(s)
      if (s) {
        setLoading(true)
        fetchProfile(s.user.id)
      } else {
        profileRef.current = null
        setProfile(null)
        setLoading(false)
      }
    })

    return () => listener.subscription.unsubscribe()
  }, [])

  async function fetchProfile(userId: string) {
    // Local-first: sin internet (o con Supabase caído) la app debe poder
    // arrancar igual. Si la consulta del perfil falla pero hay sesión
    // persistida, se usa la última copia local del perfil.
    const CACHE_KEY = 'grifo-profile-cache'
    let p: Profile | null = null
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, nombre, rol, activo, created_at')
        .eq('id', userId)
        .single()
      if (error) throw error
      p = (data as Profile) ?? null
      if (p) localStorage.setItem(CACHE_KEY, JSON.stringify(p))
    } catch {
      try {
        const cached = localStorage.getItem(CACHE_KEY)
        const parsed = cached ? (JSON.parse(cached) as Profile) : null
        // Solo vale el caché del MISMO usuario de la sesión activa.
        if (parsed && parsed.id === userId) p = parsed
      } catch {
        p = null
      }
    }
    profileRef.current = p
    setProfile(p)
    setLoading(false)
  }

  return (
    <AuthContext.Provider value={{ session, profile, role: profile?.rol ?? null, loading }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthState {
  return useContext(AuthContext)
}
