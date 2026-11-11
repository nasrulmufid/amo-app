import fp from 'fastify-plugin'
import { SyncRepository } from './sync.repository'
import { SyncService } from './sync.service'

declare module 'fastify' {
  interface FastifyInstance {
    /** Layanan sinkronisasi GenieACS (dipakai route admin & scheduler). */
    sync: SyncService
  }
}

/**
 * Plugin sinkronisasi (PRD §8.4, §11.1).
 *
 *  - Menjalankan sync berkala setiap GENIEACS_SYNC_INTERVAL_SECONDS (default 60 dtk).
 *  - TIDAK berjalan saat NODE_ENV=test (test memicu sync secara eksplisit).
 *  - Timer `unref()` agar tidak menahan proses saat shutdown; dibersihkan di onClose.
 *  - Kegagalan sync tidak pernah menjatuhkan API (error ditangkap & dilog).
 */
export default fp(
  async (app) => {
    const service = new SyncService(new SyncRepository(app.db), app.config, app.log)
    app.decorate('sync', service)

    if (app.config.NODE_ENV === 'test') return

    const intervalMs = app.config.GENIEACS_SYNC_INTERVAL_SECONDS * 1000
    const timer = setInterval(() => {
      service
        .run({ trigger: 'scheduler', userId: null, requestId: null })
        .catch((err) => {
          // SyncAlreadyRunningError bukan kegagalan — cukup debug.
          if (err instanceof Error && err.name === 'SyncAlreadyRunningError') {
            app.log.debug('sync sebelumnya masih berjalan, dilewati')
            return
          }
          app.log.warn({ err }, 'sinkronisasi terjadwal gagal')
        })
    }, intervalMs)
    timer.unref()
    app.addHook('onClose', async () => clearInterval(timer))
  },
  { name: 'sync', dependencies: ['database'] },
)
