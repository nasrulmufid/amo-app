import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import fastifyStatic from '@fastify/static'
import fp from 'fastify-plugin'
import { API_PREFIX } from '@amo/shared'
import type { FastifyReply, FastifyRequest } from 'fastify'

declare module 'fastify' {
  interface FastifyInstance {
    /**
     * Fallback SPA (dipasang plugin ini bila SERVE_WEB aktif). Dipanggil dari
     * setNotFoundHandler: `true` = sudah menjawab (index.html), `false` = bukan
     * request halaman SPA → biarkan balasan 404 JSON standar.
     */
    spaFallback?: (request: FastifyRequest, reply: FastifyReply) => boolean
  }
}

/**
 * Mode produksi TANPA Docker: Fastify menyajikan frontend hasil `vite build`
 * (apps/web/dist) pada origin yang SAMA dengan API — replika topologi Nginx
 * di deploy/ (PRD §15.1). Cookie sesi SameSite & proteksi CSRF otomatis
 * berperilaku benar karena tidak ada origin kedua.
 *
 *  - `/assets/*`  → cache agresif (nama file ber-hash, immutable)
 *  - file lain    → no-cache
 *  - rute SPA     → fallback index.html via setNotFoundHandler (error-handler)
 *  - /api, /health, /remote, /docs TIDAK pernah difallback (tetap 404 JSON)
 */
export default fp(
  async (app) => {
    if (!app.config.SERVE_WEB) return

    const webDist = app.config.WEB_DIST_DIR
      ? path.resolve(app.config.WEB_DIST_DIR)
      : // import.meta.url = apps/api/dist/server.js (build) atau apps/api/src/… (tsx)
        // → naik 2 tingkat = apps/ → apps/web/dist (berlaku untuk keduanya).
        path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../web/dist')

    if (!existsSync(webDist)) {
      throw new Error(
        `SERVE_WEB=true tetapi folder frontend tidak ditemukan: ${webDist}\n` +
          'Jalankan `npm run build` di root repo terlebih dahulu.',
      )
    }

    await app.register(fastifyStatic, {
      root: webDist,
      prefix: '/',
      index: false, // '/' ditangani fallback SPA di bawah
      wildcard: false, // rute per-file; URL tak dikenal → notFound → index.html
      etag: true,
      lastModified: true,
      setHeaders(reply, pathName) {
        // Aset Vite ber-hash → cache setahun; berkas lain (index.html) → revalidasi.
        if (pathName.includes(`${path.sep}assets${path.sep}`)) {
          reply.header('Cache-Control', 'public, max-age=31536000, immutable')
        } else {
          reply.header('Cache-Control', 'no-cache')
        }
      },
    })

    app.decorate('spaFallback', (request: FastifyRequest, reply: FastifyReply): boolean => {
      const url = request.url.split('?')[0] ?? request.url
      const reserved =
        url === API_PREFIX ||
        url.startsWith(`${API_PREFIX}/`) ||
        url === '/health' ||
        url.startsWith('/health/') ||
        url === '/remote' ||
        url.startsWith('/remote/') ||
        url === '/docs' ||
        url.startsWith('/docs/')
      if (reserved) return false
      if (request.method !== 'GET' && request.method !== 'HEAD') return false
      const lastSegment = url.slice(url.lastIndexOf('/'))
      // Navigasi halaman SPA: terima Accept text/html ATAU URL tanpa ekstensi file
      // (mis. /login, /devices/123) — sehingga curl/klien non-browser tetap dapat
      // index.html. URL berekstensi tapi tidak ada file-nya (aset hilang) → 404 JSON.
      const isSpaNavigation = request.headers.accept?.includes('text/html') || !lastSegment.includes('.')
      if (!isSpaNavigation) return false
      void reply.sendFile('index.html')
      return true
    })
  },
  { name: 'static-web', dependencies: ['security'] },
)
