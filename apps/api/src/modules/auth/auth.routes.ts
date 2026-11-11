import type { FastifyReply } from 'fastify'
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox'
import { SESSION_COOKIE_NAME } from '@amo/shared'
import { isHttps, type Env } from '../../config/env'
import { Errors } from '../../common/errors'
import { ok, requestMeta } from '../../common/http'
import { CommonErrors, Envelope } from '../../common/schemas'
import { UsersRepository } from '../users/users.repository'
import { AuthService, InvalidCredentialsError, type IssuedSession } from './auth.service'
import { LoginBody, LogoutResponse, SessionResponse } from './auth.schema'

/**
 * Cookie sesi (PRD §10.4):
 *  - httpOnly  → JavaScript di browser tidak dapat membacanya (tahan XSS-steal)
 *  - secure    → hanya via HTTPS (otomatis aktif bila APP_BASE_URL https://)
 *  - sameSite=lax → tidak dikirim pada POST lintas-situs (lapis CSRF tambahan)
 *  - tanpa `domain` → hanya untuk host ini (tidak bocor ke subdomain)
 */
function setSessionCookie(reply: FastifyReply, env: Env, token: string, expiresAt: Date) {
  reply.setCookie(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: isHttps(env),
    sameSite: 'lax',
    path: '/',
    expires: expiresAt,
  })
}

const toSessionDto = (s: IssuedSession) => ({
  user: { ...s.user, lastLoginAt: s.user.lastLoginAt?.toISOString() ?? null },
  csrfToken: s.csrfToken,
  expiresAt: s.expiresAt.toISOString(),
})

const routes: FastifyPluginAsyncTypebox = async (app) => {
  const auth = new AuthService(new UsersRepository(app.db), app.sessions)

  // ── POST /auth/login ──────────────────────────────────────────────────────
  app.post(
    '/login',
    {
      // Batas khusus login: 10 percobaan/menit/IP (PRD §10.4 "rate limit pada login").
      // TODO (hardening): tambah penguncian per-akun (mis. 5 gagal → tunda 15 menit)
      //                   agar brute-force terdistribusi lintas IP tetap terhambat.
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
      schema: {
        tags: ['auth'],
        summary: 'Login dan buat sesi',
        security: [], // publik
        body: LoginBody,
        response: { 200: Envelope(SessionResponse), 400: CommonErrors[400], 401: CommonErrors[401], 429: CommonErrors[429] },
      },
    },
    async (request, reply) => {
      // Rotasi: bila browser masih membawa sesi lama, cabut dulu.
      const oldToken = request.cookies[SESSION_COOKIE_NAME]
      if (oldToken) await app.sessions.revoke(oldToken)

      try {
        const session = await auth.login(request.body, requestMeta(request))
        setSessionCookie(reply, app.config, session.token, session.expiresAt)
        await app.audit.record(request, { action: 'auth.login', userId: session.user.id })
        return ok(request, toSessionDto(session))
      } catch (err) {
        if (err instanceof InvalidCredentialsError) {
          await app.audit.record(request, {
            action: 'auth.login_failed',
            details: { email: request.body.email.slice(0, 190), reason: err.reason },
          })
        }
        throw err
      }
    },
  )

  // ── POST /auth/refresh ────────────────────────────────────────────────────
  app.post(
    '/refresh',
    {
      onRequest: [app.authenticate],
      schema: {
        tags: ['auth'],
        summary: 'Perpanjang sesi (token dirotasi)',
        response: { 200: Envelope(SessionResponse), 401: CommonErrors[401], 403: CommonErrors[403] },
      },
    },
    async (request, reply) => {
      const oldToken = request.cookies[SESSION_COOKIE_NAME]
      if (!request.auth || !oldToken) throw Errors.authRequired()

      const session = await auth.refresh(request.auth, oldToken, requestMeta(request))
      setSessionCookie(reply, app.config, session.token, session.expiresAt)
      await app.audit.record(request, { action: 'auth.refresh' })
      return ok(request, toSessionDto(session))
    },
  )

  // ── POST /auth/logout ─────────────────────────────────────────────────────
  app.post(
    '/logout',
    {
      onRequest: [app.authenticate],
      schema: {
        tags: ['auth'],
        summary: 'Cabut sesi aktif',
        response: { 200: Envelope(LogoutResponse), 401: CommonErrors[401], 403: CommonErrors[403] },
      },
    },
    async (request, reply) => {
      const token = request.cookies[SESSION_COOKIE_NAME]
      if (token) await auth.logout(token) // dicabut di SERVER, bukan sekadar hapus cookie
      reply.clearCookie(SESSION_COOKIE_NAME, { path: '/' })
      await app.audit.record(request, { action: 'auth.logout' })
      return ok(request, { loggedOut: true })
    },
  )

  // ── GET /auth/me ──────────────────────────────────────────────────────────
  // Dipanggil web saat start untuk mengetahui "siapa saya" + mendapat token CSRF.
  app.get(
    '/me',
    {
      onRequest: [app.authenticate],
      schema: {
        tags: ['auth'],
        summary: 'Pengguna aktif + token CSRF',
        response: {
          200: Envelope(SessionResponse),
          401: CommonErrors[401],
        },
      },
    },
    async (request) => {
      const ctx = request.auth
      if (!ctx) throw Errors.authRequired()
      return ok(request, {
        user: { ...ctx.user, lastLoginAt: ctx.user.lastLoginAt?.toISOString() ?? null },
        csrfToken: ctx.csrfToken,
        expiresAt: ctx.expiresAt.toISOString(),
      })
    },
  )
}

export default routes
