import { BlockList, isIP } from 'node:net'
import { lookup } from 'node:dns/promises'

/**
 * Penjaga target remote (PRD §10.1, §10.5) — inti perlindungan SSRF.
 *
 * Aturan:
 *  1. Target HANYA berasal dari record inventaris (IP literal), bukan dari request.
 *  2. SELALU ditolak: loopback, link-local (termasuk metadata cloud 169.254.169.254),
 *     unspecified (0.0.0.0/::), multicast, broadcast, dan rentang privat/reserved
 *     yang tidak secara eksplisit diizinkan.
 *  3. Diizinkan HANYA bila IP berada di salah satu REMOTE_ALLOWED_CIDRS.
 *     Daftar kosong = TIDAK ADA target yang diizinkan (aman secara default).
 *  4. Bila target berupa hostname (data lama), DNS di-resolve SEKALI, SEMUA hasil
 *     divalidasi, lalu koneksi dipaksa ke IP hasil resolusi (cegah DNS rebinding).
 */

/** Rentang yang tidak pernah boleh menjadi target, apa pun isi allowlist. */
const ALWAYS_BLOCKED = new BlockList()
// IPv4
ALWAYS_BLOCKED.addSubnet('0.0.0.0', 8, 'ipv4') // "this network"
ALWAYS_BLOCKED.addSubnet('127.0.0.0', 8, 'ipv4') // loopback
ALWAYS_BLOCKED.addSubnet('169.254.0.0', 16, 'ipv4') // link-local + metadata cloud
ALWAYS_BLOCKED.addSubnet('224.0.0.0', 4, 'ipv4') // multicast
ALWAYS_BLOCKED.addSubnet('240.0.0.0', 4, 'ipv4') // reserved + broadcast
// IPv6
ALWAYS_BLOCKED.addAddress('::', 'ipv6') // unspecified
ALWAYS_BLOCKED.addAddress('::1', 'ipv6') // loopback
ALWAYS_BLOCKED.addSubnet('fe80::', 10, 'ipv6') // link-local
ALWAYS_BLOCKED.addSubnet('ff00::', 8, 'ipv6') // multicast
ALWAYS_BLOCKED.addSubnet('fc00::', 7, 'ipv6') // unique local
// IPv4-mapped IPv6 (::ffff:127.0.0.1 dsb.) — dinormalisasi sebelum cek.

export class RemoteTargetError extends Error {
  constructor(
    message: string,
    public readonly reason: 'invalid' | 'blocked' | 'not_allowed' | 'dns',
  ) {
    super(message)
    this.name = 'RemoteTargetError'
  }
}

/** Normalisasi IPv4-mapped IPv6 (`::ffff:1.2.3.4`) menjadi IPv4 agar tidak lolos cek. */
export function normalizeIp(ip: string): string {
  const lower = ip.toLowerCase()
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(lower)
  return mapped?.[1] ?? lower
}

export function isAlwaysBlocked(ip: string): boolean {
  const normalized = normalizeIp(ip)
  const family = isIP(normalized)
  if (family === 4) return ALWAYS_BLOCKED.check(normalized, 'ipv4')
  if (family === 6) return ALWAYS_BLOCKED.check(normalized, 'ipv6')
  return true // bukan IP valid → anggap terlarang
}

/** Bangun BlockList dari daftar CIDR (string). CIDR tidak valid diabaikan + dilaporkan. */
export function buildAllowList(cidrs: readonly string[]): { list: BlockList; invalid: string[] } {
  const list = new BlockList()
  const invalid: string[] = []
  for (const cidr of cidrs) {
    const [address, prefixText] = cidr.split('/')
    const prefix = Number(prefixText)
    const family = address ? isIP(address) : 0
    if (!address || family === 0 || !Number.isInteger(prefix)) {
      invalid.push(cidr)
      continue
    }
    const maxPrefix = family === 4 ? 32 : 128
    if (prefix < 0 || prefix > maxPrefix) {
      invalid.push(cidr)
      continue
    }
    list.addSubnet(address, prefix, family === 4 ? 'ipv4' : 'ipv6')
  }
  return { list, invalid }
}

export interface ResolvedTarget {
  /** IP literal yang akan dihubungi (sudah divalidasi). */
  ip: string
  /** Hostname asli (untuk header Host & SNI) bila target berupa hostname. */
  hostname: string | null
}

/**
 * Validasi target remote. Melempar `RemoteTargetError` bila tidak diizinkan.
 * `resolve` dapat diganti di test (dependency injection).
 */
