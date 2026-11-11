import { Type } from '@sinclair/typebox'
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox'
import type { RouteHandlerMethod } from 'fastify'
import replyFrom from '@fastify/reply-from'
import { API_PREFIX, REMOTE_SCHEMES, type RemoteScheme } from '@amo/shared'
import { Errors } from '../../common/errors'
import { ok } from '../../common/http'
import { CommonErrors, Envelope } from '../../common/schemas'
import { RemoteRepository } from './remote.repository'
import {
  RemoteTargetError,
  rewriteLocation,
  sanitizeRemotePath,
  sanitizeRequestHeaders,
  sanitizeResponseHeaders,
  scopeRemoteCookie,
} from './remote.security'
import { RemoteService, type RemoteContext } from './remote.service'

/**
 * Remote access (PRD §3.5, §10).
 *
 *   POST {API_PREFIX}/inventory/:uuid/remote-session  → validasi & kembalikan URL remote
 *   ALL  /remote/:uuid/*                              → reverse proxy ke UI web perangkat
 *
 * 🔐 Kontrol keamanan yang diterapkan (PRD §10.5):
 *  1. Sesi valid + izin `remote.open` pada SETIAP request (termasuk aset & WebSocket).
 *  2. UUID asing / perangkat nonaktif → 404.
 *  3. Target HANYA dari DB; host/port dari request diabaikan.
 *  4. Skema & port dibatasi REMOTE_ALLOWED_SCHEMES / REMOTE_ALLOWED_PORTS.
 *  5. Anti-SSRF: IP harus di dalam REMOTE_ALLOWED_CIDRS; loopback/link-local/metadata
 *     selalu ditolak; hostname di-resolve sekali lalu divalidasi (cegah DNS rebinding).
 *  6. Path dinormalisasi; tidak dapat keluar dari prefix remote.
 *  7. Header hop-by-hop & cookie AMO dibuang; Host ditetapkan ke target.
 *  8. Redirect ke host lain diblokir; cookie perangkat di-scope ke prefix remote.
 *  9. Timeout & batas ukuran respons.
 * 10. Audit ke `remote_access_logs` + `audit_logs` tanpa kredensial.
 */

const Params = Type.Object({ uuid: Type.String({ minLength: 36, maxLength: 36 }) })

/** Batas ukuran respons perangkat (PRD §10.3 "batas ukuran"). */
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024
const UPSTREAM_TIMEOUT_MS = 20_000

