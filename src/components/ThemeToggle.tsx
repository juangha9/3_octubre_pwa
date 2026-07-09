import { useTheme } from '@/lib/theme'

/** Botón para alternar entre tema claro y oscuro. */
export default function ThemeToggle({ className = '' }: { className?: string }) {
  const { theme, toggle } = useTheme()
  const dark = theme === 'dark'
  return (
    <button
      type="button"
      onClick={toggle}
      title={dark ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro'}
      aria-label={dark ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro'}
      className={`inline-flex h-8 w-8 items-center justify-center rounded-md border border-app-border
                  bg-app-surface text-base text-app-text transition-colors
                  hover:bg-app-border focus:outline-none focus:ring-2 focus:ring-primary-dark ${className}`}
    >
      {dark ? '☀️' : '🌙'}
    </button>
  )
}
