import { useSyncStatus } from '@/lib/local/useSyncStatus'
import { sincronizarAhora } from '@/lib/local/sync'

/**
 * Indicador del estado local-first en la barra superior:
 *  - verde: todo sincronizado con Supabase
 *  - ámbar: sin conexión y/o cambios locales en cola (se enviarán solos)
 *  - rojo: el servidor rechazó un cambio (RLS, dato inválido) → revisar
 * Clic = forzar un ciclo de sincronización.
 */
export default function SyncBadge() {
  const s = useSyncStatus()

  let color = 'bg-emerald-500'
  let texto = 'Sincronizado'
  if (s.error) {
    color = 'bg-red-500'
    texto = `Error de sync (${s.pendientes} en cola)`
  } else if (!s.online) {
    color = 'bg-amber-500'
    texto = s.pendientes > 0 ? `Sin conexión · ${s.pendientes} por enviar` : 'Sin conexión'
  } else if (s.pendientes > 0) {
    color = 'bg-amber-500'
    texto = `Enviando ${s.pendientes}…`
  } else if (s.sincronizando) {
    texto = 'Sincronizando…'
  }

  return (
    <button
      onClick={() => void sincronizarAhora()}
      title={
        s.error
          ? `Un cambio fue rechazado por el servidor: ${s.error}`
          : 'Estado de sincronización — clic para sincronizar ahora'
      }
      className="flex items-center gap-1.5 rounded px-2 py-1 text-xs text-app-muted hover:bg-app-border"
    >
      <span className={`h-2 w-2 rounded-full ${color}`} />
      {texto}
    </button>
  )
}
