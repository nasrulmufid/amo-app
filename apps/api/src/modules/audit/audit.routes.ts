import { Type, type Static } from '@sinclair/typebox'
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox'
import { AUDIT_ACTIONS } from '@amo/shared'
import { ok } from '../../common/http'
import { CommonErrors, Envelope, PaginationQuery } from '../../common/schemas'
import { AuditRepository } from './audit.repository'

/**
 * Audit log (PRD §9.1, §16) — role dengan izin `audit.read`.
 *
 *   GET /audit-logs   daftar dengan filter user/aksi/resource/rentang waktu + pagination
 *
 * `details` sudah diredaksi saat DITULIS (audit.service.ts), jadi aman ditampilkan.
 */
const AuditListQuery = Type.Intersect([
  PaginationQuery,
  Type.Object({
    userId: Type.Optional(Type.Integer({ minimum: 1 })),
    action: Type.Optional(Type.Unsafe<string>(Type.String({ enum: [...AUDIT_ACTIONS] }))),
    resourceType: Type.Optional(Type.String({ maxLength: 100 })),
    resourceId: Type.Optional(Type.String({ maxLength: 190 })),
    from: Type.Optional(Type.String({ format: 'date-time' })),
    to: Type.Optional(Type.String({ format: 'date-time' })),
  }),
])
type AuditListQuery = Static<typeof AuditListQuery>

const AuditLogSchema = Type.Object({
  id: Type.Integer(),
  userId: Type.Union([Type.Integer(), Type.Null()]),
  userName: Type.Union([Type.String(), Type.Null()]),
  action: Type.String(),
  resourceType: Type.Union([Type.String(), Type.Null()]),
  resourceId: Type.Union([Type.String(), Type.Null()]),
  ipAddress: Type.Union([Type.String(), Type.Null()]),
  userAgent: Type.Union([Type.String(), Type.Null()]),
  requestId: Type.Union([Type.String(), Type.Null()]),
  details: Type.Union([Type.Unknown(), Type.Null()]),
  createdAt: Type.String({ format: 'date-time' }),
})

const AuditListResponse = Type.Object({
  items: Type.Array(AuditLogSchema),
  pagination: Type.Object({
    page: Type.Integer(),
    pageSize: Type.Integer(),
    total: Type.Integer(),
    totalPages: Type.Integer(),
  }),
})

const routes: FastifyPluginAsyncTypebox = async (app) => {
  const repo = new AuditRepository(app.db)

  app.get(
    '/',
    {
      onRequest: [app.authenticate, app.requirePermission('audit.read')],
      schema: {
        tags: ['audit'],
        summary: 'Daftar audit log',
        querystring: AuditListQuery,
        response: {
          200: Envelope(AuditListResponse),
          400: CommonErrors[400],
          401: CommonErrors[401],
          403: CommonErrors[403],
        },
      },
    },
    async (request) => {
      const q = request.query
      const { rows, total } = await repo.list({
        page: q.page,
        pageSize: q.pageSize,
        userId: q.userId,
        action: q.action,
        resourceType: q.resourceType,
        resourceId: q.resourceId,
        from: q.from ? new Date(q.from) : undefined,
        to: q.to ? new Date(q.to) : undefined,
      })
      return ok(request, {
        items: rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })),
        pagination: {
          page: q.page,
          pageSize: q.pageSize,
          total,
          totalPages: Math.ceil(total / q.pageSize),
        },
      })
    },
  )
}

export default routes
