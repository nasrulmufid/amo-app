import { describe, expect, it } from 'vitest'
import {
  buildAllowList,
  isAlwaysBlocked,
  normalizeIp,
  RemoteTargetError,
  resolveRemoteTarget,
  rewriteLocation,
  rewriteRootRelativeResourceUrls,
  sanitizeRemotePath,
  sanitizeRequestHeaders,
  sanitizeResponseHeaders,
  scopeRemoteCookie,
} from '../src/modules/remote/remote.security'

/**
 * Test keamanan remote proxy (PRD §13.4 & §16) — WAJIB lulus sebelum rilis.
 * Semua fungsi di sini murni (tanpa I/O) kecuali `resolveRemoteTarget` yang
 * menerima resolver palsu.
 */

const ALLOWED = ['172.2.0.0/16', '10.20.0.0/16']

describe('anti-SSRF: rentang yang selalu diblokir', () => {
  it.each([
    '127.0.0.1',
    '127.255.255.254',
    '::1',
    '0.0.0.0',
    '::',
    '169.254.169.254', // metadata cloud
    '169.254.1.1',
    'fe80::1',
    '224.0.0.1',
    '255.255.255.255',
    'fc00::1',
    '::ffff:127.0.0.1', // IPv4-mapped loopback
  ])('%s selalu diblokir', (ip) => {
    expect(isAlwaysBlocked(ip)).toBe(true)
  })

  it('IP publik/privat biasa tidak termasuk daftar blokir mutlak', () => {
    expect(isAlwaysBlocked('172.2.1.3')).toBe(false)
    expect(isAlwaysBlocked('8.8.8.8')).toBe(false)
  })

  it('normalizeIp membuka IPv4-mapped IPv6', () => {
    expect(normalizeIp('::ffff:172.2.1.3')).toBe('172.2.1.3')
    expect(normalizeIp('172.2.1.3')).toBe('172.2.1.3')
  })
})

describe('allowlist CIDR', () => {
  it('CIDR tidak valid dilaporkan (gagal aman)', async () => {
    const { invalid } = buildAllowList(['172.2.0.0/16', 'bukan-cidr', '10.0.0.0/99'])
    expect(invalid).toEqual(['bukan-cidr', '10.0.0.0/99'])
    await expect(resolveRemoteTarget('172.2.1.3', ['bukan-cidr'])).rejects.toBeInstanceOf(RemoteTargetError)
  })

  it('allowlist kosong = TIDAK ADA target diizinkan', async () => {
    await expect(resolveRemoteTarget('172.2.1.3', [])).rejects.toMatchObject({ reason: 'not_allowed' })
  })

  it('IP di dalam CIDR diizinkan; di luar ditolak', async () => {
    await expect(resolveRemoteTarget('172.2.1.3', ALLOWED)).resolves.toEqual({ ip: '172.2.1.3', hostname: null })
    await expect(resolveRemoteTarget('172.3.1.3', ALLOWED)).rejects.toMatchObject({ reason: 'not_allowed' })
  })

  it('loopback ditolak walau allowlist mencakup 0.0.0.0/0', async () => {
    await expect(resolveRemoteTarget('127.0.0.1', ['0.0.0.0/0'])).rejects.toMatchObject({ reason: 'blocked' })
    await expect(resolveRemoteTarget('169.254.169.254', ['0.0.0.0/0'])).rejects.toMatchObject({ reason: 'blocked' })
  })

  it('hostname di-resolve sekali & SEMUA hasil divalidasi (cegah DNS rebinding)', async () => {
    const resolve = async () => ['172.2.1.3']
    await expect(resolveRemoteTarget('onu.local', ALLOWED, resolve)).resolves.toEqual({
      ip: '172.2.1.3',
      hostname: 'onu.local',
    })

    // Satu saja hasil di luar allowlist → seluruh target ditolak.
    const mixed = async () => ['172.2.1.3', '10.0.0.1']
    await expect(resolveRemoteTarget('onu.local', ALLOWED, mixed)).rejects.toMatchObject({ reason: 'not_allowed' })

    const failing = async () => {
      throw new Error('ENOTFOUND')
    }
    await expect(resolveRemoteTarget('tidak-ada.local', ALLOWED, failing)).rejects.toMatchObject({ reason: 'dns' })
  })
})

