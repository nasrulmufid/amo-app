import type { FastifyBaseLogger, FastifyRequest } from 'fastify'
import type { AuditAction } from '@amo/shared'
import { requestMeta } from '../../common/http'
import type { AuditRepository } from './audit.repository'

export interface AuditEntry {
  action: AuditAction
  /** Pelaku. Bila kosong dan request punya sesi → diambil dari request.auth. */
  userId?: number | null
  resourceType?: string
  resourceId?: string
  /** Konteks tambahan. Kunci sensitif OTOMATIS disamarkan (lihat redact). */
  details?: Record<string, unknown>
}

const SENSITIVE_KEY = /pass(word)?|secret|token|cookie|authorization|credential/i

/**
 * Samarkan nilai sensitif secara rekursif sebelum masuk audit log.
 * PRD §7 & §10: password/cookie ONU/sesi tidak boleh tersimpan di log.
 * Ini JARING PENGAMAN — tetap jangan sengaja memasukkan rahasia ke `details`.
 */
export function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, SENSITIVE_KEY.test(k) ? '[REDACTED]' : redact(v)]),
    )
  }
  return value
}

export class AuditService {
  constructor(
    private readonly repo: AuditRepository,
    private readonly log: FastifyBaseLogger,
  ) {}

  /**
   * Catat aktivitas. TIDAK PERNAH melempar error: kegagalan menulis audit
   * tidak boleh menggagalkan aksi bisnis (mis. login). Kegagalan dicatat di log aplikasi.
   * ⚠ Bila kebijakan Anda mewajibkan "tak ada aksi tanpa audit" (mis. untuk remote),
   *   panggil `repo.insert` langsung dan biarkan error naik.
   */
  async record(request: FastifyRequest, entry: AuditEntry): Promise<void> {
    const meta = requestMeta(request)
    try {
      await this.repo.insert({
        userId: entry.userId ?? request.auth?.user.id ?? null,
        action: entry.action,
        resourceType: entry.resourceType ?? null,
        resourceId: entry.resourceId ?? null,
        ip: meta.ip,
        userAgent: meta.userAgent,
        requestId: meta.requestId,
        details: entry.details === undefined ? undefined : redact(entry.details),
      })
    } catch (err) {
      this.log.error({ err, action: entry.action }, 'gagal menulis audit log')
    }
  }
}
