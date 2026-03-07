import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// Vite config optimized for low-end mobile (Samsung J6 / Android 8)
// - Manual chunk splitting to reduce initial bundle size
// - PWA via workbox for offline support
//
// Build modes:
//   npm run build           → For GitHub Pages (base: /IOT/)
//   npm run build:esp32     → For ESP32 self-hosting (base: /)
const isEsp32Build = process.env.BUILD_TARGET === 'esp32'
const base = isEsp32Build ? '/' : '/IOT/'

export default defineConfig({
  base,
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/icon-192.svg', 'icons/icon-512.svg'],
      manifest: {
        name: 'Smart Home Control',
        short_name: 'Control',
        description: 'ESP32 relay control panel with AI assistant',
        theme_color: '#000000',
        background_color: '#000000',
        display: 'standalone',
        orientation: 'landscape',
        start_url: base,
        scope: base,
        icons: [
          {
            src: 'icons/icon-192.svg',
            sizes: '192x192',
            type: 'image/svg+xml',
          },
          {
            src: 'icons/icon-512.svg',
            sizes: '512x512',
            type: 'image/svg+xml',
            purpose: 'any maskable',
          },
        ],
      },
      workbox: {
        // Cache app shell + static assets
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        runtimeCaching: [
          {
            // Do NOT cache API calls — relay state must always be live
            urlPattern: /^http.*\/api\//,
            handler: 'NetworkOnly',
          },
        ],
      },
    }),
  ],
  server: {
    host: true,   // bind to 0.0.0.0 so the phone can reach the Mac
    port: 5173,
    strictPort: false,
  },
  build: {
    // Chunk splitting: router + react core isolated from app logic
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom'],
          router: ['react-router-dom'],
          http: ['axios'],
        },
      },
    },
    // Lower target for Android WebView compatibility
    target: 'es2015',
    // Reduce chunk size warnings threshold
    chunkSizeWarningLimit: 400,
  },
})
