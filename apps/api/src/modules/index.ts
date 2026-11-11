import type { FastifyPluginAsync } from 'fastify'
import auditRoutes from './audit/audit.routes'
import authRoutes from './auth/auth.routes'
import dashboardRoutes from './dashboard/dashboard.routes'
import genieacsRoutes from './genieacs/genieacs.routes'
import inventoryRoutes from './inventory/inventory.routes'
import settingsRoutes from './settings/settings.routes'
import usersRoutes from './users/users.routes'

/**
 * Semua endpoint REST di bawah /api/v1 (PRD §9).
 * Menambah modul baru = buat folder di modules/ lalu daftarkan satu baris di sini.
 */
export const apiV1: FastifyPluginAsync = async (app) => {
  await app.register(authRoutes, { prefix: '/auth' })
  await app.register(dashboardRoutes, { prefix: '/dashboard' })
  await app.register(inventoryRoutes, { prefix: '/inventory' })
  await app.register(usersRoutes, { prefix: '/users' })
  await app.register(auditRoutes, { prefix: '/audit-logs' })
  await app.register(settingsRoutes, { prefix: '/settings' })
  await app.register(genieacsRoutes, { prefix: '/admin' })
}