export async function resolveRemoteTarget(
  target: string,
  allowedCidrs: readonly string[],
  resolve: (hostname: string) => Promise<string[]> = defaultResolve,
): Promise<ResolvedTarget> {
  const host = target.trim()
  if (!host) throw new RemoteTargetError('Target remote kosong.', 'invalid')

  const { list, invalid } = buildAllowList(allowedCidrs)
  if (invalid.length > 0) {
    // Konfigurasi salah → gagal aman (jangan diam-diam mengizinkan).
    throw new RemoteTargetError(`Konfigurasi REMOTE_ALLOWED_CIDRS tidak valid: ${invalid.join(', ')}`, 'invalid')
  }
  if (allowedCidrs.length === 0) {
    throw new RemoteTargetError(
      'REMOTE_ALLOWED_CIDRS kosong — tidak ada target remote yang diizinkan.',
      'not_allowed',
    )
  }

  const literalFamily = isIP(host)
  if (literalFamily !== 0) {
    assertAllowed(host, list)
    return { ip: normalizeIp(host), hostname: null }
  }

  // Hostname: resolve sekali, validasi SEMUA hasil, lalu pakai IP pertama.
  let addresses: string[]
  try {
    addresses = await resolve(host)
  } catch {
    throw new RemoteTargetError('Nama host target tidak dapat di-resolve.', 'dns')
  }
  if (addresses.length === 0) throw new RemoteTargetError('Nama host target tidak memiliki alamat IP.', 'dns')
  for (const address of addresses) assertAllowed(address, list)
  const first = addresses[0]
  if (!first) throw new RemoteTargetError('Nama host target tidak memiliki alamat IP.', 'dns')
  return { ip: normalizeIp(first), hostname: host }
}

function assertAllowed(ip: string, allowList: BlockList): void {
  const normalized = normalizeIp(ip)
  const family = isIP(normalized)
  if (family === 0) throw new RemoteTargetError('Target bukan alamat IP yang valid.', 'invalid')
  if (isAlwaysBlocked(normalized)) {
    throw new RemoteTargetError('Target berada pada rentang yang selalu diblokir (loopback/link-local/metadata).', 'blocked')
  }
  const allowed = allowList.check(normalized, family === 4 ? 'ipv4' : 'ipv6')
  if (!allowed) {
    throw new RemoteTargetError('Target berada di luar jaringan yang diizinkan (REMOTE_ALLOWED_CIDRS).', 'not_allowed')
  }
}

async function defaultResolve(hostname: string): Promise<string[]> {
  const results = await lookup(hostname, { all: true, verbatim: true })
  return results.map((r) => r.address)
}

/**
 * Normalisasi path dari request menjadi path relatif yang aman (PRD §10.2).
 *  - decode sekali, buang null-byte & backslash
 *  - buang segmen `..` dan `.`
 *  - hasil SELALU diawali `/` dan tidak dapat keluar dari prefix remote
 */
export function sanitizeRemotePath(rawPath: string): string {
  let decoded: string
  try {
    decoded = decodeURIComponent(rawPath)
  } catch {
    throw new RemoteTargetError('Path remote tidak valid.', 'invalid')
  }
  if (decoded.includes('\0')) throw new RemoteTargetError('Path remote tidak valid.', 'invalid')

  const segments = decoded
    .replace(/\\/g, '/')
    .split('/')
    .filter((segment) => segment !== '' && segment !== '.' && segment !== '..')

  const path = `/${segments.join('/')}`
  // Pertahankan trailing slash agar URL direktori tetap direktori.
  return decoded.endsWith('/') && path !== '/' ? `${path}/` : path
}

/** Header hop-by-hop yang tidak boleh diteruskan (RFC 7230 §6.1). */
const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'proxy-connection',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'http2-settings',
])

/** Header request yang tidak boleh diteruskan ke perangkat. */
const STRIPPED_REQUEST_HEADERS = new Set([
  ...HOP_BY_HOP,
  'host',
  'authorization',
  'x-forwarded-for',
  'x-forwarded-host',
  'x-forwarded-proto',
  'x-real-ip',
  'forwarded',
])

