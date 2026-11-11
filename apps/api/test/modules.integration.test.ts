import { randomBytes, randomUUID } from 'node:crypto'
import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise'
import type { LightMyRequestResponse } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { CSRF_HEADER_NAME, SESSION_COOKIE_NAME, type Role } from '@amo/shared'
import { buildApp } from '../src/app'
import { hashPassword } from '../src/common/password'
import { loadEnv } from '../src/config/env'

/**
 * INTEGRATION TEST modul inventaris, pengguna, audit, pengaturan & remote.
 *   INTEGRATION_DATABASE_URL=mysql://… npm test -w @amo/api
 * Tanpa variabel itu, seluruh suite di-SKIP.
 */
const DB_URL = process.env.INTEGRATION_DATABASE_URL

describe.skipIf(!DB_URL)('inventaris, pengguna, audit, pengaturan & remote (MySQL nyata)', () => {
  let app: Awaited<ReturnType<typeof buildApp>>
  const run = randomBytes(4).toString('hex')
  const PASSWORD = 'Sup3r-Secret-pass'
  const userIds: number[] = []
  const inventoryIds: number[] = []

  const emailOf = (tag: string) => `it2-${tag}-${run}@example.com`

  async function createUser(tag: string, role: Role) {
    const [res] = await app.db.query<ResultSetHeader>(
      'INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)',
      [`IT2 ${tag}`, emailOf(tag), await hashPassword(PASSWORD), role],
    )
    userIds.push(res.insertId)
    return res.insertId
  }

  async function sessionFor(userId: number) {
    const s = await app.sessions.create(userId, { ip: '127.0.0.1', userAgent: 'vitest' })
    return { cookies: { [SESSION_COOKIE_NAME]: s.token }, csrf: s.csrfToken }
  }

  const post = (url: string, s: { cookies: Record<string, string>; csrf: string }, payload?: object): Promise<LightMyRequestResponse> =>
    app.inject({ method: 'POST', url, cookies: s.cookies, headers: { [CSRF_HEADER_NAME]: s.csrf }, payload })
  const patch = (url: string, s: { cookies: Record<string, string>; csrf: string }, payload: object): Promise<LightMyRequestResponse> =>
    app.inject({ method: 'PATCH', url, cookies: s.cookies, headers: { [CSRF_HEADER_NAME]: s.csrf }, payload })
  const get = (url: string, s: { cookies: Record<string, string> }): Promise<LightMyRequestResponse> =>
    app.inject({ method: 'GET', url, cookies: s.cookies })

  beforeAll(async () => {
    app = await buildApp({ ...loadEnv(), DATABASE_URL: DB_URL! })
  })
  afterAll(async () => {
    if (inventoryIds.length) await app.db.query('DELETE FROM onu_inventory WHERE id IN (?)', [inventoryIds])
    if (userIds.length) await app.db.query('DELETE FROM users WHERE id IN (?)', [userIds])
    await app.close()
  })

  // ── Inventaris ────────────────────────────────────────────────────────────
  describe('inventaris', () => {
    it('POST membuat record dengan UUID dari backend; GET detail & list menemukannya', async () => {
      const s = await sessionFor(await createUser('inv', 'operator'))
      const res = await post('/api/v1/inventory', s, {
        name: `ONU-${run}`,
        serialNumber: `SN-${run}`,
        manufacturer: 'ZTE',
        model: 'F663NV3A',
        managementIp: '172.2.1.3',
        locationName: 'Gandus',
        latitude: -2.99,
        longitude: 104.75,
      })
      expect(res.statusCode).toBe(201)
      const created = res.json().data
      expect(created.uuid).toMatch(/^[0-9a-f-]{36}$/)
      expect(created.displayStatus).toBe('unknown') // belum tertaut ACS → unknown, bukan offline
      expect(created.linked).toBe(false)
      inventoryIds.push(await idOf(created.uuid))

      const detail = await app.inject({ method: 'GET', url: `/api/v1/inventory/${created.uuid}`, cookies: s.cookies })
      expect(detail.statusCode).toBe(200)
      expect(detail.json().data.name).toBe(`ONU-${run}`)

      const list = await app.inject({ method: 'GET', url: `/api/v1/inventory?q=${run}`, cookies: s.cookies })
      expect(list.statusCode).toBe(200)
      expect(list.json().data.items.map((i: { uuid: string }) => i.uuid)).toContain(created.uuid)
      expect(list.json().data.pagination.total).toBeGreaterThanOrEqual(1)
    })

    it('serial duplikat → 409 CONFLICT', async () => {
      const s = await sessionFor(await createUser('dup', 'operator'))
      const first = await post('/api/v1/inventory', s, { name: `DUP-A-${run}`, serialNumber: `DUP-${run}` })
      expect(first.statusCode).toBe(201)
      inventoryIds.push(await idOf(first.json().data.uuid))

      const second = await post('/api/v1/inventory', s, { name: `DUP-B-${run}`, serialNumber: `DUP-${run}` })
      expect(second.statusCode).toBe(409)
      expect(second.json().error.code).toBe('CONFLICT')
    })

    it('koordinat setengah / di luar rentang ditolak; port remote di luar kebijakan ditolak', async () => {
      const s = await sessionFor(await createUser('coord', 'operator'))
      expect((await post('/api/v1/inventory', s, { name: `C1-${run}`, latitude: -2.9 })).statusCode).toBe(400)
      expect((await post('/api/v1/inventory', s, { name: `C2-${run}`, latitude: 91, longitude: 104 })).statusCode).toBe(400)
      expect((await post('/api/v1/inventory', s, { name: `C3-${run}`, remotePort: 8080 })).statusCode).toBe(400)
      expect((await post('/api/v1/inventory', s, { name: `C4-${run}`, managementIp: 'evil.example' })).statusCode).toBe(400)
    })

    it('PATCH hanya mengubah metadata manual & tercatat di audit', async () => {
      const s = await sessionFor(await createUser('patch', 'operator'))
      const created = (await post('/api/v1/inventory', s, { name: `P-${run}` })).json().data
      inventoryIds.push(await idOf(created.uuid))

      const res = await patch(`/api/v1/inventory/${created.uuid}`, s, { locationName: 'Talang Kelapa', notes: 'uji' })
      expect(res.statusCode).toBe(200)
      expect(res.json().data.locationName).toBe('Talang Kelapa')

      const [audit] = await app.db.query<RowDataPacket[]>(
        "SELECT action FROM audit_logs WHERE action = 'inventory.update' AND resource_id = ?",
        [created.uuid],
      )
      expect(audit.length).toBeGreaterThanOrEqual(1)
    })

    it('GET /inventory/map hanya memuat perangkat berkoordinat valid', async () => {
      const writer = await sessionFor(await createUser('map-w', 'operator'))
      const s = await sessionFor(await createUser('map', 'viewer'))
      const withCoords = (await post('/api/v1/inventory', writer, {
        name: `MAP-A-${run}`,
        latitude: -2.98,
        longitude: 104.76,
      })).json().data
      const without = (await post('/api/v1/inventory', writer, { name: `MAP-B-${run}` })).json().data
      inventoryIds.push(await idOf(withCoords.uuid), await idOf(without.uuid))

      const res = await app.inject({ method: 'GET', url: '/api/v1/inventory/map', cookies: s.cookies })
      expect(res.statusCode).toBe(200)
      const uuids = res.json().data.items.map((i: { uuid: string }) => i.uuid)
      expect(uuids).toContain(withCoords.uuid)
      expect(uuids).not.toContain(without.uuid)
      expect(res.json().data.withoutCoordinates).toBeGreaterThanOrEqual(1)
    })

    it('viewer tidak boleh membuat inventaris (403)', async () => {
      const s = await sessionFor(await createUser('viewer-w', 'viewer'))
      expect((await post('/api/v1/inventory', s, { name: `V-${run}` })).statusCode).toBe(403)
    })
  })

  // ── Pengguna ──────────────────────────────────────────────────────────────
  describe('pengguna', () => {
    it('admin membuat pengguna; email duplikat 409; password tidak pernah keluar', async () => {
      const admin = await sessionFor(await createUser('admin-u', 'admin'))
      const res = await post('/api/v1/users', admin, {
        name: 'Operator Baru',
        email: emailOf('new'),
        password: 'password-panjang-123',
        role: 'operator',
      })
      expect(res.statusCode).toBe(201)
      expect(JSON.stringify(res.json())).not.toMatch(/password|argon2/i)
      userIds.push(res.json().data.id)

      const dup = await post('/api/v1/users', admin, {
        name: 'Operator Baru',
        email: emailOf('new'),
        password: 'password-panjang-123',
        role: 'operator',
      })
      expect(dup.statusCode).toBe(409)
    })

    it('menonaktifkan pengguna mencabut sesinya; admin terakhir tidak bisa dinonaktifkan', async () => {
      const adminId = await createUser('admin-last', 'admin')
      const admin = await sessionFor(adminId)
      const targetId = await createUser('target', 'operator')
      const target = await sessionFor(targetId)

      const res = await patch(`/api/v1/users/${targetId}`, admin, { isActive: false })
      expect(res.statusCode).toBe(200)
      expect((await app.inject({ method: 'GET', url: '/api/v1/auth/me', cookies: target.cookies })).statusCode).toBe(401)

      // Nonaktifkan diri sendiri → ditolak.
      expect((await patch(`/api/v1/users/${adminId}`, admin, { isActive: false })).statusCode).toBe(409)
    })
  })

  // ── Audit & pengaturan ────────────────────────────────────────────────────
  describe('audit & pengaturan', () => {
    it('GET /audit-logs mengembalikan item + pagination (admin)', async () => {
      const admin = await sessionFor(await createUser('audit', 'admin'))
      const res = await app.inject({ method: 'GET', url: '/api/v1/audit-logs?pageSize=5', cookies: admin.cookies })
      expect(res.statusCode).toBe(200)
      expect(Array.isArray(res.json().data.items)).toBe(true)
      expect(res.json().data.pagination.pageSize).toBe(5)
    })

    it('PATCH /settings menyimpan nilai & GET mengembalikan nilai efektif', async () => {
      const admin = await sessionFor(await createUser('settings', 'admin'))
      const res = await patch('/api/v1/settings', admin, { values: { 'ui.appName': `AMO-${run}` } })
      expect(res.statusCode).toBe(200)
      expect(res.json().data.effective.appName).toBe(`AMO-${run}`)

      const bad = await patch('/api/v1/settings', admin, { values: { 'sync.intervalSeconds': 1 } })
      expect(bad.statusCode).toBe(400)

      // Kembalikan nilai default agar test lain tidak terpengaruh.
      await patch('/api/v1/settings', admin, { values: { 'ui.appName': 'AMO' } })
    })
  })

  // ── Remote ────────────────────────────────────────────────────────────────
  describe('remote', () => {
    it('UUID asing → 404; target di luar allowlist → 403 REMOTE_TARGET_NOT_ALLOWED', async () => {
      const s = await sessionFor(await createUser('remote', 'operator'))

      const unknown = await post(`/api/v1/inventory/${randomUUID()}/remote-session`, s)
      expect(unknown.statusCode).toBe(404)

      const created = (await post('/api/v1/inventory', s, {
        name: `R-${run}`,
        managementIp: '172.2.1.3',
      })).json().data as { uuid: string }
      inventoryIds.push(await idOf(created.uuid))

      // Form login ONU harus mencapai proxy (bukan ditolak Fastify sebagai 415).
      // Target sengaja di luar allowlist test sehingga tidak ada koneksi perangkat.
      const formLogin = await app.inject({
        method: 'POST',
        url: `/remote/${created.uuid}/login.cgi`,
        cookies: s.cookies,
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: 'username=test&password=test',
      })
      expect(formLogin.statusCode).toBe(403)
      expect(formLogin.json().error.code).toBe('REMOTE_TARGET_NOT_ALLOWED')

      // REMOTE_ALLOWED_CIDRS kosong di env test → semua target ditolak.
      const denied = await post(`/api/v1/inventory/${created.uuid}/remote-session`, s)
      expect(denied.statusCode).toBe(403)
      expect(denied.json().error.code).toBe('REMOTE_TARGET_NOT_ALLOWED')
    })

    it('proxy /remote/:uuid tanpa sesi → 401; viewer → 403', async () => {
      const uuid = randomUUID()
      const anonymous = await app.inject({ method: 'GET', url: `/remote/${uuid}/` })
      expect(anonymous.statusCode).toBe(401)
      const viewer = await sessionFor(await createUser('remote-v', 'viewer'))
      const asViewer = await app.inject({ method: 'GET', url: `/remote/${uuid}/`, cookies: viewer.cookies })
      expect(asViewer.statusCode).toBe(403)
    })
  })

  async function idOf(uuid: string): Promise<number> {
    const [rows] = await app.db.query<RowDataPacket[]>('SELECT id FROM onu_inventory WHERE uuid = ?', [uuid])
    return Number(rows[0]?.id ?? 0)
  }
})
