import { Type } from '@sinclair/typebox'
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox'

/**
 * Health check (PRD §13.5 & §15.2) — di LUAR prefix /api/v1 & tanpa autentikasi
 * agar bisa dipakai Docker/Nginx/monitoring.
 *  - /health        = LIVENESS  : proses hidup? (tak menyentuh DB)
 *  - /health/ready  = READINESS : siap melayani? (cek koneksi DB)
 * `rateLimit: false` agar probe berkala tak pernah kena 429.
 */
const routes: FastifyPluginAsyncTypebox = async (app) => {
  app.get(
    '/health',
    {
      config: { rateLimit: false },
      schema: {
        tags: ['health'],
        summary: 'Liveness',
        security: [],
        response: { 200: Type.Object({ status: Type.Literal('ok'), uptimeSeconds: Type.Integer() }) },
      },
    },
    async () => ({ status: 'ok' as const, uptimeSeconds: Math.floor(process.uptime()) }),
  )

  app.get(
    '/health/ready',
    {
      config: { rateLimit: false },
      schema: {
        tags: ['health'],
        summary: 'Readiness (cek database)',
        security: [],
        response: {
          200: Type.Object({ status: Type.Literal('ready'), database: Type.Literal('up') }),
          503: Type.Object({ status: Type.Literal('unavailable'), database: Type.Literal('down') }),
        },
      },
    },
    async (request, reply) => {
      try {
        await app.db.query('SELECT 1')
        return { status: 'ready' as const, database: 'up' as const }
      } catch (err) {
        request.log.error({ err }, 'readiness check gagal')
        return reply.code(503).send({ status: 'unavailable' as const, database: 'down' as const })
      }
    },
  )
}

export default routes
