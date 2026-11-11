import { API_PREFIX, CSRF_HEADER_NAME, type ApiFailure, type ApiSuccess } from '@amo/shared'

/**
 * Klien HTTP tunggal ke API. Semua fitur memanggil `api()` — bukan `fetch` langsung —
 * sehingga penanganan cookie, CSRF, dan error seragam.
 *
 *  • Sesi = cookie HttpOnly (tidak terbaca JS). `credentials: 'same-origin'` cukup karena
 *    web & API satu origin (proxy Vite di dev, Nginx di produksi).
 *  • Token CSRF diterima dari /auth/login & /auth/me, disimpan DI MEMORI (bukan localStorage),
 *    lalu dikirim sebagai header pada request non-GET.
 */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly requestId?: string,
    public readonly details?: unknown,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

let csrfToken: string | null = null
export const setCsrfToken = (token: string | null) => {
  csrfToken = token
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'
  body?: unknown
  signal?: AbortSignal
}

export async function api<T>(path: string, { method = 'GET', body, signal }: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (method !== 'GET' && csrfToken) headers[CSRF_HEADER_NAME] = csrfToken

  let res: Response
  try {
    res = await fetch(`${API_PREFIX}${path}`, {
      method,
      headers,
      credentials: 'same-origin',
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    })
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === 'AbortError') throw cause
    throw new ApiError(0, 'NETWORK_ERROR', 'Tidak dapat terhubung ke server. Periksa koneksi Anda.')
  }

  const json = (await res.json().catch(() => null)) as ApiSuccess<T> | ApiFailure | null
  if (!res.ok) {
    const err = json && 'error' in json ? json.error : null
    throw new ApiError(res.status, err?.code ?? 'UNKNOWN', err?.message ?? `Permintaan gagal (${res.status})`, err?.requestId, err?.details)
  }
  return (json as ApiSuccess<T>).data
}
