import type { Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise'
import type { OnlineStatus, RemoteScheme } from '@amo/shared'

/**
 * REPOSITORY inventaris — satu-satunya tempat SQL untuk `onu_inventory` & `onu_devices`.
 *
 * Prinsip (PRD §6):
 *  - SELALU placeholder `?`; kolom/arah sort dipilih dari WHITELIST (tidak pernah
 *    menyambung string dari user).
 *  - Data manual (AMO) dan data ACS dibedakan: sync hanya menulis kolom `onu_devices`.
 *  - `db.query()` (bukan `execute()`) agar Date dikonversi sesuai `timezone: 'Z'`.
 */

export interface InventoryRow {
  id: number
  uuid: string
  name: string
  serialNumber: string | null
  oui: string | null
  productClass: string | null
  manufacturer: string | null
  model: string | null
  managementIp: string | null
  remoteScheme: RemoteScheme
  remotePort: number
  locationName: string | null
  address: string | null
  latitude: number | null
  longitude: number | null
  notes: string | null
  isActive: boolean
  createdAt: Date
  updatedAt: Date
  // ── dari onu_devices (LEFT JOIN) ──
  deviceId: number | null
  genieacsDeviceId: string | null
  deviceSerialNumber: string | null
  deviceManufacturer: string | null
  deviceModel: string | null
  deviceProductClass: string | null
  deviceManagementIp: string | null
  lastInformAt: Date | null
  lastSyncedAt: Date | null
  onlineStatus: OnlineStatus
  syncError: string | null
  parametersJson: unknown
}

interface Row extends RowDataPacket {
  id: number
  uuid: string
  name: string
  serial_number: string | null
  oui: string | null
  product_class: string | null
  manufacturer: string | null
  model: string | null
  management_ip: string | null
  remote_scheme: RemoteScheme
  remote_port: number
  location_name: string | null
  address: string | null
  latitude: number | null
  longitude: number | null
  notes: string | null
  is_active: number
  created_at: Date
  updated_at: Date
  device_id: number | null
  genieacs_device_id: string | null
  device_serial_number: string | null
  device_manufacturer: string | null
  device_model: string | null
  device_product_class: string | null
  device_management_ip: string | null
  last_inform_at: Date | null
  last_synced_at: Date | null
  online_status: OnlineStatus | null
  sync_error: string | null
  parameters_json: unknown
}

  const SELECT_COLUMNS = `
  i.id, i.uuid, i.name, i.serial_number, i.oui, i.product_class, i.manufacturer, i.model,
  i.management_ip, i.remote_scheme, i.remote_port, i.location_name, i.address,
  i.latitude, i.longitude, i.notes, i.is_active, i.created_at, i.updated_at,
  d.id AS device_id, d.genieacs_device_id, d.serial_number AS device_serial_number,
  d.manufacturer AS device_manufacturer, d.model AS device_model,
  d.product_class AS device_product_class,
  d.management_ip AS device_management_ip,
  d.last_inform_at, d.last_synced_at, d.online_status, d.sync_error, d.parameters_json`

const FROM = 'FROM onu_inventory i LEFT JOIN onu_devices d ON d.inventory_id = i.id'

const toRow = (r: Row): InventoryRow => ({
  id: r.id,
  uuid: r.uuid,
  name: r.name,
  serialNumber: r.serial_number,
  oui: r.oui,
  productClass: r.product_class,
  manufacturer: r.manufacturer,
  model: r.model,
  managementIp: r.management_ip,
  remoteScheme: r.remote_scheme,
  remotePort: Number(r.remote_port),
  locationName: r.location_name,
  address: r.address,
  latitude: r.latitude === null ? null : Number(r.latitude),
  longitude: r.longitude === null ? null : Number(r.longitude),
  notes: r.notes,
  isActive: r.is_active === 1,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  deviceId: r.device_id,
  genieacsDeviceId: r.genieacs_device_id,
  deviceSerialNumber: r.device_serial_number,
  deviceManufacturer: r.device_manufacturer,
  deviceModel: r.device_model,
  deviceProductClass: r.device_product_class,
  deviceManagementIp: r.device_management_ip,
  lastInformAt: r.last_inform_at,
  lastSyncedAt: r.last_synced_at,
  onlineStatus: r.online_status ?? 'unknown',
  syncError: r.sync_error,
  parametersJson: r.parameters_json,
})

/** Whitelist kolom sort → ekspresi SQL. Kunci TIDAK PERNAH berasal dari input mentah. */
const SORT_COLUMNS = {
  name: 'i.name',
  createdAt: 'i.created_at',
  lastSyncedAt: 'd.last_synced_at',
  status: `CASE
    WHEN d.id IS NULL OR d.last_inform_at IS NULL THEN 'unknown'
    WHEN TIMESTAMPADD(SECOND, ?, d.last_inform_at) >= UTC_TIMESTAMP(3) THEN 'online'
    ELSE 'offline'
  END`,
} as const

export interface ListFilters {
  q?: string
  status?: OnlineStatus | 'all'
  manufacturer?: string
  model?: string
  linked?: 'all' | 'linked' | 'unlinked'
  needsData?: boolean
  sort?: keyof typeof SORT_COLUMNS
  order?: 'asc' | 'desc'
  onlineThresholdSeconds?: number
  page: number
  pageSize: number
}

export interface InsertInventory {
  uuid: string
  name: string
  serialNumber: string | null
  manufacturer: string | null
  model: string | null
  managementIp: string | null
  remoteScheme: RemoteScheme
  remotePort: number
  locationName: string | null
  address: string | null
  latitude: number | null
  longitude: number | null
  notes: string | null
  createdBy: number | null
}

export type UpdateInventory = Partial<Omit<InsertInventory, 'uuid' | 'createdBy'>> & {
  isActive?: boolean
}

export class InventoryRepository {
  constructor(private readonly db: Pool) {}

  async list(filters: ListFilters): Promise<{ rows: InventoryRow[]; total: number }> {
    const where: string[] = ['i.is_active = 1']
    const params: unknown[] = []

    if (filters.q) {
      // LIKE dengan wildcard di sisi server; `%`/`_` dari user di-escape agar tidak jadi wildcard liar.
      const like = `%${filters.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`
      where.push(
        '(i.name LIKE ? OR i.serial_number LIKE ? OR i.management_ip LIKE ? OR i.location_name LIKE ? OR d.serial_number LIKE ?)',
      )
      params.push(like, like, like, like, like)
    }
    if (filters.status && filters.status !== 'all') {
      where.push(`(${SORT_COLUMNS.status}) = ?`)
      params.push(filters.onlineThresholdSeconds ?? 600, filters.status)
    }
    if (filters.manufacturer) {
      where.push('COALESCE(i.manufacturer, d.manufacturer) = ?')
      params.push(filters.manufacturer)
    }
    if (filters.model) {
      where.push('COALESCE(i.model, d.model) = ?')
      params.push(filters.model)
    }
    if (filters.linked === 'linked') where.push('d.id IS NOT NULL')
    if (filters.linked === 'unlinked') where.push('d.id IS NULL')
    if (filters.needsData) {
      where.push('(i.latitude IS NULL OR i.longitude IS NULL OR i.serial_number IS NULL)')
    }

    const whereSql = `WHERE ${where.join(' AND ')}`
    const sortCol = SORT_COLUMNS[filters.sort ?? 'createdAt']
    const direction = filters.order === 'asc' ? 'ASC' : 'DESC'
    const offset = (filters.page - 1) * filters.pageSize
    const sortParams = filters.sort === 'status' ? [filters.onlineThresholdSeconds ?? 600] : []

    const [countRows] = await this.db.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS total ${FROM} ${whereSql}`,
      params,
    )
    const total = Number(countRows[0]?.total ?? 0)

    const [rows] = await this.db.query<Row[]>(
      `SELECT ${SELECT_COLUMNS} ${FROM} ${whereSql}
        ORDER BY ${sortCol} ${direction}, i.id DESC
        LIMIT ? OFFSET ?`,
      [...params, ...sortParams, filters.pageSize, offset],
    )
    return { rows: rows.map(toRow), total }
  }

  async findByUuid(uuid: string): Promise<InventoryRow | null> {
    const [rows] = await this.db.query<Row[]>(
      `SELECT ${SELECT_COLUMNS} ${FROM} WHERE i.uuid = ? LIMIT 1`,
      [uuid],
    )
    return rows[0] ? toRow(rows[0]) : null
  }

  async findById(id: number): Promise<InventoryRow | null> {
    const [rows] = await this.db.query<Row[]>(
      `SELECT ${SELECT_COLUMNS} ${FROM} WHERE i.id = ? LIMIT 1`,
      [id],
    )
    return rows[0] ? toRow(rows[0]) : null
  }

  /** Cek duplikasi serial (case-insensitive via collation *_ai_ci). */
  async findBySerial(serial: string): Promise<InventoryRow | null> {
    const [rows] = await this.db.query<Row[]>(
      `SELECT ${SELECT_COLUMNS} ${FROM} WHERE i.serial_number = ? LIMIT 1`,
      [serial],
    )
    return rows[0] ? toRow(rows[0]) : null
  }

  async insert(input: InsertInventory): Promise<number> {
    const [res] = await this.db.query<ResultSetHeader>(
      `INSERT INTO onu_inventory
         (uuid, name, serial_number, manufacturer, model, management_ip, remote_scheme, remote_port,
          location_name, address, latitude, longitude, notes, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        input.uuid,
        input.name,
        input.serialNumber,
        input.manufacturer,
        input.model,
        input.managementIp,
        input.remoteScheme,
        input.remotePort,
        input.locationName,
        input.address,
        input.latitude,
        input.longitude,
        input.notes,
        input.createdBy,
      ],
    )
    return res.insertId
  }

  /** Update parsial. Kolom dibangun dari WHITELIST kunci, bukan dari nama field user. */
  async update(id: number, patch: UpdateInventory): Promise<void> {
    const columns: Record<keyof UpdateInventory, string> = {
      name: 'name',
      serialNumber: 'serial_number',
      manufacturer: 'manufacturer',
      model: 'model',
      managementIp: 'management_ip',
      remoteScheme: 'remote_scheme',
      remotePort: 'remote_port',
      locationName: 'location_name',
      address: 'address',
      latitude: 'latitude',
      longitude: 'longitude',
      notes: 'notes',
      isActive: 'is_active',
    }
    const sets: string[] = []
    const params: unknown[] = []
    for (const [key, column] of Object.entries(columns) as Array<[keyof UpdateInventory, string]>) {
      if (!(key in patch)) continue
      const value = patch[key]
      sets.push(`${column} = ?`)
      params.push(typeof value === 'boolean' ? (value ? 1 : 0) : value)
    }
    if (sets.length === 0) return
    params.push(id)
    await this.db.query(`UPDATE onu_inventory SET ${sets.join(', ')} WHERE id = ?`, params)
  }

  /** Perangkat aktif yang punya koordinat valid (PRD §3.4). */
  async listWithCoordinates(): Promise<InventoryRow[]> {
    const [rows] = await this.db.query<Row[]>(
      `SELECT ${SELECT_COLUMNS} ${FROM}
        WHERE i.is_active = 1
          AND i.latitude IS NOT NULL AND i.longitude IS NOT NULL
          AND i.latitude BETWEEN -90 AND 90 AND i.longitude BETWEEN -180 AND 180
        ORDER BY i.name ASC`,
    )
    return rows.map(toRow)
  }

  async countWithoutCoordinates(): Promise<number> {
    const [rows] = await this.db.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS total FROM onu_inventory
        WHERE is_active = 1 AND (latitude IS NULL OR longitude IS NULL)`,
    )
    return Number(rows[0]?.total ?? 0)
  }

  /** Daftar vendor/model unik untuk dropdown filter. */
  async listFacets(): Promise<{ manufacturers: string[]; models: string[] }> {
    const [manufacturers] = await this.db.query<RowDataPacket[]>(
      `SELECT DISTINCT COALESCE(i.manufacturer, d.manufacturer) AS v
         FROM onu_inventory i LEFT JOIN onu_devices d ON d.inventory_id = i.id
        WHERE i.is_active = 1 AND COALESCE(i.manufacturer, d.manufacturer) IS NOT NULL
        ORDER BY v`,
    )
    const [models] = await this.db.query<RowDataPacket[]>(
      `SELECT DISTINCT COALESCE(i.model, d.model) AS v
         FROM onu_inventory i LEFT JOIN onu_devices d ON d.inventory_id = i.id
        WHERE i.is_active = 1 AND COALESCE(i.model, d.model) IS NOT NULL
        ORDER BY v`,
    )
    return {
      manufacturers: manufacturers.map((r) => String(r.v)),
      models: models.map((r) => String(r.v)),
    }
  }

  /** Tautkan device GenieACS (by genieacs_device_id) ke record inventaris. */
  async linkDevice(inventoryId: number, genieacsDeviceId: string): Promise<boolean> {
    const [res] = await this.db.query<ResultSetHeader>(
      `UPDATE onu_devices SET inventory_id = ?
        WHERE genieacs_device_id = ? AND (inventory_id IS NULL OR inventory_id = ?)`,
      [inventoryId, genieacsDeviceId, inventoryId],
    )
    return res.affectedRows > 0
  }

  /**
   * SOFT-DELETE inventaris (fitur hapus): nonaktifkan record dan lepas SEMUA
   * penautan device ACS dalam satu transaksi. Mengembalikan jumlah device yang
   * dilepas. Baris tetap ada (riwayat audit aman), cukup tidak ikut list aktif.
   */
  async softDelete(id: number): Promise<number> {
    const conn = await this.db.getConnection()
    try {
      await conn.beginTransaction()
      await conn.query('UPDATE onu_inventory SET is_active = 0 WHERE id = ?', [id])
      const [res] = await conn.query<ResultSetHeader>(
        'UPDATE onu_devices SET inventory_id = NULL WHERE inventory_id = ?',
        [id],
      )
      await conn.commit()
      return res.affectedRows
    } catch (err) {
      await conn.rollback()
      throw err
    } finally {
      conn.release()
    }
  }

  async findDeviceByGenieId(genieacsDeviceId: string): Promise<{ id: number; inventoryId: number | null } | null> {
    const [rows] = await this.db.query<RowDataPacket[]>(
      'SELECT id, inventory_id FROM onu_devices WHERE genieacs_device_id = ? LIMIT 1',
      [genieacsDeviceId],
    )
    const r = rows[0]
    return r ? { id: Number(r.id), inventoryId: r.inventory_id === null ? null : Number(r.inventory_id) } : null
  }

  /**
   * Isi metadata inventaris yang MASIH KOSONG dari data device ACS (serial,
   * vendor, model, management IP). Dipakai saat create-with-link / quick-link
   * agar field terisi otomatis tanpa menimpa apa pun yang sudah diisi admin.
   */
  async fillInventoryFromDevice(inventoryId: number): Promise<void> {
    await this.db.query(
      `UPDATE onu_inventory i
         JOIN onu_devices d ON d.inventory_id = i.id
          SET i.serial_number = COALESCE(i.serial_number, d.serial_number),
              i.manufacturer  = COALESCE(i.manufacturer, d.manufacturer),
              i.model         = COALESCE(i.model, d.model),
              i.product_class = COALESCE(i.product_class, d.product_class),
              i.management_ip = COALESCE(i.management_ip, d.management_ip)
        WHERE i.id = ?`,
      [inventoryId],
    )
 }

  /**
   * Daftar perangkat ACS (onu_devices) yang BELUM tertaut ke inventaris mana pun.
   * Dipakai panel "Perangkat belum tertaut" & dropdown form Tambah/Tautkan.
   */
  async listUnlinkedDevices(limit = 50): Promise<
    Array<{
      id: number
      genieacsDeviceId: string
      serialNumber: string | null
      manufacturer: string | null
      model: string | null
      managementIp: string | null
      onlineStatus: OnlineStatus
      lastInformAt: Date | null
      lastSyncedAt: Date | null
    }>
  > {
    const [rows] = await this.db.query<RowDataPacket[]>(
      `SELECT id, genieacs_device_id, serial_number, manufacturer, model, management_ip,
              online_status, last_inform_at, last_synced_at
         FROM onu_devices
        WHERE inventory_id IS NULL
        ORDER BY last_synced_at DESC, id DESC
        LIMIT ?`,
      [limit],
    )
    return rows.map((r) => ({
      id: Number(r.id),
      genieacsDeviceId: String(r.genieacs_device_id),
      serialNumber: (r.serial_number as string | null) ?? null,
      manufacturer: (r.manufacturer as string | null) ?? null,
      model: (r.model as string | null) ?? null,
      managementIp: (r.management_ip as string | null) ?? null,
      onlineStatus: (r.online_status as OnlineStatus) ?? 'unknown',
      lastInformAt: (r.last_inform_at as Date | null) ?? null,
      lastSyncedAt: (r.last_synced_at as Date | null) ?? null,
    }))
  }
}
