import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { Turno } from '@/types'

export function useTurnos() {
  return useQuery({
    queryKey: ['turnos'],
    queryFn: async (): Promise<Turno[]> => {
      const { data, error } = await supabase
        .from('turnos')
        .select('*')
        .eq('activo', true)
        .order('id')
      if (error) throw error
      return data ?? []
    },
  })
}

/** "06:00" + "14:00" → "06:00 - 14:00" */
export function formatHorario(t: Turno | undefined): string {
  if (!t || !t.hora_inicio || !t.hora_fin) return '—'
  const hhmm = (s: string) => s.slice(0, 5)
  return `${hhmm(t.hora_inicio)} - ${hhmm(t.hora_fin)}`
}
