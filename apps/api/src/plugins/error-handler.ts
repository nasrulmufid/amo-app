import fp from 'fastify-plugin'
import type { ErrorCode } from '@amo/shared'
import { AppError } from '../common/errors'
import { errorBody } from '../common/http'

/**
 * Penanganan error TERPUSAT (PRD §6 "Standar implementasi").
 *
 * Semua error — dari validasi schema, AppError, rate-limit, sampai bug tak
 * terduga — berakhir di sini dan diubah ke format PRD §9.3. Aturan emas:
 * error 5xx TIDAK PERNAH membocorkan pesan/stack asli ke client; detailnya
 * hanya masuk ke log server (bersama requestId untuk penelusuran).
 */
export default fp(
  async (app) => {
    app.setNotFoundHandler((request, reply) => {
      // Fallback SPA mode produksi tanpa Nginx (SERVE_WEB): rute halaman React
      // seperti /login, /devices → index.html. Plugin static-web yang memasang.
      if (app.spaFallback?.(request, reply)) return
      reply.code(404).send(errorBody('NOT_FOUND', 'Route not found.', request.id))
    })

    app.setErrorHandler((error, request, reply) => {
      const requestId = request.id

      // 1) Error yang kita lempar sendiri.
      if (error instanceof AppError) {
        if (error.statusCode >= 500) request.log.error({ err: error }, error.message)
        return reply
          .code(error.statusCode)
          .send(errorBody(error.code, error.message, requestId, error.details))
      }

      const e = error as {
        statusCode?: number
        message: string
        validation?: Array<{ instancePath?: string; message?: string }>
        validationContext?: string
      }

      // 2) Gagal validasi schema (body/query/params) → 400 dengan detail per-field.
      if (e.validation) {
        const details = e.validation.map((v) => ({
          in: e.validationContext ?? 'request',
          path: v.instancePath || '/',
          message: v.message ?? 'invalid',
        }))
        return reply
          .code(400)
          .send(errorBody('VALIDATION_ERROR', 'Request validation failed.', requestId, details))
      }

      // 3) Error 4xx bawaan Fastify/plugin (JSON rusak, payload kebesaran, dll).
      const status = e.statusCode ?? 500
      if (status >= 400 && status < 500) {
        const code: ErrorCode = status === 429 ? 'RATE_LIMITED' : 'BAD_REQUEST'
        return reply.code(status).send(errorBody(code, e.message, requestId))
      }

      // 4) Sisanya = bug/kegagalan tak terduga → log lengkap, balas generik.
      request.log.error({ err: error }, 'unhandled error')
      return reply.code(500).send(errorBody('INTERNAL_ERROR', 'Internal server error.', requestId))
    })
  },
  { name: 'error-handler' },
)
