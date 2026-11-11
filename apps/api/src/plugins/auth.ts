import { timingSafeEqual } from 'node:crypto'
import type { FastifyRequest, onRequestAsyncHookHandler } from 'fastify'
import fp from 'fastify-plugin'
import {
  CSRF_HEADER_NAME,
  SESSION_COOKIE_NAME,
  roleHasPermission,
  type Permission,
} from '@amo/shared'
import { appOrigin } from '../config/env'
import { Errors } from '../common/errors'
import { SessionService, type AuthContext } from '../modules/auth/session.service'
import { SessionsRepository } from '../modules/auth/sessions.repository'

declare module 'fastify' {
  interface FastifyRequest {
    /** Terisi oleh `app.authenticate`. `null` pada route publik. */
    auth: AuthContext | null
  }
  interface FastifyInstance {
    sessions: SessionService
    /** Hook onRequest: wajib sesi valid (+ CSRF untuk method yang mengubah state). */
    authenticate: onRequestAsyncHookHandler
    /** Hook onRequest: wajib punya izin tertentu. Pasang SETELAH `authenticate`. */
    requirePermission: (permission: Permission) => onRequestAsyncHookHandler
  }
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

/**
 * Proteksi CSRF untuk autentikasi berbasis cookie (PRD §10.4 & §17), 2 lapis:
 *  1. Header `Origin` (bila ada) HARUS sama dengan origin aplikasi web.
 *  2. Header `x-csrf-token` HARUS cocok dengan token turunan sesi.
 * Ditambah cookie `SameSite=Lax` sebagai lapis ketiga di sisi browser.
 */
function assertCsrf(request: FastifyRequest, ctx: AuthContext, allowedOrigin: string): void {
  const origin = request.headers.origin
  if (origin && origin !== allowedOrigin) throw Errors.csrfInvalid()

  const sent = request.headers[CSRF_HEADER_NAME]
  if (typeof sent !== 'string') throw Errors.csrfInvalid()
  const a = Buffer.from(sent)
  const b = Buffer.from(ctx.csrfToken)
  // timingSafeEqual melempar bila panjang beda → cek panjang dulu.
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw Errors.csrfInvalid()
}

export default fp(
  async (app) => {
    const sessions = new SessionService(new SessionsRepository(app.db), app.config)
    const allowedOrigin = appOrigin(app.config)

    app.decorate('sessions', sessions)
    app.decorateRequest('auth', null)

    app.decorate('authenticate', async (request, reply) => {
      const token = request.cookies[SESSION_COOKIE_NAME]
      if (!token) throw Errors.authRequired()

      const ctx = await sessions.resolve(token)
      if (!ctx) {
        // Cookie basi/ditolak → hapus agar browser tidak terus mengirimnya.
        reply.clearCookie(SESSION_COOKIE_NAME, { path: '/' })
        throw Errors.authRequired()
      }

      if (!SAFE_METHODS.has(request.method)) assertCsrf(request, ctx, allowedOrigin)
      request.auth = ctx
    })

    app.decorate('requirePermission', (permission: Permission): onRequestAsyncHookHandler => {
      return async (request) => {
        if (!request.auth) throw Errors.authRequired() // salah urutan hook → gagal aman
        if (!roleHasPermission(request.auth.user.role, permission)) throw Errors.forbidden()
      }
    })

    // Bersihkan sesi kedaluwarsa secara berkala (tak berlaku saat test).
    if (app.config.NODE_ENV !== 'test') {
      const timer = setInterval(
        () => {
          sessions.purgeExpired().catch((err) => app.log.warn({ err }, 'gagal purge sesi kedaluwarsa'))
        },
        10 * 60_000,
      )
      timer.unref() // jangan menahan proses saat shutdown
      app.addHook('onClose', async () => clearInterval(timer))
    }
  },
  { name: 'auth', dependencies: ['database', 'security'] },
)
