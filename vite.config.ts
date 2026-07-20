import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
// URL en lugar de path/__dirname: no requiere @types/node para el type-check
import { fileURLToPath } from 'node:url'

export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'robots.txt'],
      manifest: {
        name: 'Sistema Grifo',
        short_name: 'Grifo',
        description: 'Sistema de gestión para estación de servicio',
        theme_color: '#BAD6F5',
        background_color: '#F1F5F9',
        display: 'fullscreen',
        start_url: '/',
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg}'],
        // Los assets de Tesseract pesan ~15 MB entre core WASM y modelo de
        // idioma: precacharlos castigaría la primera carga de TODOS los
        // usuarios, cuando el OCR solo lo usa el admin. Se cachean la
        // primera vez que se usan (regla CacheFirst de abajo) y a partir
        // de ahí el OCR ya funciona sin internet.
        globIgnores: ['**/tesseract/**'],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/.*\.supabase\.co\/.*/i,
            handler: 'NetworkFirst',
            options: { cacheName: 'supabase-cache', expiration: { maxEntries: 50 } },
          },
          {
            urlPattern: /\/tesseract\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'tesseract-assets',
              // Inmutables (vienen de una versión fija del paquete) y
              // pesados: conviene que sobrevivan a las actualizaciones.
              expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
})
