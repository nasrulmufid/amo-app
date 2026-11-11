import { buildApp } from './app'
import { loadEnv } from './config/env'

/**
 * ENTRY POINT proses API. Hanya di sini `listen()` dipanggil.
 * Menangani graceful shutdown (PRD §13.5): saat menerima SIGTERM/SIGINT (mis. `docker stop`),
 * berhenti menerima koneksi baru, menyelesaikan request berjalan, menutup pool DB, lalu exit.
 */
async function main() {
  const env = loadEnv() // gagal cepat bila konfigurasi salah
  const app = await buildApp(env)

  let shuttingDown = false
  const shutdown = async (signal: string) => {
    if (shuttingDown) return
    shuttingDown = true
    app.log.info({ signal }, 'menerima sinyal, mematikan server…')
    // Paksa keluar bila penutupan menggantung > 10 dtk (Docker default menunggu 10 dtk sebelum SIGKILL).
    const force = setTimeout(() => process.exit(1), 10_000)
    force.unref()
    try {
      await app.close() // jalankan hook onClose: tutup pool DB, hentikan timer
      process.exit(0)
    } catch (err) {
      app.log.error({ err }, 'gagal menutup server dengan bersih')
      process.exit(1)
    }
  }
  process.on('SIGTERM', () => void shutdown('SIGTERM'))
  process.on('SIGINT', () => void shutdown('SIGINT'))
  process.on('unhandledRejection', (reason) => app.log.error({ err: reason }, 'unhandledRejection'))

  // 0.0.0.0 agar dapat dijangkau dari luar container Docker.
  await app.listen({ port: env.PORT, host: '0.0.0.0' })
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
