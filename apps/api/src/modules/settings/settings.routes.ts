import { Type } from '@sinclair/typebox'
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox'
import { REMOTE_SCHEMES, type RemoteScheme } from '@amo/shared'
import { ok } from '../../common/http'
import { CommonErrors, Envelope } from '../../common/schemas'
import { SettingsRepository } from './settings.repository'
import {
  ParameterMapCreateBody,
  ParameterMapIdParams,
  ParameterMapSchema,
  ParameterMapUpdateBody,
  SettingsUpdateBody,
} from './settings.schema'
import { SettingsService } from './settings.service'

/**
 * Pengaturan aplikasi (PRD §7.6, §8.3) — admin saja.
 *
 *   GET    /settings                    nilai tersimpan + nilai efektif + kebijakan remote
 *   PATCH  /settings                    ubah nilai (divalidasi per kunci)
 *   GET    /settings/parameter-map      pemetaan field → path parameter GenieACS
 *   POST   /settings/parameter-map      tambah pemetaan
 *   PATCH  /settings/parameter-map/:id  ubah pemetaan
 *   DELETE /settings/parameter-map/:id  hapus pemetaan
 */
const SettingsResponse = Type.Object({
  values: Type.Record(Type.String(), Type.Unknown()),
  effective: Type.Object({
    syncIntervalSeconds: Type.Integer(),
    onlineThresholdSeconds: Type.Integer(),
    syncEnabled: Type.Boolean(),
    autoCreateInventory: Type.Boolean(),
    appName: Type.String(),
    auditRetentionDays: Type.Integer(),
  }),
  remotePolicy: Type.Object({
    allowedPorts: Type.Array(Type.Integer()),
    allowedSchemes: Type.Array(Type.Unsafe<RemoteScheme>(Type.String({ enum: [...REMOTE_SCHEMES] }))),
    allowedCidrs: Type.Array(Type.String()),
  }),
})

const routes: FastifyPluginAsyncTypebox = async (app) => {
  const service = new SettingsService(new SettingsRepository(app.db), app.config)
  const admin = [app.authenticate, app.requirePermission('settings.manage')]

  app.get(
    '/',
    {
      onRequest: admin,
      schema: {
        tags: ['settings'],
        summary: 'Baca pengaturan aplikasi',
        response: { 200: Envelope(SettingsResponse), 401: CommonErrors[401], 403: CommonErrors[403] },
      },
    },
    async (request) => ok(request, await service.get()),
  )

  app.patch(
    '/',
    {
      onRequest: admin,
      schema: {
        tags: ['settings'],
        summary: 'Ubah pengaturan aplikasi',
        body: SettingsUpdateBody,
        response: {
          200: Envelope(SettingsResponse),
          400: CommonErrors[400],
          401: CommonErrors[401],
          403: CommonErrors[403],
        },
      },
    },
    async (request) => {
      const userId = request.auth?.user.id ?? null
      const updated = await service.update(request.body.values, userId)
      await app.audit.record(request, {
        action: 'settings.update',
        resourceType: 'app_settings',
        details: { keys: Object.keys(request.body.values) },
      })
      return ok(request, updated)
    },
  )

  app.get(
    '/parameter-map',
    {
      onRequest: admin,
      schema: {
        tags: ['settings'],
        summary: 'Daftar pemetaan parameter GenieACS',
        response: {
          200: Envelope(Type.Object({ items: Type.Array(ParameterMapSchema) })),
          401: CommonErrors[401],
          403: CommonErrors[403],
        },
      },
    },
    async (request) => ok(request, { items: await service.listParameterMap() }),
  )

  app.post(
    '/parameter-map',
    {
      onRequest: admin,
      schema: {
        tags: ['settings'],
        summary: 'Tambah pemetaan parameter GenieACS',
        body: ParameterMapCreateBody,
        response: {
          201: Envelope(ParameterMapSchema),
          400: CommonErrors[400],
          401: CommonErrors[401],
          403: CommonErrors[403],
        },
      },
    },
    async (request, reply) => {
      const created = await service.createParameterMap(request.body)
      await app.audit.record(request, {
        action: 'settings.update',
        resourceType: 'device_parameter_map',
        resourceId: String(created.id),
        details: { fieldKey: created.fieldKey, paramPath: created.paramPath },
      })
      return reply.code(201).send(ok(request, created))
    },
  )

  app.patch(
    '/parameter-map/:id',
    {
      onRequest: admin,
      schema: {
        tags: ['settings'],
        summary: 'Ubah pemetaan parameter GenieACS',
        params: ParameterMapIdParams,
        body: ParameterMapUpdateBody,
        response: {
          200: Envelope(ParameterMapSchema),
          400: CommonErrors[400],
          401: CommonErrors[401],
          403: CommonErrors[403],
          404: CommonErrors[404],
        },
      },
    },
    async (request) => {
      const updated = await service.updateParameterMap(request.params.id, request.body)
      await app.audit.record(request, {
        action: 'settings.update',
        resourceType: 'device_parameter_map',
        resourceId: String(updated.id),
        details: { fields: Object.keys(request.body) },
      })
      return ok(request, updated)
    },
  )

  app.delete(
    '/parameter-map/:id',
    {
      onRequest: admin,
      schema: {
        tags: ['settings'],
        summary: 'Hapus pemetaan parameter GenieACS',
        params: ParameterMapIdParams,
        response: {
          200: Envelope(Type.Object({ deleted: Type.Boolean() })),
          401: CommonErrors[401],
          403: CommonErrors[403],
          404: CommonErrors[404],
        },
      },
    },
    async (request) => {
      await service.deleteParameterMap(request.params.id)
      await app.audit.record(request, {
        action: 'settings.update',
        resourceType: 'device_parameter_map',
        resourceId: String(request.params.id),
        details: { deleted: true },
      })
      return ok(request, { deleted: true })
    },
  )
}

export default routes
