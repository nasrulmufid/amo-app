import fp from 'fastify-plugin'
import { AuditRepository } from './audit.repository'
import { AuditService } from './audit.service'

declare module 'fastify' {
  interface FastifyInstance {
    /** Pencatat audit log. Pemakaian: `await app.audit.record(request, { action: 'auth.login' })` */
    audit: AuditService
  }
}

/** Retensi default bila `audit.retentionDays` belum diatur di app_settings. */
const DEFAULT_RETENTION_DAYS = 365
/** Jalankan pembersihan sekali sehari. */
const RETENTION_INTERVAL_MS = 24 * 60 * 60 * 1000

export default fp(
  async (app) => {
    const repo = new AuditRepository(app.db)
    app.decorate('audit', new AuditService(repo, app.log))

    // Job retensi (PRD §3.5 "sesuai kebijakan retensi"). Tidak berjalan saat test.
    if (app.config.NODE_ENV === 'test') return

    const purge = async () => {
      try {
        const [rows] = await app.db.query<import('mysql2/promise').RowDataPacket[]>(
          "SELECT value_json FROM app_settings WHERE `key` = 'audit.retentionDays' LIMIT 1",
        )
        const raw = rows[0]?.value_json
        const parsed = typeof raw === 'string' ? Number(JSON.parse(raw)) : Number(raw)
        const days = Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_RETENTION_DAYS
        const deleted = await repo.deleteOlderThan(days)
        if (deleted > 0) app.log.info({ deleted, days }, 'audit log lama dihapus sesuai retensi')
      } catch (err) {
        app.log.warn({ err }, 'gagal menjalankan retensi audit log')
      }
    }

    const timer = setInterval(() => void purge(), RETENTION_INTERVAL_MS)
    timer.unref()
    app.addHook('onClose', async () => clearInterval(timer))
  },
  { name: 'audit', dependencies: ['database'] },
)
