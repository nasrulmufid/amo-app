import { Type } from '@sinclair/typebox'
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox'
import { ONLINE_STATUSES, type OnlineStatus } from '@amo/shared'
import { ok } from '../../common/http'
import { CommonErrors, Envelope } from '../../common/schemas'
import { InventoryRepository } from './inventory.repository'
import {
  InventoryCreateBody,
  InventoryDetailSchema,
  InventoryListQuery,
  InventoryListResponse,
  InventoryMapResponse,
  InventoryUpdateBody,
  InventoryUuidParams,
} from './inventory.schema'
import { InventoryService } from './inventory.service'

/**
 * Inventaris ONU (PRD §3.3, §3.4, §9.1).
 *
 *   GET    /inventory            daftar + search/filter/sort/pagination (server-side)
 *   GET    /inventory/facets     pilihan vendor/model untuk filter
 *   POST   /inventory            buat record / tautkan perangkat
 *   GET    /inventory/map        perangkat berkoordinat valid
 *   GET    /inventory/:uuid      detail ONU
 *   PATCH  /inventory/:uuid      ubah metadata manual
 *
 * ⚠ Rute statis (`/facets`, `/map`) didaftarkan SEBELUM `/:uuid`.
 */
const routes: FastifyPluginAsyncTypebox = async (app) => {
  const service = new InventoryService(new InventoryRepository(app.db), app.config)
  const read = [app.authenticate, app.requirePermission('inventory.read')]
  const write = [app.authenticate, app.requirePermission('inventory.write')]

  app.get(
    '/',
    {
      onRequest: read,
      schema: {
        tags: ['inventory'],
        summary: 'Cari & paginasi inventaris ONU',
        querystring: InventoryListQuery,
        response: {
          200: Envelope(InventoryListResponse),
          400: CommonErrors[400],
          401: CommonErrors[401],
          403: CommonErrors[403],
        },
      },
    },
    async (request) => ok(request, await service.list(request.query)),
  )

  app.get(
    '/facets',
    {
      onRequest: read,
      schema: {
        tags: ['inventory'],
        summary: 'Pilihan vendor & model untuk filter',
        response: {
          200: Envelope(
            Type.Object({ manufacturers: Type.Array(Type.String()), models: Type.Array(Type.String()) }),
          ),
          401: CommonErrors[401],
          403: CommonErrors[403],
        },
      },
    },
    async (request) => ok(request, await service.facets()),
  )

  // Rute statis: DAFTARKAN SEBELUM /:uuid agar tidak tertelan param.
  app.get(
    '/acs-unlinked',
    {
      onRequest: read,
      schema: {
        tags: ['inventory'],
        summary: 'Perangkat ACS (hasil sync) yang belum tertaut ke inventaris',
        response: {
          200: Envelope(
            Type.Object({
              items: Type.Array(
                Type.Object({
                  id: Type.Integer(),
                  genieacsDeviceId: Type.String(),
                  serialNumber: Type.Union([Type.String(), Type.Null()]),
                  manufacturer: Type.Union([Type.String(), Type.Null()]),
                  model: Type.Union([Type.String(), Type.Null()]),
                  onlineStatus: Type.Unsafe<OnlineStatus>(Type.String({ enum: [...ONLINE_STATUSES] })),
                  lastInformAt: Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),
                  lastSyncedAt: Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),
                }),
              ),
            }),
          ),
          401: CommonErrors[401],
          403: CommonErrors[403],
        },
      },
    },
    async (request) => ok(request, await service.listUnlinkedDevices()),
  )

  app.post(
    '/',
    {
      onRequest: write,
      schema: {
        tags: ['inventory'],
        summary: 'Buat record inventaris / tautkan perangkat',
        body: InventoryCreateBody,
        response: {
          201: Envelope(InventoryDetailSchema),
          400: CommonErrors[400],
          401: CommonErrors[401],
          403: CommonErrors[403],
          409: CommonErrors[400],
        },
      },
    },
    async (request, reply) => {
      const created = await service.create(request.body, request.auth?.user.id ?? null)
      await app.audit.record(request, {
        action: 'inventory.create',
        resourceType: 'onu_inventory',
        resourceId: created.uuid,
        details: { name: created.name, serialNumber: created.serialNumber },
      })
      return reply.code(201).send(ok(request, created))
    },
  )

  app.get(
    '/map',
    {
      onRequest: read,
      schema: {
        tags: ['inventory'],
        summary: 'Perangkat berkoordinat valid untuk peta',
        response: {
          200: Envelope(InventoryMapResponse),
          401: CommonErrors[401],
          403: CommonErrors[403],
        },
      },
    },
    async (request) => ok(request, await service.map()),
  )

  app.get(
    '/:uuid',
    {
      onRequest: read,
      schema: {
        tags: ['inventory'],
        summary: 'Detail ONU berdasarkan UUID',
        params: InventoryUuidParams,
        response: {
          200: Envelope(InventoryDetailSchema),
          401: CommonErrors[401],
          403: CommonErrors[403],
          404: CommonErrors[404],
        },
      },
    },
    async (request) => ok(request, await service.getByUuid(request.params.uuid)),
  )

  app.patch(
    '/:uuid',
    {
      onRequest: write,
      schema: {
        tags: ['inventory'],
        summary: 'Perbarui metadata inventaris',
        params: InventoryUuidParams,
        body: InventoryUpdateBody,
        response: {
          200: Envelope(InventoryDetailSchema),
          400: CommonErrors[400],
          401: CommonErrors[401],
          403: CommonErrors[403],
          404: CommonErrors[404],
        },
      },
    },
    async (request) => {
      const updated = await service.update(request.params.uuid, request.body)
      // Perubahan target remote (IP/port/skema) adalah kejadian keamanan → catat eksplisit.
      const targetChanged =
        'managementIp' in request.body || 'remotePort' in request.body || 'remoteScheme' in request.body
      await app.audit.record(request, {
        action: 'inventory.update',
        resourceType: 'onu_inventory',
        resourceId: updated.uuid,
        details: {
          fields: Object.keys(request.body),
          ...(targetChanged
            ? { remoteTarget: `${updated.remoteScheme}://${updated.managementIp ?? '-'}:${updated.remotePort}` }
            : {}),
        },
      })
      return ok(request, updated)
    },
  )
}

export default routes
