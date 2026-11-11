import type { AppSettingsDTO, ParamMapField, RemoteScheme } from '@amo/shared'
import type { Env } from '../../config/env'
import { Errors } from '../../common/errors'
import type { ParameterMapRow, SettingsRepository } from './settings.repository'

/**
 * Pengaturan aplikasi (PRD §7.6, §8.3).
 *
 * Nilai EFEKTIF = override di `app_settings` bila ada, selain itu nilai env.
 * Kebijakan remote (port/skema/CIDR) sengaja READ-ONLY dari env: mengubahnya
 * lewat UI akan melemahkan kontrol keamanan tanpa deploy yang disengaja.
 */

const DEFAULTS = {
  'ui.appName': 'AMO',
  'audit.retentionDays': 365,
} as const

export class SettingsService {
  constructor(
    private readonly repo: SettingsRepository,
    private readonly env: Env,
  ) {}

  async get(): Promise<AppSettingsDTO> {
    const values = await this.repo.getValues()
    return {
      values,
      effective: {
        syncIntervalSeconds: this.number(values['sync.intervalSeconds'], this.env.GENIEACS_SYNC_INTERVAL_SECONDS),
        onlineThresholdSeconds: this.number(values['sync.onlineThresholdSeconds'], this.env.ONLINE_THRESHOLD_SECONDS),
        syncEnabled: this.boolean(values['sync.enabled'], true),
        autoCreateInventory: this.boolean(values['sync.autoCreateInventory'], true),
        appName: this.string(values['ui.appName'], DEFAULTS['ui.appName']),
        auditRetentionDays: this.number(values['audit.retentionDays'], DEFAULTS['audit.retentionDays']),
      },
      remotePolicy: {
        allowedPorts: this.env.REMOTE_ALLOWED_PORTS,
        allowedSchemes: this.env.REMOTE_ALLOWED_SCHEMES as RemoteScheme[],
        allowedCidrs: this.env.REMOTE_ALLOWED_CIDRS,
      },
    }
  }

  async update(values: Record<string, unknown>, userId: number | null): Promise<AppSettingsDTO> {
    for (const [key, value] of Object.entries(values)) {
      this.validate(key, value)
      await this.repo.setValue(key, value, userId)
    }
    return this.get()
  }

  private validate(key: string, value: unknown): void {
    switch (key) {
      case 'sync.intervalSeconds':
        if (!Number.isInteger(value) || (value as number) < 5 || (value as number) > 86_400) {
          throw Errors.validation('Interval sinkronisasi harus bilangan bulat 5–86400 detik.')
        }
        break
      case 'sync.onlineThresholdSeconds':
        if (!Number.isInteger(value) || (value as number) < 30 || (value as number) > 86_400) {
          throw Errors.validation('Ambang online harus bilangan bulat 30–86400 detik.')
        }
        break
      case 'sync.enabled':
        if (typeof value !== 'boolean') throw Errors.validation('sync.enabled harus boolean.')
        break
      case 'sync.autoCreateInventory':
        if (typeof value !== 'boolean') {
          throw Errors.validation('sync.autoCreateInventory harus boolean.')
        }
        break
      case 'ui.appName':
        if (typeof value !== 'string' || value.trim() === '' || value.length > 60) {
          throw Errors.validation('Nama aplikasi harus 1–60 karakter.')
        }
        break
      case 'audit.retentionDays':
        if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > 3650) {
          throw Errors.validation('Retensi audit harus bilangan bulat 1–3650 hari.')
        }
        break
      default:
        throw Errors.validation(`Kunci pengaturan "${key}" tidak dikenal.`)
    }
  }

  // ── Pemetaan parameter GenieACS ───────────────────────────────────────────

  async listParameterMap(): Promise<ParameterMapRow[]> {
    return this.repo.listParameterMap()
  }

  async createParameterMap(
    input: {
      fieldKey: ParamMapField
      manufacturer?: string | null
      model?: string | null
      paramPath: string
      priority?: number
      isActive?: boolean
    },
  ): Promise<ParameterMapRow> {
    const id = await this.repo.insertParameterMap({
      fieldKey: input.fieldKey,
      manufacturer: input.manufacturer ?? null,
      model: input.model ?? null,
      paramPath: input.paramPath.trim(),
      priority: input.priority ?? 100,
      isActive: input.isActive ?? true,
    })
    const rows = await this.repo.listParameterMap()
    const created = rows.find((r) => r.id === id)
    if (!created) throw Errors.notFound('Pemetaan parameter')
    return created
  }

  async updateParameterMap(
    id: number,
    patch: {
      fieldKey?: ParamMapField
      manufacturer?: string | null
      model?: string | null
      paramPath?: string
      priority?: number
      isActive?: boolean
    },
  ): Promise<ParameterMapRow> {
    await this.repo.updateParameterMap(id, patch)
    const rows = await this.repo.listParameterMap()
    const updated = rows.find((r) => r.id === id)
    if (!updated) throw Errors.notFound('Pemetaan parameter')
    return updated
  }

  async deleteParameterMap(id: number): Promise<void> {
    const deleted = await this.repo.deleteParameterMap(id)
    if (!deleted) throw Errors.notFound('Pemetaan parameter')
  }

  // ── Helper tipe ───────────────────────────────────────────────────────────

  private number(value: unknown, fallback: number): number {
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback
  }

  private boolean(value: unknown, fallback: boolean): boolean {
    return typeof value === 'boolean' ? value : fallback
  }

  private string(value: unknown, fallback: string): string {
    return typeof value === 'string' && value.trim() !== '' ? value : fallback
  }
}
