import type { Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise'
import type { OnlineStatus, SyncRunStatus, SyncTrigger } from '@amo/shared'

/**
 * REPOSITORY sinkronisasi GenieACS (PRD §8.4, §11).
 *
 * Aturan penting:
 *  - `upsertDevice` HANYA menulis kolom milik ACS pada `onu_devices`.
 *    `onu_inventory` (metadata manual) TIDAK PERNAH disentuh → aman dari sync.
 *  - Upsert idempoten lewat UNIQUE `genieacs_device_id` (sync berulang tak menduplikasi).
 *  - Autolink: bila serial cocok dengan inventaris yang belum tertaut → set inventory_id.
 */

export interface DeviceUpsert {
  genieacsDeviceId: string
  serialNumber: string | null
  manufacturer: string | null
  model: string | null
  lastInformAt: Date | null
  lastSyncedAt: Date
  onlineStatus: OnlineStatus
  parametersJson: string | null
  syncError: string | null
}

export interface SyncRunRow {
  id: number
  triggerType: SyncTrigger
  triggeredBy: number | null
  triggeredByName: string | null
  startedAt: Date
  finishedAt: Date | null
  status: SyncRunStatus
  foundCount: number
  successCount: number
  failedCount: number
  errorSummary: string | null
}

interface RunDbRow extends RowDataPacket {
  id: number
  trigger_type: SyncTrigger
  triggered_by: number | null
  triggered_by_name: string | null
  started_at: Date
  finished_at: Date | null
  status: SyncRunStatus
  found_count: number
  success_count: number
  failed_count: number
  error_summary: string | null
}

const toRun = (r: RunDbRow): SyncRunRow => ({
  id: r.id,
  triggerType: r.trigger_type,
  triggeredBy: r.triggered_by,
  triggeredByName: r.triggered_by_name,
  startedAt: r.started_at,
  finishedAt: r.finished_at,
  status: r.status,
  foundCount: Number(r.found_count),
  successCount: Number(r.success_count),
  failedCount: Number(r.failed_count),
  errorSummary: r.error_summary,
})

export class SyncRepository {
  constructor(private readonly db: Pool) {}

  async startRun(input: { trigger: SyncTrigger; userId: number | null; requestId: string | null }): Promise<number> {
    const [res] = await this.db.query<ResultSetHeader>(
      `INSERT INTO sync_runs (trigger_type, triggered_by, started_at, status, request_id)
       VALUES (?, ?, UTC_TIMESTAMP(), 'running', ?)`,
      [input.trigger, input.userId, input.requestId],
    )
    return res.insertId
  }

  async finishRun(
    id: number,
    result: {
      status: SyncRunStatus
      found: number
      success: number
      failed: number
      errorSummary: string | null
    },
  ): Promise<void> {
    await this.db.query(
      `UPDATE sync_runs
          SET finished_at = UTC_TIMESTAMP(), status = ?, found_count = ?, success_count = ?,
              failed_count = ?, error_summary = ?
        WHERE id = ?`,
      [result.status, result.found, result.success, result.failed, result.errorSummary, id],
    )
  }

  /** Upsert idempoten. Mengembalikan id baris `onu_devices`. */
  async upsertDevice(d: DeviceUpsert): Promise<number> {
    await this.db.query(
      `INSERT INTO onu_devices
         (genieacs_device_id, serial_number, manufacturer, model, last_inform_at, last_synced_at,
          online_status, parameters_json, sync_error)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         serial_number   = VALUES(serial_number),
         manufacturer    = VALUES(manufacturer),
         model           = VALUES(model),
         last_inform_at  = VALUES(last_inform_at),
         last_synced_at  = VALUES(last_synced_at),
         online_status   = VALUES(online_status),
         parameters_json = VALUES(parameters_json),
         sync_error      = VALUES(sync_error)`,
      [
        d.genieacsDeviceId,
        d.serialNumber,
        d.manufacturer,
        d.model,
        d.lastInformAt,
        d.lastSyncedAt,
        d.onlineStatus,
        d.parametersJson,
        d.syncError,
      ],
    )
    const [rows] = await this.db.query<RowDataPacket[]>(
      'SELECT id FROM onu_devices WHERE genieacs_device_id = ? LIMIT 1',
      [d.genieacsDeviceId],
    )
    return Number(rows[0]?.id ?? 0)
  }

  /**
   * Tautkan device ke inventaris bila serial cocok dan inventaris belum tertaut.
   * Mengembalikan jumlah baris yang ditautkan.
   */
  async autolinkBySerial(deviceId: number, serialNumber: string | null): Promise<number> {
    if (!serialNumber) return 0
    const [res] = await this.db.query<ResultSetHeader>(
      `UPDATE onu_devices d
         JOIN onu_inventory i ON i.serial_number = d.serial_number
          SET d.inventory_id = i.id
        WHERE d.id = ? AND d.inventory_id IS NULL AND i.is_active = 1`,
      [deviceId],
    )
    return res.affectedRows
  }

  /** Tandai device yang gagal diproses (tanpa mengubah status online lama). */
  async markDeviceError(genieacsDeviceId: string, message: string): Promise<void> {
    await this.db.query(
      'UPDATE onu_devices SET sync_error = ?, last_synced_at = UTC_TIMESTAMP() WHERE genieacs_device_id = ?',
      [message.slice(0, 2000), genieacsDeviceId],
    )
  }

  /**
   * AUTO-CREATE inventaris draft untuk device yang belum tertaut (fitur baru).
   *
   * ATOMIK & idempoten:
   *  - `INSERT ... SELECT ... WHERE d.inventory_id IS NULL` → bila dua sync bersamaan,
   *    hanya satu yang berhasil membuat baris (yang lain melihat inventory_id terisi).
   *  - Serial duplikat dengan inventaris lain → UNIQUE KEY uq_onu_serial menolak INSERT;
   *    ditangkap dan dianggap "sudah ada" (device bisa ditautkan manual nanti).
   *  - Setelah insert, `onu_devices.inventory_id` diisi agar sync berikutnya tidak
   *    membuat draft lagi.
   */
  async createDraftInventoryIfUnlinked(
    deviceId: number,
    draft: {
      name: string
      serialNumber: string | null
      manufacturer: string | null
      model: string | null
      uuid: string
      createdAt: Date
    },
  ): Promise<{ inventoryId: number; name: string } | null> {
    try {
      const [res] = await this.db.query<ResultSetHeader>(
        `INSERT INTO onu_inventory
           (uuid, name, serial_number, manufacturer, model, auto_created, source_device_id, created_at)
         SELECT ?, ?, ?, ?, ?, 1, d.id, UTC_TIMESTAMP()
           FROM onu_devices d
          WHERE d.id = ? AND d.inventory_id IS NULL`,
        [draft.uuid, draft.name, draft.serialNumber, draft.manufacturer, draft.model, deviceId],
      )
      if (res.affectedRows === 0) return null // sudah tertaut (race) → tidak apa-apa

      const inventoryId = res.insertId
      await this.db.query('UPDATE onu_devices SET inventory_id = ? WHERE id = ?', [inventoryId, deviceId])
      return { inventoryId, name: draft.name }
    } catch (err) {
      // ER_DUP_ENTRY (1062): serial sudah terdaftar di inventaris lain → biarkan penautan manual.
      if ((err as { code?: string }).code === 'ER_DUP_ENTRY') return null
      throw err
    }
  }

  async listRuns(limit: number): Promise<SyncRunRow[]> {
    const [rows] = await this.db.query<RunDbRow[]>(
      `SELECT r.id, r.trigger_type, r.triggered_by, u.name AS triggered_by_name, r.started_at,
              r.finished_at, r.status, r.found_count, r.success_count, r.failed_count, r.error_summary
         FROM sync_runs r
         LEFT JOIN users u ON u.id = r.triggered_by
        ORDER BY r.started_at DESC, r.id DESC
        LIMIT ?`,
      [limit],
    )
    return rows.map(toRun)
  }

  async lastRun(): Promise<SyncRunRow | null> {
    const runs = await this.listRuns(1)
    return runs[0] ?? null
  }

  async lastSyncedAt(): Promise<Date | null> {
    const [rows] = await this.db.query<RowDataPacket[]>(
      'SELECT MAX(last_synced_at) AS last_synced_at FROM onu_devices',
    )
    const value = rows[0]?.last_synced_at
    return value ? new Date(value) : null
  }

  /** Path parameter tambahan dari `device_parameter_map` (admin), dikelompokkan per field. */
  async loadParameterMap(): Promise<Record<string, string[]>> {
    const [rows] = await this.db.query<RowDataPacket[]>(
      `SELECT field_key, param_path
         FROM device_parameter_map
        WHERE is_active = 1
        ORDER BY field_key, priority ASC, id ASC`,
    )
    const map: Record<string, string[]> = {}
    for (const r of rows) {
      const key = String(r.field_key)
      ;(map[key] ??= []).push(String(r.param_path))
    }
    return map
  }
}
