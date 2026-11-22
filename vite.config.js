import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'Yatra — group trip',
        short_name: 'Yatra',
        theme_color: '#0f766e',
        background_color: '#f8fafc',
        display: 'standalone',
        icons: [{ src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' }],
      },
    }),
  ],
  build: {
    rollupOptions: {
      output: {
        // Firestore, Auth and the Firebase core load up front as separate files; messaging, storage,
        // AI and app-check are dynamic imports and get their own on-demand chunks.
        manualChunks(id) {
          if (!id.includes('node_modules')) return
          if (/node_modules\/(react|react-dom|scheduler)\//.test(id)) return 'vendor'
          if (id.includes('/leaflet/')) return 'leaflet'
          if (id.includes('@firebase/firestore')) return 'firebase-firestore'
          if (id.includes('@firebase/auth')) return 'firebase-auth'
          if (/@firebase\/(app|component|util|logger)\//.test(id) || /node_modules\/(idb|tslib)\//.test(id)) return 'firebase-core'
        },
      },
    },
  },
})
