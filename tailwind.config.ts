import type { Config } from 'tailwindcss'

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: ['selector', '[data-theme="dark"]'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Roboto', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      // Todos los tokens se resuelven vía variables CSS (definidas en index.css)
      // para que el tema claro/oscuro se aplique automáticamente a cualquier
      // clase `bg-primary`, `text-app-text`, `border-app-border`, etc.
      colors: {
        primary: {
          DEFAULT: 'rgb(var(--c-primary) / <alpha-value>)',
          dark: 'rgb(var(--c-primary-dark) / <alpha-value>)',
          text: 'rgb(var(--c-primary-text) / <alpha-value>)',
        },
        success: {
          DEFAULT: 'rgb(var(--c-success) / <alpha-value>)',
          dark: 'rgb(var(--c-success-dark) / <alpha-value>)',
          text: 'rgb(var(--c-success-text) / <alpha-value>)',
        },
        warning: {
          DEFAULT: 'rgb(var(--c-warning) / <alpha-value>)',
          dark: 'rgb(var(--c-warning-dark) / <alpha-value>)',
          text: 'rgb(var(--c-warning-text) / <alpha-value>)',
        },
        danger: {
          DEFAULT: 'rgb(var(--c-danger) / <alpha-value>)',
          dark: 'rgb(var(--c-danger-dark) / <alpha-value>)',
          text: 'rgb(var(--c-danger-text) / <alpha-value>)',
        },
        accent: {
          DEFAULT: 'rgb(var(--c-accent) / <alpha-value>)',
          dark: 'rgb(var(--c-accent-dark) / <alpha-value>)',
          text: 'rgb(var(--c-accent-text) / <alpha-value>)',
        },
        app: {
          bg: 'rgb(var(--c-app-bg) / <alpha-value>)',
          surface: 'rgb(var(--c-app-surface) / <alpha-value>)',
          border: 'rgb(var(--c-app-border) / <alpha-value>)',
          muted: 'rgb(var(--c-app-muted) / <alpha-value>)',
          text: 'rgb(var(--c-app-text) / <alpha-value>)',
        },
      },
      fontSize: {
        xs: ['0.7rem', { lineHeight: '1rem' }],
      },
      // Tablas compactas estilo Excel
      spacing: {
        'row': '1.75rem', // h-7 — altura estándar de fila de tabla
      },
      transitionTimingFunction: {
        smooth: 'cubic-bezier(0.4, 0, 0.2, 1)',
      },
      transitionDuration: {
        DEFAULT: '200ms',
      },
    },
  },
  plugins: [],
} satisfies Config
