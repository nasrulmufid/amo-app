import { describe, expect, it } from 'vitest'
import { roleHasPermission } from '@amo/shared'
import { hashPassword, verifyPassword } from '../src/common/password'
import { loadEnv } from '../src/config/env'
import { redact } from '../src/modules/audit/audit.service'
import { deriveOnlineStatus, normalizeDevice, readParam } from '../src/modules/genieacs/genieacs.mapper'
import { SessionService } from '../src/modules/auth/session.service'

describe('RBAC (shared)', () => {
  it('viewer hanya-baca, operator boleh remote, admin semua', () => {
    expect(roleHasPermission('viewer', 'inventory.read')).toBe(true)
    expect(roleHasPermission('viewer', 'inventory.write')).toBe(false)
    expect(roleHasPermission('viewer', 'remote.open')).toBe(false)
    expect(roleHasPermission('operator', 'remote.open')).toBe(true)
    expect(roleHasPermission('operator', 'users.manage')).toBe(false)
    expect(roleHasPermission('admin', 'users.manage')).toBe(true)
  })
})

describe('password', () => {
  it('hash argon2id dapat diverifikasi; salah → false; hash rusak → false (tidak crash)', async () => {
    const h = await hashPassword('rahasia-123')
    expect(h.startsWith('$argon2id$')).toBe(true)
    expect(await verifyPassword(h, 'rahasia-123')).toBe(true)
    expect(await verifyPassword(h, 'salah')).toBe(false)
    expect(await verifyPassword('bukan-hash', 'apa-saja')).toBe(false)
  })
})

describe('sesi', () => {
  it('hashToken deterministik & 64 hex (cocok dengan kolom CHAR(64))', () => {
    const h = SessionService.hashToken('abc')
    expect(h).toMatch(/^[a-f0-9]{64}$/)
    expect(SessionService.hashToken('abc')).toBe(h)
  })
})

describe('audit redact', () => {
  it('menyamarkan kunci sensitif secara rekursif', () => {
    const out = redact({ email: 'a@b.co', password: 'x', nested: { Authorization: 'Bearer z', ok: 1 }, list: [{ token: 't' }] })
    expect(out).toEqual({
      email: 'a@b.co',
      password: '[REDACTED]',
      nested: { Authorization: '[REDACTED]', ok: 1 },
      list: [{ token: '[REDACTED]' }],
    })
  })
})

describe('env', () => {
  const base = {
    APP_BASE_URL: 'https://amo.example.com',
    SESSION_SECRET: 'x'.repeat(40),
    DATABASE_URL: 'mysql://u:p@h:3306/amo',
  }
  it('memberi default yang aman sesuai PRD', () => {
    const env = loadEnv(base)
    expect(env.REMOTE_ALLOWED_PORTS).toEqual([80, 443])
    expect(env.REMOTE_ALLOWED_CIDRS).toEqual([]) // kosong = tidak ada target diizinkan
    expect(env.GENIEACS_SYNC_INTERVAL_SECONDS).toBe(60)
    expect(env.TRUST_PROXY).toBe(false)
  })
  it('menolak secret terlalu pendek & secret contoh di production', () => {
    expect(() => loadEnv({ ...base, SESSION_SECRET: 'pendek' })).toThrow(/SESSION_SECRET/)
    expect(() => loadEnv({ ...base, NODE_ENV: 'production', SESSION_SECRET: 'CHANGE_ME_' + 'x'.repeat(30) })).toThrow(/CHANGE_ME/)
  })
  it('menolak daftar port tidak valid', () => {
    expect(() => loadEnv({ ...base, REMOTE_ALLOWED_PORTS: '80,abc' })).toThrow(/REMOTE_ALLOWED_PORTS/)
  })
})

describe('GenieACS mapper', () => {
  const device = {
    _id: '00259E-HG8245H-HWTC91B2401',
    _lastInform: '2026-10-18T10:00:00.000Z',
    DeviceID: { SerialNumber: { _value: ' HWTC91B2401 ' }, ProductClass: { _value: 'HG8245H' } },
    InternetGatewayDevice: { DeviceInfo: { Manufacturer: { _value: 'Huawei' }, ModelName: { _value: '' } } },
    VirtualParameters: { IPTR069: { _value: ' 192.168.1.20 ' } },
  }
  it('membaca path bertitik & men-trim nilai', () => {
    expect(readParam(device, 'DeviceID.SerialNumber')).toBe('HWTC91B2401')
    expect(readParam(device, 'Tidak.Ada.Path')).toBeNull()
  })
  it('fallback model → ProductClass bila ModelName kosong (PRD §8.3)', () => {
    const n = normalizeDevice(device)
    expect(n.model).toBe('HG8245H')
    expect(n.manufacturer).toBe('Huawei')
    expect(n.managementIp).toBe('192.168.1.20')
    expect(n.lastInformAt?.toISOString()).toBe('2026-10-18T10:00:00.000Z')
  })
  it('deriveOnlineStatus: unknown bila tak pernah inform; online/offline sesuai threshold', () => {
    const now = new Date('2026-10-18T10:10:00Z')
    expect(deriveOnlineStatus(null, 600, now)).toBe('unknown')
    expect(deriveOnlineStatus(new Date('2026-10-18T10:05:00Z'), 600, now)).toBe('online')
    expect(deriveOnlineStatus(new Date('2026-10-18T09:50:00Z'), 600, now)).toBe('offline')
  })
})
