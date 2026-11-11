import { randomUUID } from 'node:crypto'
import type { FastifyBaseLogger } from 'fastify'
import type { SyncRunDTO, SyncRunStatus } from '@amo/shared'
import type { Env } from '../../config/env'
import { GenieAcsClient, GenieAcsError, type GenieDevice } from './genieacs.client'
import { deriveOnlineStatus, normalizeDevice, PARAM_PATHS } from './genieacs.mapper'
import type { SyncRepository, SyncRunRow } from './sync.repository'
import type { SettingsRepository } from '../settings/settings.repository'

/**
 * Sinkronisasi GenieACS (PRD §8.4, §11).
 *
 * Alur: startRun → listDevices (paginasi) → normalize → deriveOnlineStatus → upsert
 *       → autolink serial → finishRun.
 *
 * Jaminan:
 *  - IDEMPOTEN: upsert berdasarkan `genieacs_device_id` (UNIQUE).
 *  - Metadata manual (`onu_inventory`) tidak pernah ditulis.
 *  - Kegagalan satu perangkat tidak menghentikan batch (dihitung ke failed_count).
 *  - Bila NBI gagal total: status perangkat LAMA dipertahankan (tidak semua ditandai offline).
 *  - Dua sync tidak dapat berjalan bersamaan (flag in-memory).
 *  - Retry terbatas dengan backoff untuk kegagalan sementara.
 */

const PAGE_SIZE = 200
const MAX_PAGES = 500 // pengaman: 100.000 perangkat per run
const MAX_RETRIES = 3

/** Kunci yang tidak boleh tersimpan di snapshot parameter (PRD §7). */
const SENSITIVE_PARAM = /pass(word)?|secret|credential|wpa|psk|key/i

export interface SyncResult {
  runId: number
  status: SyncRunStatus
  found: number
  success: number
  failed: number
  linked: number
  errorSummary: string | null
}

export class SyncService {
  private running = false
  private readonly client: GenieAcsClient

  constructor(
    private readonly repo: SyncRepository,
    private readonly env: Env,
    private readonly log: FastifyBaseLogger,
    /** Bila disuntikkan → aktifkan auto-create inventaris (setting sync.autoCreateInventory). */
    private readonly settings?: SettingsRepository,
  ) {
    this.client = new GenieAcsClient(env)
  }

  get isRunning(): boolean {
    return this.running
  }

  async run(input: {
    trigger: 'scheduler' | 'manual'
    userId: number | null
    requestId: string | null
  }): Promise<SyncResult> {
    if (this.running) {
      throw new SyncAlreadyRunningError()
    }
    this.running = true
    const runId = await this.repo.startRun(input)
    const startedAt = Date.now()

    let found = 0
    let success = 0
    let failed = 0
    let linked = 0
    let fatal: string | null = null

    try {
      const extraPaths = await this.repo.loadParameterMap()
      const devices = await this.fetchAllDevices()
      found = devices.length

      for (const device of devices) {
        try {
          const normalized = normalizeDevice(device, extraPaths as Partial<Record<keyof typeof PARAM_PATHS, readonly string[]>>)
          const now = new Date()
          const deviceId = await this.repo.upsertDevice({
            genieacsDeviceId: normalized.genieDeviceId,
            serialNumber: normalized.serialNumber,
            manufacturer: normalized.manufacturer,
            model: normalized.model,
            productClass: normalized.productClass,
            managementIp: normalized.managementIp,
            lastInformAt: normalized.lastInformAt,
            lastSyncedAt: now,
            onlineStatus: deriveOnlineStatus(normalized.lastInformAt, this.env.ONLINE_THRESHOLD_SECONDS, now),
            parametersJson: JSON.stringify(redactParameters(device)),
            syncError: null,
          })
          linked += await this.repo.autolinkBySerial(deviceId, normalized.serialNumber)
          // Metadata inventaris yang masih kosong diisi dari data ACS (serial/vendor/model/IP).
          await this.repo.fillInventoryFromDevice(deviceId)
          await this.autoCreateInventory(deviceId, normalized, now)
          success++
        } catch (err) {
          failed++
          const message = err instanceof Error ? err.message : 'unknown error'
          this.log.warn({ err, deviceId: device._id }, 'gagal memproses perangkat GenieACS')
          await this.repo.markDeviceError(device._id, message).catch(() => undefined)
        }
      }
    } catch (err) {
      // Kegagalan TOTAL (NBI tak terjangkau / respons invalid). Status lama DIPERTAHANKAN.
      fatal = err instanceof GenieAcsError ? err.message : err instanceof Error ? err.message : 'unknown error'
      this.log.error({ err }, 'sinkronisasi GenieACS gagal total')
    }

    const status: SyncRunStatus = fatal ? 'failed' : failed > 0 ? 'partial' : 'success'
    const errorSummary = fatal ?? (failed > 0 ? `${failed} perangkat gagal diproses.` : null)
    await this.repo.finishRun(runId, { status, found, success, failed, errorSummary })

    this.log.info(
      { runId, status, found, success, failed, linked, durationMs: Date.now() - startedAt },
      'sinkronisasi GenieACS selesai',
    )
    return { runId, status, found, success, failed, linked, errorSummary }
  }

