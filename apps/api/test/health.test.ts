import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { makeApp } from './helpers'

describe('health & envelope dasar', () => {
  let app: Awaited<ReturnType<typeof makeApp>>
  beforeAll(async () => { app = await makeApp() })
  afterAll(async () => { await app.close() })

  it('GET /health → 200 tanpa autentikasi & tanpa DB', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ status: 'ok' })
  })

  it('menyertakan header x-request-id yang dibuat server', async () => {
    const res = await app.inject({ method: 'GET', url: '/health', headers: { 'x-request-id': 'dari-klien' } })
    expect(res.headers['x-request-id']).toMatch(/^req_[a-f0-9]{16}$/)
  })

  it('route tak dikenal → 404 dengan format error PRD §9.3', async () => {
    const res = await app.inject({ method: 'GET', url: '/tidak/ada' })
    expect(res.statusCode).toBe(404)
    expect(res.json().error).toMatchObject({ code: 'NOT_FOUND', requestId: expect.stringMatching(/^req_/) })
  })

  it('mengirim security headers (helmet)', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' })
    expect(res.headers['x-content-type-options']).toBe('nosniff')
  })
})
