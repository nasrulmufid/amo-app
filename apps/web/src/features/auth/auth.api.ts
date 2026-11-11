import type { SessionDTO } from '@amo/shared'
import { ApiError, api, setCsrfToken } from '@/lib/api'

/** Kunci cache React Query untuk "siapa yang sedang login". */
export const authKeys = { me: ['auth', 'me'] as const }

/**
 * Tanya server siapa user saat ini. 401 BUKAN error di sini — artinya "belum login" → null.
 * Sekaligus menyimpan token CSRF di memori untuk request non-GET berikutnya.
 */
export async function fetchMe(): Promise<SessionDTO | null> {
  try {
    const session = await api<SessionDTO>('/auth/me')
    setCsrfToken(session.csrfToken)
    return session
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) {
      setCsrfToken(null)
      return null
    }
    throw err
  }
}

export async function login(input: { email: string; password: string }): Promise<SessionDTO> {
  const session = await api<SessionDTO>('/auth/login', { method: 'POST', body: input })
  setCsrfToken(session.csrfToken)
  return session
}

export async function logout(): Promise<void> {
  await api('/auth/logout', { method: 'POST' })
  setCsrfToken(null)
}
