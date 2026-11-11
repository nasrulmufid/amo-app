import { createHash } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { createConnection, type RowDataPacket } from 'mysql2/promise'
import { loadEnv } from '../config/env'
import { poolOptionsFromUrl } from '../plugins/database'

/**
 * Migration runner sederhana (tanpa ORM) — PRD §6: "migration wajib versioned dan
 * dapat dijalankan ulang secara aman".
 *
 * Cara kerja:
 *  - Membaca database/migrations/NNN_nama.sql, mengurutkan, menjalankan yang belum tercatat
 *    di tabel `schema_migrations`.
 *  - Menyimpan CHECKSUM tiap file. Bila file yang sudah diterapkan DIUBAH → berhenti dengan
 *    error (aturan: jangan edit migration lama; buat file baru).
 *  - `GET_LOCK` mencegah dua proses (mis. 2 replika API) memigrasi bersamaan.
 *
 * Jalankan: `npm run db:migrate`  (di Docker dijalankan otomatis sebelum API start).
 */
const MIGRATIONS_DIR =
  process.env.MIGRATIONS_DIR ?? path.resolve(import.meta.dirname, '../../../../database/migrations')

interface AppliedRow extends RowDataPacket {
  version: string
  checksum: string
}

async function main() {
  const env = loadEnv()
  const conn = await createConnection({
    ...poolOptionsFromUrl(env.DATABASE_URL, 1),
    multipleStatements: true, // satu file .sql berisi banyak statement
  })

  try {
    await conn.query("SET time_zone = '+00:00'")
    const [lockRows] = await conn.query<RowDataPacket[]>("SELECT GET_LOCK('amo_migrate', 60) AS got")
    if (lockRows[0]?.got !== 1) throw new Error('Tidak dapat memperoleh lock migrasi (proses lain sedang berjalan?)')

    await conn.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version    VARCHAR(190) NOT NULL PRIMARY KEY,
        checksum   CHAR(64) NOT NULL,
        applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`)

    const [appliedRows] = await conn.query<AppliedRow[]>('SELECT version, checksum FROM schema_migrations')
    const applied = new Map(appliedRows.map((r) => [r.version, r.checksum]))

    const files = (await readdir(MIGRATIONS_DIR)).filter((f) => /^\d+_.+\.sql$/.test(f)).sort()
    if (files.length === 0) throw new Error(`Tidak ada file migration di ${MIGRATIONS_DIR}`)

    let ran = 0
    for (const file of files) {
      const sql = await readFile(path.join(MIGRATIONS_DIR, file), 'utf8')
      const checksum = createHash('sha256').update(sql).digest('hex')
      const previous = applied.get(file)

      if (previous) {
        if (previous !== checksum) {
          throw new Error(`Migration ${file} sudah diterapkan tetapi isinya berubah. Jangan edit migration lama — buat file baru.`)
        }
        continue
      }

      console.log(`→ menerapkan ${file}`)
      await conn.query(sql)
      await conn.query('INSERT INTO schema_migrations (version, checksum) VALUES (?, ?)', [file, checksum])
      ran++
    }
    console.log(ran === 0 ? '✓ database sudah up-to-date' : `✓ ${ran} migration diterapkan`)
  } finally {
    await conn.query("SELECT RELEASE_LOCK('amo_migrate')").catch(() => undefined)
    await conn.end()
  }
}

main().catch((err) => {
  console.error('✗ migrasi gagal:', err instanceof Error ? err.message : err)
  process.exit(1)
})
