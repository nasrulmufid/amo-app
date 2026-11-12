import { randomUUID } from 'node:crypto'
import { isIP } from 'node:net'
import type {
  DeviceDisplayStatus,
  InventoryCreateInput,
  InventoryDetailDTO,
  InventoryListItemDTO,
  InventoryMapPointDTO,
  InventoryUpdateInput,
  OnlineStatus,
} from '@amo/shared'
import type { Env } from '../../config/env'
import { Errors } from '../../common/errors'
import { deriveDeviceDisplayStatus, deriveOnlineStatus } from '../genieacs/genieacs.mapper'
import type { InventoryRepository, InventoryRow } from './inventory.repository'

/**
 * Logika bisnis inventaris (PRD §3.3, §3.4, §12).
 *
 * Aturan yang ditegakkan di sini (bukan di route):
 *  - UUID dibuat di BACKEND (PRD §12) — tidak pernah diterima dari client.
 *  - Serial number duplikat → 409 CONFLICT.
 *  - Koordinat harus sepasang & dalam rentang valid; tidak pernah di-default ke 0,0.
 *  - Port/skema remote harus sesuai kebijakan server (REMOTE_ALLOWED_PORTS/SCHEMES).
 *  - `management_ip` harus IP literal (bukan hostname) agar target proxy tidak bisa
 *    diarahkan ke host lain lewat DNS (PRD §10.1).
 *  - Status tampilan diturunkan dari data ACS + kesegaran sync (PRD §12).
 */

/** Data dianggap "stale" bila sync terakhir lebih lama dari kelipatan interval ini. */
const STALE_FACTOR = 3

export interface InventoryFacets {
  manufacturers: string[]
  models: string[]
}

export class InventoryService {
  constructor(
    private readonly repo: InventoryRepository,
    private readonly env: Env,
  ) {}

  // ── Baca ──────────────────────────────────────────────────────────────────

