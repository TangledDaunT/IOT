import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// Vite config optimized for low-end mobile (Samsung J6 / Android 8)
// - Manual chunk splitting to reduce initial bundle size
// - PWA via workbox for offline support
export default defineConfig({
  base: '/IOT/',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/icon-192.svg', 'icons/icon-512.svg'],
      manifest: {
        name: 'IoT Control Dashboard',
        short_name: 'IoT Dash',
        description: 'Local ESP32 relay control panel',
        theme_color: '#0f172a',
        background_color: '#0f172a',
        display: 'standalone',
        orientation: 'landscape',
        start_url: '/IOT/',
        scope: '/IOT/',
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
