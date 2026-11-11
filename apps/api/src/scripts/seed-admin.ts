import { createPool, type RowDataPacket } from 'mysql2/promise'
import { z } from 'zod'
import { hashPassword } from '../common/password'
import { loadEnv } from '../config/env'
import { poolOptionsFromUrl } from '../plugins/database'

/**
 * Membuat akun administrator awal dari SEED_ADMIN_* di .env.
 * Idempoten: bila email sudah ada → tidak melakukan apa pun (tidak menimpa password).
 * Jalankan: `npm run db:seed` (setelah `npm run db:migrate`).
 */
async function main() {
  const env = loadEnv()
  const input = z
    .object({
      name: z.string().min(1).max(120),
      email: z.email().max(190),
      password: z.string().min(env.NODE_ENV === 'production' ? 12 : 8, 'password admin terlalu pendek').max(200),
    })
    .parse({
      name: process.env.SEED_ADMIN_NAME ?? 'Administrator',
      email: process.env.SEED_ADMIN_EMAIL,
      password: process.env.SEED_ADMIN_PASSWORD,
    })
  const email = input.email.trim().toLowerCase()

  const db = createPool(poolOptionsFromUrl(env.DATABASE_URL, 2))
  try {
    const [existing] = await db.query<RowDataPacket[]>('SELECT id FROM users WHERE email = ? LIMIT 1', [email])
    if (existing.length > 0) {
      console.log(`• admin ${email} sudah ada — dilewati`)
      return
    }
    await db.query("INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, 'admin')", [
      input.name,
      email,
      await hashPassword(input.password),
    ])
    console.log(`✓ admin dibuat: ${email}  → segera ganti password setelah login pertama`)
  } finally {
    await db.end()
  }
}

main().catch((err) => {
  console.error('✗ seed gagal:', err instanceof Error ? err.message : err)
  process.exit(1)
})