const routes: FastifyPluginAsyncTypebox = async (app) => {
  const service = new RemoteService(new RemoteRepository(app.db), app.config)
  const gate = [app.authenticate, app.requirePermission('remote.open')]

  // Proxy memakai undici (via @fastify/reply-from). Redirect TIDAK diikuti otomatis:
  // kita rewrite/blokir sendiri agar tidak keluar dari target.
  await app.register(replyFrom, {
    undici: {
      connections: 32,
      headersTimeout: UPSTREAM_TIMEOUT_MS,
      bodyTimeout: UPSTREAM_TIMEOUT_MS,
    },
  })

  // ── POST /api/v1/inventory/:uuid/remote-session ───────────────────────────
  app.post(
    `${API_PREFIX}/inventory/:uuid/remote-session`,
    {
      onRequest: gate,
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: {
        tags: ['remote'],
        summary: 'Validasi akses & buat konteks remote',
        params: Params,
        response: {
          200: Envelope(
            Type.Object({
              url: Type.String(),
              uuid: Type.String(),
              target: Type.String(),
              scheme: Type.Unsafe<RemoteScheme>(Type.String({ enum: [...REMOTE_SCHEMES] })),
              port: Type.Integer(),
              expiresAt: Type.String({ format: 'date-time' }),
            }),
          ),
          401: CommonErrors[401],
          403: CommonErrors[403],
          404: CommonErrors[404],
        },
      },
    },
    async (request) => {
      const ctx = await service.prepare(request.params.uuid)
      await service.log({
        userId: request.auth?.user.id ?? null,
        deviceUuid: ctx.target.uuid,
        target: ctx.resolved.ip,
        port: ctx.target.remotePort,
        result: 'session_open',
        statusCode: 200,
        requestId: request.id,
      })
      await app.audit.record(request, {
        action: 'remote.session_open',
        resourceType: 'onu_inventory',
        resourceId: ctx.target.uuid,
        details: { target: ctx.resolved.ip, port: ctx.target.remotePort, scheme: ctx.target.remoteScheme },
      })
      return ok(request, service.sessionDto(ctx))
    },
  )

  // ── ALL /remote/:uuid/* ───────────────────────────────────────────────────
  const proxyHandler: RouteHandlerMethod = async (request, reply) => {
    const uuid = (request.params as { uuid: string }).uuid
    const userId = request.auth?.user.id ?? null

    let ctx: RemoteContext
    try {
      ctx = await service.prepare(uuid)
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode ?? 500
      await service.log({
        userId,
        deviceUuid: uuid,
        target: null,
        port: null,
        result: status === 404 ? 'not_found' : 'denied_policy',
        statusCode: status,
        requestId: request.id,
      })
      await app.audit.record(request, {
        action: 'remote.denied',
        resourceType: 'onu_inventory',
        resourceId: uuid,
        details: { reason: (err as Error).message },
      })
      throw err
    }

    // Path relatif terhadap prefix remote (tanpa query — query diteruskan terpisah).
    const rawUrl = request.raw.url ?? '/'
    const queryIndex = rawUrl.indexOf('?')
    const rawPath = queryIndex >= 0 ? rawUrl.slice(0, queryIndex) : rawUrl
    const query = queryIndex >= 0 ? rawUrl.slice(queryIndex) : ''
    const prefix = ctx.prefix
    const relative = rawPath.startsWith(prefix) ? rawPath.slice(prefix.length) : rawPath

    let path: string
    try {
      path = sanitizeRemotePath(relative || '/')
    } catch (err) {
      if (err instanceof RemoteTargetError) throw Errors.validation(err.message)
      throw err
    }

    const targetHost = ctx.resolved.hostname ?? ctx.resolved.ip
    const hostHeader = ctx.target.remotePort === 80 || ctx.target.remotePort === 443
      ? targetHost
      : `${targetHost}:${ctx.target.remotePort}`

    const requestHeaders = sanitizeRequestHeaders(
      request.headers as Record<string, string | string[] | undefined>,
      hostHeader,
      ctx.origin,
      path,
    )

    // `reply.from` memakai `source` relatif terhadap `base`; query diteruskan apa adanya.
    const source = `${path}${query}`

    reply.from(source, {
      // `getUpstream` mengabaikan base dari request → target SELALU dari DB.
      getUpstream: () => ctx.origin,
      rewriteRequestHeaders: () => requestHeaders,
      rewriteHeaders: (headers) => {
        const clean = sanitizeResponseHeaders(headers as Record<string, string | string[] | undefined>)

        // Redirect: rewrite ke prefix remote atau blokir bila keluar target.
        const location = clean.location
        if (typeof location === 'string') {
          const rewritten = rewriteLocation(location, ctx.origin, prefix)
          if (rewritten === null) {
            delete clean.location
            clean['x-amo-remote-blocked-redirect'] = '1'
          } else {
            clean.location = rewritten
          }
        }

        // Cookie perangkat: scope ke prefix remote & beri awalan agar tidak menimpa cookie AMO.
        const setCookie = clean['set-cookie']
        if (setCookie !== undefined) {
          const list = Array.isArray(setCookie) ? setCookie : [setCookie]
          clean['set-cookie'] = list.map((c) => scopeRemoteCookie(c, prefix))
        }

        // UI perangkat tidak boleh di-embed lintas origin.
        clean['x-frame-options'] = 'SAMEORIGIN'
        return clean
      },
      onResponse: (req, rep, res) => {
        // `res` adalah respons mentah Node (IncomingMessage) + `stream`.
        const rawHeaders = (res as unknown as { headers?: Record<string, string | string[] | undefined> }).headers ?? {}
        const length = Number(rawHeaders['content-length'] ?? 0)
        if (length > MAX_RESPONSE_BYTES) {
          res.stream.destroy()
          rep.code(502).send({ error: { code: 'UPSTREAM_ERROR', message: 'Respons perangkat terlalu besar.', requestId: req.id } })
          return
        }
        void service.log({
          userId,
          deviceUuid: ctx.target.uuid,
          target: ctx.resolved.ip,
          port: ctx.target.remotePort,
          result: 'ok',
          statusCode: res.statusCode ?? null,
          requestId: req.id,
        })
        rep.send(res.stream)
      },
      onError: (_rep, { error }) => {
        app.log.warn(
          { err: error, uuid: ctx.target.uuid, userId, requestId: request.id },
          'remote proxy gagal menghubungi perangkat',
        )
        void service.log({
          userId,
          deviceUuid: ctx.target.uuid,
          target: ctx.resolved.ip,
          port: ctx.target.remotePort,
          result: 'upstream_error',
          statusCode: 502,
          requestId: request.id,
        })
        _rep.code(502).send({
          error: {
            code: 'REMOTE_UNAVAILABLE',
            message: 'Perangkat tidak dapat dihubungi.',
            requestId: request.id,
          },
        })
      },
      timeout: UPSTREAM_TIMEOUT_MS,
    })
    return reply
  }

  // `hide: true` → jalur proxy tidak ikut di OpenAPI (bukan kontrak REST JSON).
  app.all('/remote/:uuid', { onRequest: gate, schema: { hide: true, params: Params } }, proxyHandler)
  app.all('/remote/:uuid/*', { onRequest: gate, schema: { hide: true, params: Params } }, proxyHandler)
}

export default routes