  /** Ambil SEMUA perangkat dengan paginasi + retry terbatas. */
  private async fetchAllDevices(): Promise<GenieDevice[]> {
    const all: GenieDevice[] = []
    for (let page = 0; page < MAX_PAGES; page++) {
      const batch = await this.withRetry(() =>
        this.client.listDevices({ skip: page * PAGE_SIZE, limit: PAGE_SIZE }),
      )
      all.push(...batch)
      if (batch.length < PAGE_SIZE) break
    }
    return all
  }

  private async withRetry<T>(fn: () => Promise<T>): Promise<T> {
    let lastError: unknown
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        return await fn()
      } catch (err) {
        lastError = err
        // 4xx (selain 429) tidak akan berubah bila diulang.
        if (err instanceof GenieAcsError && err.status && err.status >= 400 && err.status < 500 && err.status !== 429) {
          throw err
        }
        const delay = 500 * 2 ** attempt
        this.log.warn({ attempt: attempt + 1, delay }, 'retry GenieACS NBI')
        await new Promise((resolve) => setTimeout(resolve, delay))
      }
    }
    throw lastError
  }

  async status(): Promise<{
    running: boolean
    lastRun: SyncRunDTO | null
    lastSyncedAt: string | null
  }> {
    const [lastRun, lastSyncedAt] = await Promise.all([this.repo.lastRun(), this.repo.lastSyncedAt()])
    return {
      running: this.running,
      lastRun: lastRun ? toRunDto(lastRun) : null,
      lastSyncedAt: lastSyncedAt?.toISOString() ?? null,
    }
  }

  async runs(limit = 20): Promise<SyncRunDTO[]> {
    return (await this.repo.listRuns(limit)).map(toRunDto)
  }

  async ping() {
    return this.client.ping()
  }

  /**
   * AUTO-CREATE inventaris draft (fitur baru, setting `sync.autoCreateInventory`).
   *
   * Bila device ACS belum tertaut ke inventaris mana pun, buat record `onu_inventory`
   * draft + tautkan. Nama draft dipilih dari serial/model/device-id (tidak pernah kosong).
   * Metadata manual (lokasi, koordinat, catatan) dibiarkan NULL → admin yang melengkapi.
   * Idempoten: hanya jalan bila `inventory_id` masih NULL; duplikat serial ditangani
   * dengan membiarkan device tetap tak tertaut (autolink manual yang urus nanti).
   */
  private async autoCreateInventory(
    deviceId: number,
    normalized: ReturnType<typeof normalizeDevice>,
    now: Date,
  ): Promise<void> {
    if (!this.settings) return
    let enabled: boolean
    try {
      const values = await this.settings.getValues()
      enabled = typeof values['sync.autoCreateInventory'] === 'boolean'
        ? (values['sync.autoCreateInventory'] as boolean)
        : true // default: AKTIF (sesuai effective default di SettingsService)
    } catch (err) {
      this.log.warn({ err }, 'gagal membaca setting autoCreateInventory — lewati auto-create')
      return
    }
    if (!enabled) return

    const created = await this.repo.createDraftInventoryIfUnlinked(
      deviceId,
      {
        name: normalized.serialNumber ?? normalized.model ?? normalized.genieDeviceId,
        serialNumber: normalized.serialNumber,
        manufacturer: normalized.manufacturer,
        model: normalized.model,
        managementIp: normalized.managementIp,
        uuid: randomUUID(),
        createdAt: now,
      },
    )
    if (created) {
      this.log.info({ deviceId, name: created.name }, 'inventaris draft dibuat otomatis dari sync')
    }
  }
}

export class SyncAlreadyRunningError extends Error {
  constructor() {
    super('Sinkronisasi sedang berjalan.')
    this.name = 'SyncAlreadyRunningError'
  }
}

export function toRunDto(r: SyncRunRow): SyncRunDTO {
  return {
    id: r.id,
    triggerType: r.triggerType,
    triggeredBy: r.triggeredBy,
    triggeredByName: r.triggeredByName,
    startedAt: r.startedAt.toISOString(),
    finishedAt: r.finishedAt?.toISOString() ?? null,
    status: r.status,
    foundCount: r.foundCount,
    successCount: r.successCount,
    failedCount: r.failedCount,
    errorSummary: r.errorSummary,
  }
}

/**
 * Redaksi rekursif parameter sensitif sebelum disimpan ke `parameters_json`.
 * Jaring pengaman — jangan sengaja menyimpan kredensial.
 */
export function redactParameters(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactParameters)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, SENSITIVE_PARAM.test(k) ? '[REDACTED]' : redactParameters(v)]),
    )
  }
  return value
}
