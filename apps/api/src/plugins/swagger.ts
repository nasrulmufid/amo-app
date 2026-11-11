import fp from 'fastify-plugin'
import swagger from '@fastify/swagger'
import swaggerUi from '@fastify/swagger-ui'
import { SESSION_COOKIE_NAME } from '@amo/shared'

/**
 * OpenAPI 3.1 dihasilkan OTOMATIS dari schema TypeBox tiap route (PRD §9.4 & §16).
 *  - Swagger UI : GET /docs        (aktif bila API_DOCS_ENABLED=true)
 *  - File YAML  : `npm run openapi:export` → docs/openapi.yaml
 * Wajib registrasi SEBELUM route agar semua route ikut terdokumentasi.
 */
export default fp(
  async (app) => {
    await app.register(swagger, {
      openapi: {
        openapi: '3.1.0',
        info: {
          title: 'AMO API',
          version: '1.0.0',
          description: 'Aplikasi Management ONU — REST API. Semua endpoint di bawah /api/v1.',
        },
        servers: [{ url: app.config.APP_BASE_URL }],
        tags: [
          { name: 'health', description: 'Liveness & readiness' },
          { name: 'auth', description: 'Login, logout, sesi' },
          { name: 'dashboard', description: 'Ringkasan dashboard' },
          { name: 'inventory', description: 'Inventaris ONU (Sprint 2)' },
          { name: 'users', description: 'Manajemen pengguna (Sprint 5)' },
          { name: 'audit', description: 'Audit log (Sprint 5)' },
          { name: 'admin', description: 'Operasi administrator (sync manual — Sprint 3)' },
          { name: 'remote', description: 'Remote proxy (Sprint 4)' },
        ],
        components: {
          securitySchemes: {
            sessionCookie: { type: 'apiKey', in: 'cookie', name: SESSION_COOKIE_NAME },
          },
        },
        // Default: semua endpoint butuh sesi. Endpoint publik menimpa dengan `security: []`.
        security: [{ sessionCookie: [] }],
      },
    })

    if (app.config.API_DOCS_ENABLED) {
      await app.register(swaggerUi, { routePrefix: '/docs' })
    }
  },
  { name: 'swagger' },
)
