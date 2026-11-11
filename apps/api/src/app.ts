import { randomBytes } from 'node:crypto'
import Fastify from 'fastify'
import { API_PREFIX } from '@amo/shared'
import { loadEnv, type Env } from './config/env'
import auditPlugin from './modules/audit/audit.plugin'
import syncPlugin from './modules/genieacs/sync.plugin'
import healthRoutes from './modules/health/health.routes'
import remoteRoutes from './modules/remote/remote.routes'
import { apiV1 } from './modules/index'
import authPlugin from './plugins/auth'
import databasePlugin from './plugins/database'
import errorHandlerPlugin from './plugins/error-handler'
import securityPlugin from './plugins/security'
import staticWebPlugin from './plugins/static-web'
import swaggerPlugin from './plugins/swagger'

declare module 'fastify' {
  interface FastifyInstance {
    /** Konfigurasi tervalidasi (lihat config/env.ts). Jangan baca process.env langsung. */
    config: Env
  }
}

/**
 * FACTORY aplikasi — merakit Fastify TANPA `listen()`.
 * Dipisah dari server.ts supaya test dapat memakai `app.inject()` (tanpa port nyata)
 * dan script (export OpenAPI) dapat memakai app yang sama.
 *
 * URUTAN REGISTRASI PENTING:
 *   error-handler → security → swagger → database → audit → auth → routes
 * (swagger harus sebelum route agar semua route terdokumentasi;
 *  auth butuh database & security; route butuh semuanya.)
 */
export async function buildApp(env: Env = loadEnv()) {
  const isDev = env.NODE_ENV === 'development'

  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL,
      // Log terstruktur JSON (siap ke Loki/ELK). Di dev dibuat berwarna agar mudah dibaca.
      ...(isDev ? { transport: { target: 'pino-pretty', options: { translateTime: 'SYS:HH:MM:ss' } } } : {}),
      // Jaring pengaman: rahasia tidak boleh muncul di log meskipun suatu saat header ikut dilog.
      redact: {
        paths: ['req.headers.cookie', 'req.headers.authorization', 'req.headers["x-csrf-token"]', 'res.headers["set-cookie"]'],
        censor: '[REDACTED]',
      },
    },
    // Request ID dibuat SERVER (bukan dipercaya dari klien) → dipakai di log, respons, dan audit.
    genReqId: () => `req_${randomBytes(8).toString('hex')}`,
    requestIdHeader: false,
    // Aktifkan HANYA bila di belakang reverse proxy tepercaya (lihat TRUST_PROXY di .env.example).
    trustProxy: env.TRUST_PROXY,
    // Batas body default 1 MiB sudah memadai untuk API JSON ini.
    bodyLimit: 1_048_576,
  })

  app.decorate('config', env)
  app.addHook('onSend', async (request, reply) => {
    reply.header('x-request-id', request.id) // memudahkan user melapor "requestId" ke admin
  })

  await app.register(errorHandlerPlugin)
  await app.register(securityPlugin)
  await app.register(staticWebPlugin) // produksi tanpa Nginx: sajikan frontend (SERVE_WEB)
  await app.register(swaggerPlugin)
  await app.register(databasePlugin)
  await app.register(auditPlugin)
  await app.register(authPlugin)
  await app.register(syncPlugin)

  // ── Route ──
  await app.register(healthRoutes) //                        /health, /health/ready
  await app.register(apiV1, { prefix: API_PREFIX }) //       /api/v1/*
  await app.register(remoteRoutes) //                        /remote/:uuid/* (+ remote-session)

  return app
}
