import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { SESSION_COOKIE_NAME } from '@amo/shared'
import { makeApp } from './helpers'

/**
 * Menguji GERBANG autentikasi & validasi — semuanya ditolak SEBELUM menyentuh DB,
 * jadi test ini berjalan tanpa MySQL. (Test alur login penuh = integration test
 * dengan DB nyata; lihat docs/ROADMAP.md Sprint 5.)
 */
describe('guard autentikasi', () => {
  let app: Awaited<ReturnType<typeof makeApp>>
  beforeAll(async () => { app = await makeApp() })
  afterAll(async () => { await app.close() })

  const protectedRoutes: Array<[string, string]> = [
    ['GET', '/api/v1/auth/me'],
    ['GET', '/api/v1/dashboard/summary'],
    ['GET', '/api/v1/inventory'],
    ['GET', '/api/v1/users'],
    ['GET', '/api/v1/audit-logs'],
    ['POST', '/api/v1/admin/sync'],
    ['GET', '/remote/11111111-1111-4111-8111-111111111111/'],
  ]

  it.each(protectedRoutes)('%s %s tanpa sesi → 401 AUTH_REQUIRED', async (method, url) => {
    const res = await app.inject({ method: method as 'GET' | 'POST', url })
    expect(res.statusCode).toBe(401)
    expect(res.json().error.code).toBe('AUTH_REQUIRED')
  })

  it('cookie sesi berformat sampah ditolak tanpa query DB', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      cookies: { [SESSION_COOKIE_NAME]: 'bukan-token-valid' },
    })
    expect(res.statusCode).toBe(401)
  })

  it('POST /auth/login dengan body tidak valid → 400 VALIDATION_ERROR', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: 'bukan-email' } })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe('VALIDATION_ERROR')
  })
})

describe('rate limit login', () => {
  // App TERSENDIRI: counter rate-limit tersimpan per instance, sehingga tidak
  // tercemar oleh request login dari test lain.
  it('10 request/menit/IP diizinkan, berikutnya 429 RATE_LIMITED', async () => {
    const app = await makeApp()
    try {
      const codes: number[] = []
      for (let i = 0; i < 12; i++) {
        const res = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: 'bukan-email' } })
        codes.push(res.statusCode)
      }
      expect(codes.slice(0, 10).every((c) => c === 400)).toBe(true)
      expect(codes.slice(10)).toEqual([429, 429])

      const blocked = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: 'bukan-email' } })
      expect(blocked.json().error.code).toBe('RATE_LIMITED') // format error PRD §9.3
    } finally {
      await app.close()
    }
  })
})
