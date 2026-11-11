import type { RemoteSessionDTO } from '@amo/shared'
import type { Env } from '../../config/env'
import { Errors } from '../../common/errors'
import type { RemoteRepository, RemoteTargetRow } from './remote.repository'
import { RemoteTargetError, resolveRemoteTarget, type ResolvedTarget } from './remote.security'

/**
 * Logika remote access (PRD §3.5, §10).
 *
 * Urutan pemeriksaan (PRD §10.5):
 *  1. Sesi & izin — dilakukan route (`app.authenticate` + `requirePermission`).
 *  2. Cari inventaris by UUID; tidak ada / tidak aktif → 404.
 *  3. Target HANYA dari DB (management_ip, remote_scheme, remote_port).
 *  4. Skema & port harus sesuai kebijakan server.
 *  5. Anti-SSRF: IP harus di dalam REMOTE_ALLOWED_CIDRS (lihat remote.security.ts).
 */
export interface RemoteContext {
  target: RemoteTargetRow
  resolved: ResolvedTarget
  origin: string
  prefix: string
}

export class RemoteService {
  constructor(
    private readonly repo: RemoteRepository,
    private readonly env: Env,
  ) {}

  /** Validasi akses & siapkan konteks proxy. Melempar AppError yang sesuai. */
  async prepare(uuid: string): Promise<RemoteContext> {
    const target = await this.repo.findTarget(uuid)
    // UUID asing = tidak ditemukan (jangan membocorkan apakah UUID pernah ada).
    if (!target || !target.isActive) throw Errors.notFound('ONU')

    if (!target.managementIp) {
      throw Errors.remoteTargetNotAllowed('Perangkat belum memiliki management IP; remote tidak dapat dibuka.')
    }
    if (!this.env.REMOTE_ALLOWED_SCHEMES.includes(target.remoteScheme)) {
      throw Errors.remoteTargetNotAllowed(`Skema ${target.remoteScheme} tidak diizinkan.`)
    }
    if (!this.env.REMOTE_ALLOWED_PORTS.includes(target.remotePort)) {
      throw Errors.remoteTargetNotAllowed(`Port ${target.remotePort} tidak diizinkan.`)
    }

    let resolved: ResolvedTarget
    try {
      resolved = await resolveRemoteTarget(target.managementIp, this.env.REMOTE_ALLOWED_CIDRS)
    } catch (err) {
      if (err instanceof RemoteTargetError) {
        throw Errors.remoteTargetNotAllowed(err.message)
      }
      throw err
    }

    const hostForUrl = resolved.hostname ?? (resolved.ip.includes(':') ? `[${resolved.ip}]` : resolved.ip)
    const origin = `${target.remoteScheme}://${hostForUrl}:${target.remotePort}`
    return { target, resolved, origin, prefix: `/remote/${target.uuid}` }
  }

  /** DTO untuk `POST /inventory/:uuid/remote-session`. */
  sessionDto(ctx: RemoteContext): RemoteSessionDTO {
    return {
      url: `${this.env.APP_BASE_URL.replace(/\/+$/, '')}${ctx.prefix}/`,
      uuid: ctx.target.uuid,
      target: ctx.resolved.ip,
      scheme: ctx.target.remoteScheme,
      port: ctx.target.remotePort,
      // Sesi remote mengikuti umur sesi login; nilai ini informatif untuk UI.
      expiresAt: new Date(Date.now() + this.env.SESSION_TTL_HOURS * 3_600_000).toISOString(),
    }
  }

  async log(entry: {
    userId: number | null
    deviceUuid: string
    target: string | null
    port: number | null
    result: string
    statusCode: number | null
    requestId: string | null
  }): Promise<void> {
    if (!this.env.REMOTE_AUDIT_ENABLED) return
    await this.repo.logAccess(entry).catch(() => undefined)
  }
}
