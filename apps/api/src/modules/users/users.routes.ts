import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox'
import { Errors } from '../../common/errors'
import { ok } from '../../common/http'
import { CommonErrors, Envelope } from '../../common/schemas'
import { SessionsRepository } from '../auth/sessions.repository'
import { UsersRepository } from './users.repository'
import { UserCreateBody, UserIdParams, UserItemSchema, UserListQuery, UserListResponse, UserUpdateBody } from './users.schema'
import { UsersService } from './users.service'

/**
 * Manajemen pengguna (PRD §2, §9.1) — admin saja.
 *
 *   GET   /users        daftar pengguna (paginasi + filter)
 *   POST  /users        buat pengguna
 *   PATCH /users/:id    ubah nama/email/role/status/password
 *
 * Respons TIDAK PERNAH memuat password_hash (schema response memfilter).
 */
const routes: FastifyPluginAsyncTypebox = async (app) => {
  const service = new UsersService(new UsersRepository(app.db), new SessionsRepository(app.db), app.config)
  const admin = [app.authenticate, app.requirePermission('users.manage')]

  app.get(
    '/',
    {
      onRequest: admin,
      schema: {
        tags: ['users'],
        summary: 'Daftar pengguna',
        querystring: UserListQuery,
        response: {
          200: Envelope(UserListResponse),
          400: CommonErrors[400],
          401: CommonErrors[401],
          403: CommonErrors[403],
        },
      },
    },
    async (request) => ok(request, await service.list(request.query)),
  )

  app.post(
    '/',
    {
      onRequest: admin,
      schema: {
        tags: ['users'],
        summary: 'Buat pengguna',
        body: UserCreateBody,
        response: {
          201: Envelope(UserItemSchema),
          400: CommonErrors[400],
          401: CommonErrors[401],
          403: CommonErrors[403],
          409: CommonErrors[400],
        },
      },
    },
    async (request, reply) => {
      const created = await service.create(request.body)
      await app.audit.record(request, {
        action: 'user.create',
        resourceType: 'user',
        resourceId: String(created.id),
        details: { email: created.email, role: created.role },
      })
      return reply.code(201).send(ok(request, created))
    },
  )

  app.patch(
    '/:id',
    {
      onRequest: admin,
      schema: {
        tags: ['users'],
        summary: 'Ubah pengguna / role',
        params: UserIdParams,
        body: UserUpdateBody,
        response: {
          200: Envelope(UserItemSchema),
          400: CommonErrors[400],
          401: CommonErrors[401],
          403: CommonErrors[403],
          404: CommonErrors[404],
          409: CommonErrors[400],
        },
      },
    },
    async (request) => {
      const actorId = request.auth?.user.id
      if (!actorId) throw Errors.authRequired()
      const updated = await service.update(request.params.id, request.body, actorId)
      await app.audit.record(request, {
        action: 'user.update',
        resourceType: 'user',
        resourceId: String(updated.id),
        // Password TIDAK pernah masuk details (redaksi otomatis juga menangkapnya).
        details: { fields: Object.keys(request.body), role: updated.role, isActive: updated.isActive },
      })
      return ok(request, updated)
    },
  )
}

export default routes
