import type { DashboardSummaryDTO } from '@amo/shared'
import type { DashboardRepository } from './dashboard.repository'

export class DashboardService {
  constructor(private readonly repo: DashboardRepository) {}

  async getSummary(): Promise<DashboardSummaryDTO> {
    // Tiga query independen → jalankan paralel.
    const [totals, recent, lastSyncedAt] = await Promise.all([
      this.repo.getTotals(),
      this.repo.getRecent(),
      this.repo.getLastSyncedAt(),
    ])
    return {
      totals,
      recent: recent.map((r) => ({ ...r, lastSyncedAt: r.lastSyncedAt?.toISOString() ?? null })),
      lastSyncedAt: lastSyncedAt?.toISOString() ?? null,
    }
  }
}
