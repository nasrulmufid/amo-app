import { Type } from '@sinclair/typebox'
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox'
import { SYNC_RUN_STATUSES, SYNC_TRIGGERS, type SyncRunStatus, type SyncTrigger } from '@amo/shared'
import { Errors } from '../../common/errors'
import { ok } from '../../common/http'
import { CommonErrors, Envelope } from '../../common/schemas'
import { SyncAlreadyRunningError } from './sync.service'

/**
 * Operasi administrator GenieACS (PRD §8, §11, §9.1).
 *
 *   POST /admin/sync          picu sinkronisasi manual (izin `sync.run`)
 *   GET  /admin/sync/status   status scheduler + run terakhir
 *   GET  /admin/sync/runs     riwayat run
 *   GET  /admin/genieacs/ping cek konektivitas NBI
 */
const SyncRunSchema = Type.Object({
  id: Type.Integer(),
  triggerType: Type.Unsafe<SyncTrigger>(Type.String({ enum: [...SYNC_TRIGGERS] })),
  triggeredBy: Type.Union([Type.Integer(), Type.Null()]),
  triggeredByName: Type.Union([Type.String(), Type.Null()]),
  startedAt: Type.String({ format: 'date-time' }),
  finishedAt: Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),
  status: Type.Unsafe<SyncRunStatus>(Type.String({ enum: [...SYNC_RUN_STATUSES] })),
  foundCount: Type.Integer(),
  successCount: Type.Integer(),
  failedCount: Type.Integer(),
  errorSummary: Type.Union([Type.String(), Type.Null()]),
})

const routes: FastifyPluginAsyncTypebox = async (app) => {
  const admin = [app.authenticate, app.requirePermission('sync.run')]

  app.post(
    '/sync',
    {
      onRequest: admin,
      // Sync manual memicu banyak request ke NBI → batasi agar tidak dijadikan DoS.
      config: { rateLimit: { max: 6, timeWindow: '1 minute' } },
      schema: {
        tags: ['admin'],
        summary: 'Picu sinkronisasi GenieACS manual',
        response: {
          200: Envelope(
            Type.Object({
              runId: Type.Integer(),
              status: Type.Unsafe<SyncRunStatus>(Type.String({ enum: [...SYNC_RUN_STATUSES] })),
              found: Type.Integer(),
              success: Type.Integer(),
              failed: Type.Integer(),
              linked: Type.Integer(),
              errorSummary: Type.Union([Type.String(), Type.Null()]),
            }),
          ),
          401: CommonErrors[401],
          403: CommonErrors[403],
          409: CommonErrors[400],
          429: CommonErrors[429],
        },
      },
    },
    async (request) => {
      try {
        const result = await app.sync.run({
          trigger: 'manual',
          userId: request.auth?.user.id ?? null,
          requestId: request.id,
        })
        await app.audit.record(request, {
          action: 'sync.run',
          resourceType: 'sync_run',
          resourceId: String(result.runId),
          details: { status: result.status, found: result.found, success: result.success, failed: result.failed },
        })
        return ok(request, result)
      } catch (err) {
        if (err instanceof SyncAlreadyRunningError) throw Errors.conflict(err.message)
        throw err
      }
    },
  )

  app.get(
    '/sync/status',
    {
      onRequest: admin,
      schema: {
        tags: ['admin'],
        summary: 'Status sinkronisasi',
        response: {
          200: Envelope(
            Type.Object({
              enabled: Type.Boolean(),
              intervalSeconds: Type.Integer(),
              onlineThresholdSeconds: Type.Integer(),
              running: Type.Boolean(),
              lastRun: Type.Union([SyncRunSchema, Type.Null()]),
              lastSyncedAt: Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),
            }),
          ),
          401: CommonErrors[401],
          403: CommonErrors[403],
        },
      },
    },
    async (request) => {
      const status = await app.sync.status()
      return ok(request, {
        enabled: app.config.GENIEACS_SYNC_INTERVAL_SECONDS > 0,
        intervalSeconds: app.config.GENIEACS_SYNC_INTERVAL_SECONDS,
        onlineThresholdSeconds: app.config.ONLINE_THRESHOLD_SECONDS,
        ...status,
      })
    },
  )

  app.get(
    '/sync/runs',
    {
      onRequest: admin,
      schema: {
        tags: ['admin'],
        summary: 'Riwayat sinkronisasi',
        querystring: Type.Object({ limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100, default: 20 })) }),
        response: {
          200: Envelope(Type.Object({ items: Type.Array(SyncRunSchema) })),
          401: CommonErrors[401],
          403: CommonErrors[403],
        },
      },
    },
    async (request) => ok(request, { items: await app.sync.runs(request.query.limit ?? 20) }),
  )

  app.get(
    '/genieacs/ping',
    {
      onRequest: admin,
      schema: {
        tags: ['admin'],
        summary: 'Cek konektivitas GenieACS NBI',
        response: {
          200: Envelope(
            Type.Object({
              ok: Type.Boolean(),
              status: Type.Optional(Type.Integer()),
              error: Type.Optional(Type.String()),
            }),
          ),
          401: CommonErrors[401],
          403: CommonErrors[403],
        },
      },
    },
    async (request) => ok(request, await app.sync.ping()),
  )
}

export default routes