  async list(query: {
    page: number
    pageSize: number
    q?: string
    status?: OnlineStatus | 'all'
    manufacturer?: string
    model?: string
    linked?: 'all' | 'linked' | 'unlinked'
    needsData?: boolean
    sort?: 'name' | 'createdAt' | 'lastSyncedAt' | 'status'
    order?: 'asc' | 'desc'
  }) {
    const { rows, total } = await this.repo.list({
      ...query,
      onlineThresholdSeconds: this.env.ONLINE_THRESHOLD_SECONDS,
    })
    return {
      items: rows.map((r) => this.toListItem(r)),
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: Math.ceil(total / query.pageSize),
      },
    }
  }

  async facets(): Promise<InventoryFacets> {
    return this.repo.listFacets()
  }

  /** Daftar perangkat ACS yang belum tertaut ke inventaris (panel & dropdown form). */
  async listUnlinkedDevices() {
    const devices = await this.repo.listUnlinkedDevices(100)
    return {
      items: devices.map((d) => ({
        id: d.id,
        genieacsDeviceId: d.genieacsDeviceId,
        serialNumber: d.serialNumber,
        manufacturer: d.manufacturer,
        model: d.model,
        managementIp: d.managementIp,
        onlineStatus: d.onlineStatus,
        lastInformAt: d.lastInformAt?.toISOString() ?? null,
        lastSyncedAt: d.lastSyncedAt?.toISOString() ?? null,
      })),
    }
  }

  async getByUuid(uuid: string): Promise<InventoryDetailDTO> {
    const row = await this.repo.findByUuid(uuid)
    if (!row) throw Errors.notFound('ONU')
    return this.toDetail(row)
  }

  async map(): Promise<{ items: InventoryMapPointDTO[]; withoutCoordinates: number }> {
    const [rows, withoutCoordinates] = await Promise.all([
      this.repo.listWithCoordinates(),
      this.repo.countWithoutCoordinates(),
    ])
    return {
      items: rows.map((r) => ({
        uuid: r.uuid,
        name: r.name,
        serialNumber: r.serialNumber ?? r.deviceSerialNumber,
        manufacturer: r.manufacturer ?? r.deviceManufacturer,
        model: r.model ?? r.deviceModel,
        // Non-null dijamin oleh WHERE di repository.
        latitude: r.latitude as number,
        longitude: r.longitude as number,
        locationName: r.locationName,
        onlineStatus: this.onlineStatus(r),
        displayStatus: this.displayStatus(r),
      })),
      withoutCoordinates,
    }
  }

  // ── Tulis ─────────────────────────────────────────────────────────────────

  async create(input: InventoryCreateInput, actorId: number | null): Promise<InventoryDetailDTO> {
    const serial = normalizeOptional(input.serialNumber)
    if (serial) {
      const existing = await this.repo.findBySerial(serial)
      if (existing) throw Errors.conflict(`Serial number ${serial} sudah terdaftar pada perangkat lain.`)
    }

    const { latitude, longitude } = this.validateCoordinates(input.latitude, input.longitude)
    const remoteScheme = input.remoteScheme ?? 'http'
    const remotePort = input.remotePort ?? (remoteScheme === 'https' ? 443 : 80)
    this.assertRemotePolicy(remoteScheme, remotePort)
    const managementIp = this.validateManagementIp(input.managementIp)

    const uuid = randomUUID()
    const id = await this.repo.insert({
      uuid,
      name: input.name.trim(),
      serialNumber: serial,
      manufacturer: normalizeOptional(input.manufacturer),
      model: normalizeOptional(input.model),
      managementIp,
      remoteScheme,
      remotePort,
      locationName: normalizeOptional(input.locationName),
      address: normalizeOptional(input.address),
      latitude,
      longitude,
      notes: normalizeOptional(input.notes),
      createdBy: actorId,
    })

    // Tautan opsional ke device GenieACS yang sudah tersinkron.
    const genieId = normalizeOptional(input.genieacsDeviceId)
    if (genieId) {
      const device = await this.repo.findDeviceByGenieId(genieId)
      if (!device) throw Errors.notFound('Perangkat GenieACS')
      if (device.inventoryId !== null && device.inventoryId !== id) {
        throw Errors.conflict('Perangkat GenieACS tersebut sudah tertaut ke inventaris lain.')
      }
      await this.repo.linkDevice(id, genieId)
      // Isi serial/vendor/model/management IP yang masih kosong dari data ACS.
      await this.repo.fillInventoryFromDevice(id)
    }

    const created = await this.repo.findById(id)
    if (!created) throw Errors.notFound('ONU')
    return this.toDetail(created)
  }

  async update(uuid: string, patch: InventoryUpdateInput): Promise<InventoryDetailDTO> {
    const current = await this.repo.findByUuid(uuid)
    if (!current) throw Errors.notFound('ONU')

    // Serial duplikat (bila diubah).
    if (patch.serialNumber !== undefined) {
      const serial = normalizeOptional(patch.serialNumber)
      if (serial && serial !== current.serialNumber) {
        const existing = await this.repo.findBySerial(serial)
        if (existing && existing.id !== current.id) {
          throw Errors.conflict(`Serial number ${serial} sudah terdaftar pada perangkat lain.`)
        }
      }
    }

    // Koordinat: bila salah satu diubah, validasi PASANGAN hasil akhirnya.
    const nextLat = patch.latitude !== undefined ? patch.latitude : current.latitude
    const nextLon = patch.longitude !== undefined ? patch.longitude : current.longitude
    const { latitude, longitude } = this.validateCoordinates(nextLat, nextLon)

    const nextScheme = patch.remoteScheme ?? current.remoteScheme
    const nextPort = patch.remotePort ?? current.remotePort
    this.assertRemotePolicy(nextScheme, nextPort)

    const managementIp =
      patch.managementIp !== undefined ? this.validateManagementIp(patch.managementIp) : undefined

    await this.repo.update(current.id, {
      ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
      ...(patch.serialNumber !== undefined ? { serialNumber: normalizeOptional(patch.serialNumber) } : {}),
      ...(patch.manufacturer !== undefined ? { manufacturer: normalizeOptional(patch.manufacturer) } : {}),
      ...(patch.model !== undefined ? { model: normalizeOptional(patch.model) } : {}),
      ...(managementIp !== undefined ? { managementIp } : {}),
      ...(patch.remoteScheme !== undefined ? { remoteScheme: patch.remoteScheme } : {}),
      ...(patch.remotePort !== undefined ? { remotePort: patch.remotePort } : {}),
      ...(patch.locationName !== undefined ? { locationName: normalizeOptional(patch.locationName) } : {}),
      ...(patch.address !== undefined ? { address: normalizeOptional(patch.address) } : {}),
      ...(patch.latitude !== undefined || patch.longitude !== undefined ? { latitude, longitude } : {}),
      ...(patch.notes !== undefined ? { notes: normalizeOptional(patch.notes) } : {}),
      ...(patch.isActive !== undefined ? { isActive: patch.isActive } : {}),
    })

    const updated = await this.repo.findById(current.id)
    if (!updated) throw Errors.notFound('ONU')
    return this.toDetail(updated)
  }

  /**
   * Hapus inventaris (SOFT-DELETE, PRD §3.4): `is_active = 0` + lepas penautan
   * device ACS. Data tidak pernah dihapus fisik agar riwayat audit tetap utuh.
   * Device ACS yang tertaut menjadi "belum tertaut" lagi → sync berikutnya
   * (bila auto-create aktif) akan membuat draft baru, atau admin menautkan manual.
   */
  async remove(uuid: string): Promise<{ uuid: string; unlinkedDevices: number }> {
    const current = await this.repo.findByUuid(uuid)
    if (!current) throw Errors.notFound('ONU')
    const unlinkedDevices = await this.repo.softDelete(current.id)
    return { uuid: current.uuid, unlinkedDevices }
  }

  // ── Validasi ──────────────────────────────────────────────────────────────

  private validateCoordinates(
    latitude: number | null | undefined,
    longitude: number | null | undefined,
  ): { latitude: number | null; longitude: number | null } {
    const lat = latitude ?? null
    const lon = longitude ?? null
    // Sepasang atau tidak sama sekali — koordinat setengah tidak bermakna.
    if ((lat === null) !== (lon === null)) {
      throw Errors.validation('Latitude dan longitude harus diisi bersama atau dikosongkan bersama.')
    }
    if (lat === null || lon === null) return { latitude: null, longitude: null }
    if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
      throw Errors.validation('Latitude harus berada di antara -90 dan 90.')
    }
    if (!Number.isFinite(lon) || lon < -180 || lon > 180) {
      throw Errors.validation('Longitude harus berada di antara -180 dan 180.')
    }
    return { latitude: lat, longitude: lon }
  }

  private assertRemotePolicy(scheme: string, port: number): void {
    if (!this.env.REMOTE_ALLOWED_SCHEMES.includes(scheme as 'http' | 'https')) {
      throw Errors.validation(`Skema remote "${scheme}" tidak diizinkan.`)
    }
    if (!this.env.REMOTE_ALLOWED_PORTS.includes(port)) {
      throw Errors.validation(
        `Port remote ${port} tidak diizinkan. Port yang diizinkan: ${this.env.REMOTE_ALLOWED_PORTS.join(', ')}.`,
      )
    }
  }

  private validateManagementIp(value: string | null | undefined): string | null {
    const ip = normalizeOptional(value)
    if (ip === null) return null
    if (isIP(ip) === 0) {
      throw Errors.validation('Management IP harus berupa alamat IPv4/IPv6 literal (bukan hostname).')
    }
    return ip
  }

  // ── Pemetaan ke DTO ───────────────────────────────────────────────────────

  /**
   * Status tampilan (PRD §12):
   *  - belum tertaut ACS            → 'unknown' (BUKAN offline)
   *  - sync terakhir gagal          → 'sync_error'
   *  - data lebih tua dari ambang   → 'stale'
   *  - selain itu                   → dihitung dari lastInformAt terbaru
   */
  private displayStatus(row: InventoryRow): DeviceDisplayStatus {
    return deriveDeviceDisplayStatus(
      {
        linked: row.deviceId !== null,
        syncError: row.syncError,
        lastSyncedAt: row.lastSyncedAt,
        lastInformAt: row.lastInformAt,
      },
      {
        onlineThresholdSeconds: this.env.ONLINE_THRESHOLD_SECONDS,
        staleAfterSeconds: this.env.GENIEACS_SYNC_INTERVAL_SECONDS * STALE_FACTOR,
      },
    )
  }

  private onlineStatus(row: InventoryRow): OnlineStatus {
    return deriveOnlineStatus(row.lastInformAt, this.env.ONLINE_THRESHOLD_SECONDS)
  }

  private toListItem(row: InventoryRow): InventoryListItemDTO {
    return {
      uuid: row.uuid,
      name: row.name,
      serialNumber: row.serialNumber ?? row.deviceSerialNumber,
      manufacturer: row.manufacturer ?? row.deviceManufacturer,
      model: row.model ?? row.deviceModel,
      // Metadata manual menang; bila kosong → pakai IP dari device ACS (IPTR069 dkk.).
      managementIp: row.managementIp ?? row.deviceManagementIp,
      locationName: row.locationName,
      onlineStatus: this.onlineStatus(row),
      displayStatus: this.displayStatus(row),
      lastInformAt: row.lastInformAt?.toISOString() ?? null,
      lastSyncedAt: row.lastSyncedAt?.toISOString() ?? null,
      isActive: row.isActive,
      linked: row.deviceId !== null,
    }
  }

  private toDetail(row: InventoryRow): InventoryDetailDTO {
    return {
      ...this.toListItem(row),
      oui: row.oui,
      productClass: row.productClass ?? row.deviceProductClass,
      remoteScheme: row.remoteScheme,
      remotePort: row.remotePort,
      address: row.address,
      latitude: row.latitude,
      longitude: row.longitude,
      notes: row.notes,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      device:
        row.deviceId !== null && row.genieacsDeviceId
          ? {
              genieacsDeviceId: row.genieacsDeviceId,
              lastInformAt: row.lastInformAt?.toISOString() ?? null,
              lastSyncedAt: row.lastSyncedAt?.toISOString() ?? null,
              onlineStatus: this.onlineStatus(row),
              syncError: row.syncError,
              parameters: (row.parametersJson as Record<string, unknown> | null) ?? null,
            }
          : null,
    }
  }
}

/** Trim + ubah string kosong menjadi null (kolom DB nullable). */
function normalizeOptional(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}
