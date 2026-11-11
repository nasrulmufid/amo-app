import type { Env } from '../../config/env'

/**
 * Klien GenieACS NBI (Northbound Interface) — PRD §8.1.
 *
 * ✅ Baseline fungsional, tetapi BELUM dipakai oleh scheduler (Sprint 3).
 *
 * Aturan:
 *  - Hanya backend yang boleh memanggil NBI; kredensial TIDAK PERNAH ke browser.
 *  - Setiap panggilan punya timeout (GENIEACS_TIMEOUT_MS) → NBI lambat tak
 *    boleh menggantung API (PRD §11.1).
 *  - Error dibungkus `GenieAcsError`; pemanggil memutuskan retry/backoff.
 *
 * Bentuk data NBI: array objek perangkat. `_id` = ID perangkat, `_lastInform` = ISO
 * string, sisanya pohon parameter TR-069 di mana tiap daun berbentuk `{ _value, _type, ... }`.
 */

export interface GenieDevice {
  _id: string
  _lastInform?: string
  _registered?: string
  [key: string]: unknown
}

export class GenieAcsError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    options?: { cause?: unknown },
  ) {
    super(message, options)
    this.name = 'GenieAcsError'
  }
}

export interface ListDevicesOptions {
  /** Filter MongoDB-style, mis. { "_lastInform": { "$gt": "2026-01-01" } } */
  query?: Record<string, unknown>
  /** Path parameter yang diambil. Selalu minimalkan — jangan tarik seluruh pohon. */
  projection?: string[]
  skip?: number
  limit?: number
}

export class GenieAcsClient {
  private readonly baseUrl: string
  private readonly authHeader: string | null
  private readonly timeoutMs: number

  constructor(cfg: Pick<Env, 'GENIEACS_NBI_URL' | 'GENIEACS_USERNAME' | 'GENIEACS_PASSWORD' | 'GENIEACS_TIMEOUT_MS'>) {
    this.baseUrl = cfg.GENIEACS_NBI_URL.replace(/\/+$/, '')
    this.timeoutMs = cfg.GENIEACS_TIMEOUT_MS
    this.authHeader = cfg.GENIEACS_USERNAME
      ? 'Basic ' + Buffer.from(`${cfg.GENIEACS_USERNAME}:${cfg.GENIEACS_PASSWORD}`).toString('base64')
      : null
  }

  async listDevices(opts: ListDevicesOptions = {}): Promise<GenieDevice[]> {
    const url = new URL(`${this.baseUrl}/devices/`)
    if (opts.query) url.searchParams.set('query', JSON.stringify(opts.query))
    if (opts.projection?.length) url.searchParams.set('projection', opts.projection.join(','))
    if (opts.skip !== undefined) url.searchParams.set('skip', String(opts.skip))
    if (opts.limit !== undefined) url.searchParams.set('limit', String(opts.limit))

    const body = await this.get(url)
    if (!Array.isArray(body)) throw new GenieAcsError('Respons NBI bukan array')
    return body as GenieDevice[]
  }

  /** Ambil satu perangkat berdasarkan `_id` GenieACS. `null` bila tidak ditemukan. */
  async getDevice(deviceId: string): Promise<GenieDevice | null> {
    const url = new URL(`${this.baseUrl}/devices/`)
    url.searchParams.set('query', JSON.stringify({ _id: deviceId }))
    url.searchParams.set('limit', '1')
    const body = await this.get(url)
    if (!Array.isArray(body)) throw new GenieAcsError('Respons NBI bukan array')
    return (body[0] as GenieDevice | undefined) ?? null
  }

  /**
   * Cek konektivitas NBI (dipakai halaman Pengaturan). Tidak melempar error:
   * mengembalikan status agar UI dapat menampilkan "tidak terjangkau" tanpa 500.
   */
  async ping(): Promise<{ ok: boolean; status?: number; error?: string }> {
    try {
      const url = new URL(`${this.baseUrl}/devices/`)
      url.searchParams.set('limit', '1')
      url.searchParams.set('projection', '_id')
      await this.get(url)
      return { ok: true }
    } catch (err) {
      return {
        ok: false,
        status: err instanceof GenieAcsError ? err.status : undefined,
        error: err instanceof Error ? err.message : 'unknown error',
      }
    }
  }

  private async get(url: URL): Promise<unknown> {
    let res: Response
    try {
      res = await fetch(url, {
        headers: { Accept: 'application/json', ...(this.authHeader ? { Authorization: this.authHeader } : {}) },
        signal: AbortSignal.timeout(this.timeoutMs),
      })
    } catch (cause) {
      // Pesan generik: jangan bocorkan URL/kredensial ke respons. Detail ada di `cause` untuk log.
      throw new GenieAcsError('Tidak dapat menghubungi GenieACS NBI (timeout atau jaringan)', undefined, { cause })
    }
    if (!res.ok) throw new GenieAcsError(`GenieACS NBI membalas ${res.status}`, res.status)
    return res.json()
  }
}
