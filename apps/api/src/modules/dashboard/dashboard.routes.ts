import { Type } from '@sinclair/typebox'
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox'
import { DEVICE_DISPLAY_STATUSES, type DeviceDisplayStatus } from '@amo/shared'
import { ok } from '../../common/http'
import { CommonErrors, Envelope } from '../../common/schemas'
import { DashboardRepository } from './dashboard.repository'
import { DashboardService } from './dashboard.service'

const DeviceRow = Type.Object({
  uuid: Type.String(),
  name: Type.String(),
  serialNumber: Type.Union([Type.String(), Type.Null()]),
  manufacturer: Type.Union([Type.String(), Type.Null()]),
  model: Type.Union([Type.String(), Type.Null()]),
  displayStatus: Type.Unsafe<DeviceDisplayStatus>(Type.String({ enum: [...DEVICE_DISPLAY_STATUSES] })),
  lastSyncedAt: Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),
})

const SummaryResponse = Type.Object({
  totals: Type.Object({
    total: Type.Integer(),
    online: Type.Integer(),
    offline: Type.Integer(),
    unknown: Type.Integer(),
    stale: Type.Integer(),
    syncError: Type.Integer(),
    needsData: Type.Integer(),
  }),
  recent: Type.Array(DeviceRow),
  lastSyncedAt: Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),
})

/**
 * ✅ CONTOH REFERENSI "vertical slice" — salin pola ini untuk modul baru:
 *    route (validasi + otorisasi + format) → service (logika) → repository (SQL).
 */
const routes: FastifyPluginAsyncTypebox = async (app) => {
  const service = new DashboardService(new DashboardRepository(app.db), app.config)

  app.get(
    '/summary',
    {
      // Urutan penting: authenticate DULU, baru requirePermission.
      onRequest: [app.authenticate, app.requirePermission('dashboard.read')],
      schema: {
        tags: ['dashboard'],
        summary: 'Statistik dashboard',
        response: { 200: Envelope(SummaryResponse), 401: CommonErrors[401], 403: CommonErrors[403] },
      },
    },
    async (request) => ok(request, await service.getSummary()),
  )
}

export default routes
