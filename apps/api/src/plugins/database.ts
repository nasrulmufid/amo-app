import fp from 'fastify-plugin'
import { createPool, type Pool, type PoolOptions } from 'mysql2/promise'

declare module 'fastify' {
  interface FastifyInstance {
    /** Pool koneksi MySQL. Akses hanya lewat repository (jangan query di handler). */
    db: Pool
  }
}

/** Ubah DATABASE_URL (mysql://user:pass@host:port/db) menjadi opsi mysql2. */
export function poolOptionsFromUrl(databaseUrl: string, poolSize: number): PoolOptions {
  const url = new URL(databaseUrl)
  return {
    host: url.hostname,
    port: url.port ? Number(url.port) : 3306,
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: url.pathname.replace(/^\//, ''),
    connectionLimit: poolSize,
    charset: 'utf8mb4',
    // ── Penanganan waktu (PRD §8.3: simpan UTC, lokalkan hanya di UI) ──
    // 'Z' → mysql2 menganggap DATETIME dari DB = UTC & mengirim Date sebagai UTC.
    timezone: 'Z',
    // ── Tipe angka ──
    supportBigNumbers: true, // BIGINT UNSIGNED aman…
    bigNumberStrings: false, // …tetapi tetap berupa number selama < 2^53
    decimalNumbers: true, // DECIMAL (latitude/longitude, SUM) → number, bukan string
    connectTimeout: 10_000,
    enableKeepAlive: true,
  }
}

/**
 * Plugin database (dibungkus `fp` agar decorator `app.db` terlihat di semua scope).
 *
 * Catatan: pool bersifat LAZY — koneksi baru dibuka saat query pertama. Karena itu
 * API tetap bisa boot (dan /health tetap hidup) walau MySQL sedang down; hanya
 * /health/ready yang akan melapor 503.
 */
export default fp(
  async (app) => {
    const pool = createPool(poolOptionsFromUrl(app.config.DATABASE_URL, app.config.DB_POOL_SIZE))

    // Paksa zona waktu SESI MySQL ke UTC di tiap koneksi baru, supaya
    // CURRENT_TIMESTAMP / NOW() konsisten dengan nilai yang dikirim aplikasi.
    pool.on('connection', (conn) => {
      conn.query("SET time_zone = '+00:00'")
    })

    app.decorate('db', pool)
    app.addHook('onClose', async () => {
      await pool.end()
    })
  },
  { name: 'database' },
)
