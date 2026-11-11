import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Target API saat dev. Ubah lewat env bila API berjalan di host/port lain.
const API = process.env.API_PROXY_TARGET ?? 'http://localhost:4500'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': path.resolve(import.meta.dirname, 'src') } },
  server: {
    port: 14500,
    // PROXY dev: browser hanya bicara ke :14500 → cookie sesi SAMA-ORIGIN seperti di produksi
    // (Nginx menggabungkan web + /api + /remote di satu origin). Tanpa ini cookie SameSite=Lax
    // dan CORS akan merepotkan.
    proxy: {
      '/api': API,
      '/health': API,
      '/remote': { target: API, ws: true }, // ws: dukung WebSocket UI perangkat (Sprint 4)
    },
  },
})
