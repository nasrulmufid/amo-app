import { randomBytes, randomUUID } from 'node:crypto'
import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { CSRF_HEADER_NAME, SESSION_COOKIE_NAME, type Role } from '@amo/shared'
import { buildApp } from '../src/app'
import { hashPassword } from '../src/common/password'
import { loadEnv } from '../src/config/env'
import { SessionService } from '../src/modules/auth/session.service'

/**
 * INTEGRATION TEST — butuh MySQL yang sudah di-migrate.
 *   INTEGRATION_DATABASE_URL=mysql://amo_user:amo_password@127.0.0.1:3306/amo npm test -w @amo/api
 * Tanpa variabel itu, seluruh suite di-SKIP (CI lokal tanpa DB tetap hijau).
 * Data uji memakai email/serial acak & dibersihkan di akhir.
 */
const DB_URL = process.env.INTEGRATION_DATABASE_URL

describe.skipIf(!DB_URL)('alur sesi & RBAC (MySQL nyata)', () => {
  let app: Awaited<ReturnType<typeof buildApp>>
  const run = randomBytes(4).toString('hex')
  const PASSWORD = 'Sup3r-Secret-pass'
  const userIds: number[] = []
  const inventoryIds: number[] = []

  const emailOf = (tag: string) => `it-${tag}-${run}@example.com`

  async function createUser(tag: string, role: Role, active = true) {
    const [res] = await app.db.query<ResultSetHeader>(
      'INSERT INTO users (name, email, password_hash, role, is_active) VALUES (?, ?, ?, ?, ?)',
      [`IT ${tag}`, emailOf(tag), await hashPassword(PASSWORD), role, active ? 1 : 0],
    )
    userIds.push(res.insertId)
    return res.insertId
  }

  /** Buat sesi langsung (tanpa lewat /login) agar tidak menghabiskan rate-limit login. */
  async function sessionFor(userId: number) {
    const s = await app.sessions.create(userId, { ip: '127.0.0.1', userAgent: 'vitest' })
    return { cookies: { [SESSION_COOKIE_NAME]: s.token }, csrf: s.csrfToken, token: s.token }
  }

  beforeAll(async () => {
    app = await buildApp({ ...loadEnv(), DATABASE_URL: DB_URL! })
  })
  afterAll(async () => {
    if (inventoryIds.length) await app.db.query('DELETE FROM onu_inventory WHERE id IN (?)', [inventoryIds])
    if (userIds.length) await app.db.query('DELETE FROM users WHERE id IN (?)', [userIds])
    await app.close()
  })

  // ── Login ────────────────────────────────────────────────────────────────
  describe('POST /auth/login', () => {
    it('berhasil: cookie httpOnly+SameSite, token CSRF, tanpa password_hash, token di DB di-hash', async () => {
      const id = await createUser('login', 'operator')
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { email: emailOf('login').toUpperCase(), password: PASSWORD }, // email case-insensitive
      })
      expect(res.statusCode).toBe(200)

      const body = res.json()
      expect(body.data.user).toMatchObject({ id, role: 'operator', email: emailOf('login') })
      expect(body.data.csrfToken).toMatch(/^[a-f0-9]{64}$/)
      expect(JSON.stringify(body)).not.toMatch(/password|argon2/i)
      expect(body.meta.requestId).toMatch(/^req_/)

      const cookie = res.cookies.find((c) => c.name === SESSION_COOKIE_NAME)
      expect(cookie).toMatchObject({ httpOnly: true, sameSite: 'Lax', path: '/' })
      expect(cookie?.value).toMatch(/^[a-f0-9]{64}$/)

      // Yang tersimpan di DB = SHA-256(token), BUKAN token mentahnya.
      const [rows] = await app.db.query<RowDataPacket[]>('SELECT id FROM auth_sessions WHERE user_id = ?', [id])
      expect(rows.map((r) => r.id)).toContain(SessionService.hashToken(cookie!.value))
      expect(rows.map((r) => r.id)).not.toContain(cookie!.value)

      const [audit] = await app.db.query<RowDataPacket[]>(
        "SELECT action FROM audit_logs WHERE user_id = ? AND action = 'auth.login'", [id])
      expect(audit).toHaveLength(1)
    })

    it('gagal: password salah & email tak terdaftar → respons IDENTIK (anti user-enumeration) + audit reason', async () => {
      const id = await createUser('wrong', 'operator')
      const wrongPw = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: emailOf('wrong'), password: 'salah' } })
      const unknown = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: emailOf('ghost'), password: 'salah' } })

      expect(wrongPw.statusCode).toBe(401)
      expect(unknown.statusCode).toBe(401)
      expect(wrongPw.json().error.code).toBe('INVALID_CREDENTIALS')
      expect(wrongPw.json().error.message).toBe(unknown.json().error.message)
      expect(wrongPw.cookies).toHaveLength(0)

      const [audit] = await app.db.query<RowDataPacket[]>(
        "SELECT details FROM audit_logs WHERE action = 'auth.login_failed' AND JSON_EXTRACT(details, '$.email') = ?", [emailOf('wrong')])
      expect(audit[0]?.details.reason).toBe('bad_password')
      expect(JSON.stringify(audit[0]?.details)).not.toContain('salah') // password tidak boleh masuk audit
      expect(id).toBeGreaterThan(0)
    })

    it('akun nonaktif tidak bisa login walau password benar (pesan tetap generik)', async () => {
      await createUser('inactive', 'operator', false)
      const res = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: emailOf('inactive'), password: PASSWORD } })
      expect(res.statusCode).toBe(401)
      expect(res.json().error.code).toBe('INVALID_CREDENTIALS')
    })
  })

  // ── Sesi, CSRF, rotasi, logout ────────────────────────────────────────────
  describe('sesi & CSRF', () => {
    it('GET /auth/me dengan cookie valid → 200; tanpa/dengan cookie palsu → 401', async () => {
      const id = await createUser('me', 'viewer')
      const s = await sessionFor(id)
      const ok = await app.inject({ method: 'GET', url: '/api/v1/auth/me', cookies: s.cookies })
      expect(ok.statusCode).toBe(200)
      expect(ok.json().data.csrfToken).toBe(s.csrf)

      const fake = await app.inject({ method: 'GET', url: '/api/v1/auth/me', cookies: { [SESSION_COOKIE_NAME]: 'a'.repeat(64) } })
      expect(fake.statusCode).toBe(401)
    })

    it('POST tanpa/dengan token CSRF salah/Origin asing → 403 CSRF_INVALID; dengan token benar → lolos', async () => {
      const s = await sessionFor(await createUser('csrf', 'operator'))
      const call = (headers: Record<string, string>) =>
        app.inject({ method: 'POST', url: '/api/v1/auth/refresh', cookies: s.cookies, headers })

      expect((await call({})).json().error.code).toBe('CSRF_INVALID')
      expect((await call({ [CSRF_HEADER_NAME]: 'x'.repeat(64) })).statusCode).toBe(403)
      expect((await call({ [CSRF_HEADER_NAME]: s.csrf, origin: 'https://evil.example' })).statusCode).toBe(403)
      expect((await call({ [CSRF_HEADER_NAME]: s.csrf, origin: 'http://localhost:14500' })).statusCode).toBe(200)
    })

    it('refresh merotasi token: cookie lama langsung tidak berlaku', async () => {
      const s = await sessionFor(await createUser('rotate', 'operator'))
      const res = await app.inject({
        method: 'POST', url: '/api/v1/auth/refresh', cookies: s.cookies, headers: { [CSRF_HEADER_NAME]: s.csrf },
      })
      expect(res.statusCode).toBe(200)
      const fresh = res.cookies.find((c) => c.name === SESSION_COOKIE_NAME)!.value
      expect(fresh).not.toBe(s.token)

      expect((await app.inject({ method: 'GET', url: '/api/v1/auth/me', cookies: s.cookies })).statusCode).toBe(401)
      expect((await app.inject({ method: 'GET', url: '/api/v1/auth/me', cookies: { [SESSION_COOKIE_NAME]: fresh } })).statusCode).toBe(200)
    })

    it('logout mencabut sesi DI SERVER (cookie yang sama tak bisa dipakai lagi)', async () => {
      const s = await sessionFor(await createUser('logout', 'operator'))
      const out = await app.inject({ method: 'POST', url: '/api/v1/auth/logout', cookies: s.cookies, headers: { [CSRF_HEADER_NAME]: s.csrf } })
      expect(out.statusCode).toBe(200)
      expect(out.json().data).toEqual({ loggedOut: true })
      expect(out.cookies.find((c) => c.name === SESSION_COOKIE_NAME)?.value).toBe('') // cookie dihapus

      const replay = await app.inject({ method: 'GET', url: '/api/v1/auth/me', cookies: s.cookies })
      expect(replay.statusCode).toBe(401)
    })

    it('sesi kedaluwarsa (absolut) & idle timeout → 401 dan barisnya dibersihkan', async () => {
      const id = await createUser('expiry', 'operator')

      const expired = await sessionFor(id)
      await app.db.query('UPDATE auth_sessions SET expires_at = UTC_TIMESTAMP() - INTERVAL 1 MINUTE WHERE id = ?', [SessionService.hashToken(expired.token)])
      expect((await app.inject({ method: 'GET', url: '/api/v1/auth/me', cookies: expired.cookies })).statusCode).toBe(401)

      const idle = await sessionFor(id)
      await app.db.query('UPDATE auth_sessions SET last_seen_at = UTC_TIMESTAMP() - INTERVAL 3 HOUR WHERE id = ?', [SessionService.hashToken(idle.token)])
      expect((await app.inject({ method: 'GET', url: '/api/v1/auth/me', cookies: idle.cookies })).statusCode).toBe(401)

      const [left] = await app.db.query<RowDataPacket[]>('SELECT id FROM auth_sessions WHERE id IN (?, ?)', [SessionService.hashToken(expired.token), SessionService.hashToken(idle.token)])
      expect(left).toHaveLength(0)
    })

    it('menonaktifkan akun → sesi yang sedang berjalan langsung tidak berlaku', async () => {
      const id = await createUser('deactivate', 'operator')
      const s = await sessionFor(id)
      expect((await app.inject({ method: 'GET', url: '/api/v1/auth/me', cookies: s.cookies })).statusCode).toBe(200)
      await app.db.query('UPDATE users SET is_active = 0 WHERE id = ?', [id])
      expect((await app.inject({ method: 'GET', url: '/api/v1/auth/me', cookies: s.cookies })).statusCode).toBe(401)
    })
  })

  // ── RBAC ──────────────────────────────────────────────────────────────────
  describe('RBAC', () => {
    it('viewer: boleh dashboard, DITOLAK 403 di users/admin sync; admin lolos gerbang', async () => {
      const viewer = await sessionFor(await createUser('rbac-v', 'viewer'))
      const admin = await sessionFor(await createUser('rbac-a', 'admin'))

      expect((await app.inject({ method: 'GET', url: '/api/v1/dashboard/summary', cookies: viewer.cookies })).statusCode).toBe(200)
      expect((await app.inject({ method: 'GET', url: '/api/v1/users', cookies: viewer.cookies })).json().error.code).toBe('FORBIDDEN')
      expect((await app.inject({ method: 'POST', url: '/api/v1/admin/sync', cookies: viewer.cookies, headers: { [CSRF_HEADER_NAME]: viewer.csrf } })).statusCode).toBe(403)
      expect((await app.inject({ method: 'GET', url: '/remote/abc/', cookies: viewer.cookies })).statusCode).toBe(403) // viewer tak punya remote.open

      const adminUsers = await app.inject({ method: 'GET', url: '/api/v1/users', cookies: admin.cookies })
      expect(adminUsers.statusCode).toBe(200)
      expect(Array.isArray(adminUsers.json().data.items)).toBe(true)
    })
  })

  // ── Dashboard: angka harus cocok dengan definisi query ────────────────────
  describe('GET /dashboard/summary', () => {
    it('menghitung total/online/offline/unknown/needsData sesuai definisi (unlinked = unknown, bukan offline)', async () => {
      const s = await sessionFor(await createUser('dash', 'viewer'))
      const get = async () => (await app.inject({ method: 'GET', url: '/api/v1/dashboard/summary', cookies: s.cookies })).json().data

      const before = await get()
      const add = async (name: string, serial: string | null, lat: number | null, status: 'online' | 'offline' | null | 'stale') => {
        const [r] = await app.db.query<ResultSetHeader>(
          'INSERT INTO onu_inventory (uuid, name, serial_number, latitude, longitude) VALUES (?, ?, ?, ?, ?)',
          [randomUUID(), name, serial, lat, lat === null ? null : 104.75])
        inventoryIds.push(r.insertId)
        if (status && status !== 'stale') await app.db.query(
          `INSERT INTO onu_devices (inventory_id, genieacs_device_id, online_status, last_inform_at, last_synced_at)
           VALUES (?, ?, ?, ?, UTC_TIMESTAMP())`,
          [r.insertId, `it-${run}-${name}`, status, status === 'online' ? new Date() : new Date(Date.now() - 15 * 60_000)])
        if (status === 'stale') await app.db.query(
          `INSERT INTO onu_devices (inventory_id, genieacs_device_id, online_status, last_inform_at, last_synced_at)
           VALUES (?, ?, 'online', UTC_TIMESTAMP(), DATE_SUB(UTC_TIMESTAMP(), INTERVAL ? SECOND))`,
          [r.insertId, `it-${run}-${name}`, app.config.GENIEACS_SYNC_INTERVAL_SECONDS * 4])
      }
      await add(`A-${run}`, `SN-A-${run}`, -2.99, 'online') //   lengkap, online
      await add(`B-${run}`, `SN-B-${run}`, null, 'offline') //   tanpa koordinat, offline
      await add(`C-${run}`, null, -2.9, null) //                  tanpa serial & belum tertaut ACS → unknown
      await add(`D-${run}`, `SN-D-${run}`, -2.8, 'stale') //      sync tertinggal → tidak dihitung online

      const after = await get()
      expect(after.totals.total - before.totals.total).toBe(4)
      expect(after.totals.online - before.totals.online).toBe(1)
      expect(after.totals.offline - before.totals.offline).toBe(1)
      expect(after.totals.unknown - before.totals.unknown).toBe(1)
      expect(after.totals.stale - before.totals.stale).toBe(1)
      expect(after.totals.needsData - before.totals.needsData).toBe(2) // B (tanpa koordinat) + C (tanpa serial)
      expect(after.recent.map((r: { name: string }) => r.name)).toContain(`C-${run}`) // terbaru di atas
      expect(after.recent.find((r: { name: string }) => r.name === `D-${run}`).displayStatus).toBe('stale')
      expect(after.lastSyncedAt).not.toBeNull()
    })
  })
})
