import type { Config } from 'tailwindcss'

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Roboto', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      colors: {
        primary: {
          DEFAULT: '#BAD6F5',
          dark: '#91BEE9',
          text: '#1E3A5F',
        },
        success: {
          DEFAULT: '#BBF7D0',
          dark: '#86EFAC',
          text: '#14532D',
        },
        warning: {
          DEFAULT: '#FDE68A',
          dark: '#FCD34D',
          text: '#78350F',
        },
        danger: {
          DEFAULT: '#FECACA',
          dark: '#FCA5A5',
          text: '#7F1D1D',
        },
        accent: {
          DEFAULT: '#FED7AA',
          dark: '#FDBA74',
          text: '#7C2D12',
        },
        app: {
          bg: '#F1F5F9',
          surface: '#FFFFFF',
          border: '#E2E8F0',
          muted: '#94A3B8',
          text: '#1E293B',
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
