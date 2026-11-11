import fp from 'fastify-plugin'
import cookie from '@fastify/cookie'
import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import rateLimit from '@fastify/rate-limit'
import { CSRF_HEADER_NAME } from '@amo/shared'
import { appOrigin } from '../config/env'
import { Errors } from '../common/errors'

/**
 * Lapisan keamanan HTTP: header, CORS, cookie parser, rate limit.
 * (Skill fastify-rest-api → "Essential Production Plugins")
 */
export default fp(
  async (app) => {
    // ── Security headers ─────────────────────────────────────────────────────
    // CSP dimatikan DI API karena: (1) API hanya mengirim JSON; (2) Swagger UI
    // butuh inline script; (3) halaman perangkat di /remote/* punya script sendiri
    // dan CSP global akan merusaknya. CSP untuk aplikasi web diatur di Nginx
    // (deploy/nginx/default.conf).
    // TODO (Sprint 4): untuk respons /remote/*, pertimbangkan `Content-Security-Policy: sandbox`
    //                  atau header isolasi lain agar UI perangkat tak bisa menyentuh sesi AMO.
    await app.register(helmet, { contentSecurityPolicy: false })

    // ── CORS ────────────────────────────────────────────────────────────────
    // Produksi: web & API satu origin (Nginx) → CORS praktis tak terpakai.
    // Dev tanpa proxy Vite: hanya origin web yang boleh, plus kredensial (cookie).
    await app.register(cors, {
      origin: [appOrigin(app.config)],
      credentials: true,
      methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', CSRF_HEADER_NAME],
    })

    // ── Cookie ──────────────────────────────────────────────────────────────
    // Token sesi berupa string acak (bukan JWT) → tidak perlu cookie signing;
    // keamanannya ada pada entropi token + hash di database.
    await app.register(cookie)

    // ── Rate limit ──────────────────────────────────────────────────────────
    // Batas global longgar; endpoint sensitif (login) memasang batas sendiri
    // lewat `config: { rateLimit: {...} }` pada route-nya.
    // Penyimpanan default = memori proses → cukup untuk 1 instance. Bila API
    // di-scale >1 replika, pindahkan ke Redis (opsi `redis`).
    await app.register(rateLimit, {
      global: true,
      max: 300,
      timeWindow: '1 minute',
      // Plugin akan `throw` nilai ini → ditangani error-handler (format PRD §9.3).
      errorResponseBuilder: () => Errors.rateLimited(),
    })
  },
  { name: 'security' },
)
