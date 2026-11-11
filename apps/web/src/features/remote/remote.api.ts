import type { RemoteSessionDTO } from '@amo/shared'
import { api } from '@/lib/api'

/**
 * Minta konteks remote untuk perangkat (PRD §3.5).
 * Server memvalidasi sesi, izin, target, skema, port, dan allowlist SSRF.
 */
export const openRemoteSession = (uuid: string) =>
  api<RemoteSessionDTO>(`/inventory/${uuid}/remote-session`, { method: 'POST' })