describe('normalisasi path', () => {
  it('membuang traversal, backslash, dan null-byte', () => {
    expect(sanitizeRemotePath('/../../etc/passwd')).toBe('/etc/passwd')
    expect(sanitizeRemotePath('/a/./b/../c')).toBe('/a/b/c')
    expect(sanitizeRemotePath('/a\\b')).toBe('/a/b')
    expect(sanitizeRemotePath('/%2e%2e/%2e%2e/etc')).toBe('/etc')
    expect(sanitizeRemotePath('/')).toBe('/')
    expect(sanitizeRemotePath('/assets/')).toBe('/assets/')
  })

  it('menolak null-byte & encoding rusak', () => {
    expect(() => sanitizeRemotePath('/a%00b')).toThrow(RemoteTargetError)
    expect(() => sanitizeRemotePath('/%E0%A4%A')).toThrow(RemoteTargetError)
  })
})

describe('sanitasi header', () => {
  it('membuang cookie AMO dan header hop-by-hop, meneruskan CSRF perangkat', () => {
    const out = sanitizeRequestHeaders(
      {
        cookie: 'amo_session=rahasia; amo_remote_SESSION=abc',
        authorization: 'Bearer x',
        'x-csrf-token': 'abc',
        connection: 'keep-alive',
          'x-forwarded-for': '1.2.3.4',
        accept: 'text/html',
        host: 'evil.example',
      },
      '172.2.1.3:80',
      'http://172.2.1.3:80',
      '/login',
    )
    expect(out).toEqual({ accept: 'text/html', 'x-csrf-token': 'abc', cookie: 'SESSION=abc', host: '172.2.1.3:80', origin: 'http://172.2.1.3:80', referer: 'http://172.2.1.3:80/login' })
  })

  it('respons: membuang header hop-by-hop & header keamanan milik perangkat', () => {
    const out = sanitizeResponseHeaders({
      'content-type': 'text/html',
      'transfer-encoding': 'chunked',
      'content-security-policy': "default-src 'none'",
      server: 'nginx',
      'set-cookie': ['a=1'],
    })
    expect(out).toEqual({ 'content-type': 'text/html', 'set-cookie': ['a=1'] })
  })
})

describe('cookie perangkat', () => {
  it('diberi awalan & Path di-scope ke prefix remote; Domain dibuang', () => {
    const out = scopeRemoteCookie('SESSION=abc; Path=/; Domain=evil.example; HttpOnly', '/remote/uuid-1')
    expect(out).toContain('amo_remote_SESSION=abc')
    expect(out).toContain('Path=/remote/uuid-1')
    expect(out).not.toContain('Domain=')
    expect(out).toContain('HttpOnly')
  })
})

describe('rewrite redirect', () => {
  const origin = 'http://172.2.1.3:80'
  const prefix = '/remote/uuid-1'

  it('redirect ke host target di-rewrite ke prefix remote', () => {
    expect(rewriteLocation('http://172.2.1.3/login.cgi', origin, prefix)).toBe('/remote/uuid-1/login.cgi')
    expect(rewriteLocation('/index.html', origin, prefix)).toBe('/remote/uuid-1/index.html')
  })

  it('redirect ke host LAIN diblokir (null)', () => {
    expect(rewriteLocation('http://evil.example/x', origin, prefix)).toBeNull()
    expect(rewriteLocation('https://172.2.1.3/x', origin, prefix)).toBeNull() // skema berbeda = origin berbeda
  })
})

describe('rewrite resource URL halaman ONU', () => {
  it('menambahkan prefix proxy untuk URL root-relative tanpa mengubah URL eksternal', () => {
    const source = `<img src="/images/logo.gif"><img src=/images/legacy-logo.gif><link href='/style/main.css'><div style="background:url(/images/header.gif)"></div><a href="//cdn.example/icon.png">CDN</a>`
    const result = rewriteRootRelativeResourceUrls(source, '/remote/uuid-1')

    expect(result).toContain('src="/remote/uuid-1/images/logo.gif"')
    expect(result).toContain('src=/remote/uuid-1/images/legacy-logo.gif')
    expect(result).toContain("href='/remote/uuid-1/style/main.css'")
    expect(result).toContain('url(/remote/uuid-1/images/header.gif)')
    expect(result).toContain('href="//cdn.example/icon.png"')
  })
})
