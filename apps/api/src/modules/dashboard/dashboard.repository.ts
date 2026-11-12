import type { Pool, RowDataPacket } from 'mysql2/promise'

interface TotalsRow extends RowDataPacket {
  total: number
  needs_data: number
}
export interface DashboardStatusRow extends RowDataPacket {
  device_id: number | null
  sync_error: string | null
  last_inform_at: Date | null
  last_synced_at: Date | null
}
interface RecentRow extends RowDataPacket {
  uuid: string
  name: string
  serial_number: string | null
  manufacturer: string | null
  model: string | null
  device_id: number | null
  sync_error: string | null
  last_inform_at: Date | null
  last_synced_at: Date | null
}
interface LastSyncRow extends RowDataPacket {
  last_synced_at: Date | null
}

/**
 * ┌─ DEFINISI ANGKA DASHBOARD (PRD §16: "dapat ditelusuri ke definisi query") ─┐
 * │ Populasi  : onu_inventory WHERE is_active = 1  (inventaris yang aktif)      │
 * │ Status    : diturunkan dari last_inform_at GenieACS dan umur last_synced_at │
 * │             pada request; snapshot online_status tidak dipakai untuk UI.    │
 * │ total     : jumlah populasi                                                 │
 * │ online / offline / unknown / stale : status terkini + kesegaran sinkronisasi│
 * │ needsData : populasi yang latitude/longitude ATAU serial_number-nya NULL    │
 * │ lastSynced: MAX(onu_devices.last_synced_at) — kesegaran data terakhir       │
 * └─────────────────────────────────────────────────────────────────────────────┘
 * JOIN aman dari duplikasi karena onu_devices.inventory_id bersifat UNIQUE
 * (lihat migration 001).
 */
export class DashboardRepository {
  constructor(private readonly db: Pool) {}

  async getTotals() {
    const [rows] = await this.db.query<TotalsRow[]>(
      `SELECT
         COUNT(*)                                                             AS total,
         COALESCE(SUM(i.latitude IS NULL OR i.longitude IS NULL OR i.serial_number IS NULL), 0) AS needs_data
       FROM onu_inventory i
       WHERE i.is_active = 1`,
    )
    const r = rows[0]
    return {
      total: Number(r?.total ?? 0),
      needsData: Number(r?.needs_data ?? 0),
    }
  }

  /** Status minimal seluruh populasi aktif; dihitung service dari inform terakhir pada waktu request. */
  async getStatusRows(): Promise<DashboardStatusRow[]> {
    const [rows] = await this.db.query<DashboardStatusRow[]>(
      `SELECT d.id AS device_id, d.sync_error, d.last_inform_at, d.last_synced_at
         FROM onu_inventory i
         LEFT JOIN onu_devices d ON d.inventory_id = i.id
        WHERE i.is_active = 1`,
    )
    return rows
  }

  /** 5 perangkat terbaru didaftarkan. Field manual (inventaris) diutamakan atas data ACS. */
  async getRecent() {
    const [rows] = await this.db.query<RecentRow[]>(
      `SELECT i.uuid, i.name,
              COALESCE(i.serial_number, d.serial_number) AS serial_number,
              COALESCE(i.manufacturer,  d.manufacturer)  AS manufacturer,
              COALESCE(i.model,         d.model)         AS model,
              d.id AS device_id,
              d.sync_error,
              d.last_inform_at,
              d.last_synced_at
         FROM onu_inventory i
         LEFT JOIN onu_devices d ON d.inventory_id = i.id
        WHERE i.is_active = 1
        ORDER BY i.created_at DESC, i.id DESC
        LIMIT 5`,
    )
    return rows.map((r) => ({
      uuid: r.uuid,
      name: r.name,
      serialNumber: r.serial_number,
      manufacturer: r.manufacturer,
      model: r.model,
      linked: r.device_id !== null,
      syncError: r.sync_error,
      lastInformAt: r.last_inform_at,
      lastSyncedAt: r.last_synced_at,
    }))
  }

  async getLastSyncedAt(): Promise<Date | null> {
    const [rows] = await this.db.query<LastSyncRow[]>(
      'SELECT MAX(last_synced_at) AS last_synced_at FROM onu_devices',
    )
    return rows[0]?.last_synced_at ?? null
  }
}