export function sanitizeRequestHeaders(
  headers: Record<string, string | string[] | undefined>,
  targetHost: string,
  targetOrigin?: string,
  targetPath?: string,
): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {}
  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined) continue
    const lower = name.toLowerCase()
    if (STRIPPED_REQUEST_HEADERS.has(lower)) continue
    if (lower === 'cookie') {
      const cookies = String(value)
        .split(';')
        .map((cookie) => cookie.trim())
        .filter((cookie) => cookie.startsWith('amo_remote_'))
        .map((cookie) => cookie.slice('amo_remote_'.length))
      if (cookies.length > 0) out.cookie = cookies.join('; ')
      continue
    }
    if (lower === 'origin' || lower === 'referer') continue
    out[lower] = value
  }
  out.host = targetHost
  if (targetOrigin) {
    out.origin = targetOrigin
    if (targetPath) out.referer = `${targetOrigin}${targetPath}`
  }
  return out
}

/** Header respons yang tidak boleh diteruskan balik ke browser. */
const STRIPPED_RESPONSE_HEADERS = new Set([
  ...HOP_BY_HOP,
  'content-security-policy',
  'content-security-policy-report-only',
  'strict-transport-security',
  'public-key-pins',
  'alt-svc',
  'server',
  'x-powered-by',
])

export function sanitizeResponseHeaders(
  headers: Record<string, string | string[] | undefined>,
): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {}
  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined) continue
    const lower = name.toLowerCase()
    if (STRIPPED_RESPONSE_HEADERS.has(lower)) continue
    out[lower] = value
  }
  return out
}

/**
 * Scope cookie dari perangkat agar tidak menimpa cookie AMO (PRD §10.3).
 *  - nama diberi awalan `amo_remote_`
 *  - Path dipaksa ke prefix remote
 *  - Domain dibuang (host-only)
 */
export function scopeRemoteCookie(cookie: string, remotePrefix: string): string {
  const [pair, ...attributes] = cookie.split(';')
  const eq = pair?.indexOf('=') ?? -1
  if (!pair || eq <= 0) return cookie
  const name = pair.slice(0, eq).trim()
  const value = pair.slice(eq + 1)

  const kept: string[] = []
  for (const attribute of attributes) {
    const trimmed = attribute.trim()
    const lower = trimmed.toLowerCase()
    if (lower.startsWith('path=') || lower.startsWith('domain=')) continue
    kept.push(trimmed)
  }
  kept.push(`Path=${remotePrefix}`)
  return [`amo_remote_${name}=${value}`, ...kept].join('; ')
}

/**
 * Rewrite header `Location` pada redirect (PRD §10.3).
 *  - absolut ke host target → diubah menjadi path di bawah prefix remote
 *  - absolut ke host LAIN → dibuang (null) agar tidak membocorkan jalur proxy
 *  - relatif → dipertahankan
 */
export function rewriteLocation(
  location: string,
  targetOrigin: string,
  remotePrefix: string,
): string | null {
  let url: URL
  try {
    url = new URL(location, targetOrigin)
  } catch {
    return null
  }
  const target = new URL(targetOrigin)
  if (url.origin !== target.origin) return null
  const path = `${url.pathname}${url.search}${url.hash}`
  return `${remotePrefix}${path.startsWith('/') ? path : `/${path}`}`
}

/** Rewrite root-relative HTML/CSS resources so browser requests stay in the proxy. */
export function rewriteRootRelativeResourceUrls(content: string, remotePrefix: string): string {
  const prefixPath = (path: string) => {
    if (path === remotePrefix || path.startsWith(`${remotePrefix}/`)) return path
    return `${remotePrefix}${path}`
  }

  const attributes = '(?:src|href|action|formaction|poster|background|data|cite|manifest)'
  return content
    .replace(
      new RegExp(`(\\b${attributes}\\s*=\\s*)(["'])(\\/(?!\\/)[^"']*)\\2`, 'gi'),
      (_match, assignment: string, quote: string, path: string) => `${assignment}${quote}${prefixPath(path)}${quote}`,
    )
    .replace(
      new RegExp(`(\\b${attributes}\\s*=\\s*)(\\/(?!\\/)[^\\s"'<>]+)`, 'gi'),
      (_match, assignment: string, path: string) => `${assignment}${prefixPath(path)}`,
    )
    .replace(
      /url\(\s*(["']?)(\/(?!\/)[^)'"\s]+)(["']?\s*\))/gi,
      (_match, quote: string, path: string, closing: string) => `url(${quote}${prefixPath(path)}${closing}`,
    )
    .replace(
      /(@import\s+)(["'])(\/(?!\/)[^"']*)\2/gi,
      (_match, importRule: string, quote: string, path: string) => `${importRule}${quote}${prefixPath(path)}${quote}`,
    )
}
