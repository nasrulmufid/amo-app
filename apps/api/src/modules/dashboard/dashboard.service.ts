import type { DashboardSummaryDTO } from '@amo/shared'
import { deriveDeviceDisplayStatus } from '../genieacs/genieacs.mapper'
import type { SyncRuntimeConfig } from '../genieacs/sync.config'
import type { DashboardRepository } from './dashboard.repository'

export class DashboardService {
  constructor(
    private readonly repo: DashboardRepository,
    private readonly getSyncConfig: () => Promise<SyncRuntimeConfig>,
  ) {}

  async getSummary(): Promise<DashboardSummaryDTO> {
    // Query independen berjalan paralel; status dihitung dari lastInform aktual,
    // tidak memakai online_status snapshot yang bisa tertinggal dari GenieACS.
    const [baseTotals, statusRows, recentRows, lastSyncedAt, syncConfig] = await Promise.all([
      this.repo.getTotals(),
      this.repo.getStatusRows(),
      this.repo.getRecent(),
      this.repo.getLastSyncedAt(),
      this.getSyncConfig(),
    ])

    const now = new Date()
    const statusOptions = {
      onlineThresholdSeconds: syncConfig.onlineThresholdSeconds,
      staleAfterSeconds: syncConfig.intervalSeconds * 3,
      now,
    }
    const totals = { ...baseTotals, online: 0, offline: 0, unknown: 0, stale: 0, syncError: 0 }
    for (const row of statusRows) {
      const status = deriveDeviceDisplayStatus(
        {
          linked: row.device_id !== null,
          syncError: row.sync_error,
          lastSyncedAt: row.last_synced_at,
          lastInformAt: row.last_inform_at,
        },
        statusOptions,
      )
      if (status === 'online') totals.online++
      else if (status === 'offline') totals.offline++
      else if (status === 'stale') totals.stale++
      else if (status === 'sync_error') totals.syncError++
      else totals.unknown++
    }

    return {
      totals,
      recent: recentRows.map((row) => ({
        uuid: row.uuid,
        name: row.name,
        serialNumber: row.serialNumber,
        manufacturer: row.manufacturer,
        model: row.model,
        displayStatus: deriveDeviceDisplayStatus(
          {
            linked: row.linked,
            syncError: row.syncError,
            lastSyncedAt: row.lastSyncedAt,
            lastInformAt: row.lastInformAt,
          },
          statusOptions,
        ),
        lastSyncedAt: row.lastSyncedAt?.toISOString() ?? null,
      })),
      lastSyncedAt: lastSyncedAt?.toISOString() ?? null,
    }
  }
}
