import fp from 'fastify-plugin'
import { SettingsRepository } from '../settings/settings.repository'
import { SyncRepository } from './sync.repository'
import { SyncService } from './sync.service'
import { resolveSyncRuntimeConfig, type SyncRuntimeConfig } from './sync.config'

declare module 'fastify' {
  interface FastifyInstance {
    /** Layanan sinkronisasi GenieACS (dipakai route admin & scheduler). */
    sync: SyncService
    /** Runtime scheduler control (interval/enable settings take effect without restarting). */
    syncScheduler: {
      getConfig: () => Promise<SyncRuntimeConfig>
      refresh: () => Promise<void>
    }
  }
}

/**
 * Plugin sinkronisasi (PRD §8.4, §11.1).
 *
 *  - Sync pertama dijalankan saat boot, berikutnya memakai pengaturan aplikasi.
 *  - Interval & sakelar aktif dibaca dari app_settings; fallback ke environment.
 *  - TIDAK berjalan saat NODE_ENV=test (test memicu sync secara eksplisit).
 *  - Timer `unref()` agar tidak menahan proses saat shutdown; dibersihkan di onClose.
 *  - Kegagalan sync tidak pernah menjatuhkan API (error ditangkap & dilog).
 */
export default fp(
  async (app) => {
    const settings = new SettingsRepository(app.db)
    const service = new SyncService(
      new SyncRepository(app.db),
      app.config,
      app.log,
      settings,
    )
    app.decorate('sync', service)

    const getConfig = async () => resolveSyncRuntimeConfig(await settings.getValues(), app.config)
    let timer: NodeJS.Timeout | undefined
    let closed = false
    let scheduleRevision = 0

    const schedule = (delayMs: number, runNow = false) => {
      if (closed) return
      scheduleRevision++
      if (timer) clearTimeout(timer)
      if (runNow) {
        void tick()
        return
      }
      timer = setTimeout(() => void tick(), delayMs)
      timer.unref()
    }

    const tick = async () => {
      const currentRevision = scheduleRevision
      timer = undefined
      if (closed) return
      let config: SyncRuntimeConfig
      try {
        config = await getConfig()
      } catch (err) {
        app.log.warn({ err }, 'gagal membaca pengaturan scheduler GenieACS; memakai nilai environment')
        config = resolveSyncRuntimeConfig({}, app.config)
      }

      if (config.enabled) {
        try {
          await service.run({ trigger: 'scheduler', userId: null, requestId: null })
        } catch (err) {
          if (err instanceof Error && err.name === 'SyncAlreadyRunningError') {
            app.log.debug('sync sebelumnya masih berjalan, dilewati')
          } else {
            app.log.warn({ err }, 'sinkronisasi terjadwal gagal')
          }
        }
      } else {
        app.log.debug('sinkronisasi otomatis GenieACS dinonaktifkan')
      }

      // Settings may change while a long sync is running; honor the timer set by refresh().
      if (!closed && scheduleRevision === currentRevision) schedule(config.intervalSeconds * 1000)
    }

    const refresh = async () => {
      const config = await getConfig()
      schedule(config.intervalSeconds * 1000)
    }

    app.decorate('syncScheduler', { getConfig, refresh })
    if (app.config.NODE_ENV !== 'test') schedule(0, true)
    app.addHook('onClose', async () => {
      closed = true
      if (timer) clearTimeout(timer)
    })
  },
  { name: 'sync', dependencies: ['database'] },
)
