import type {
  DeviceDisplayStatus,
  OnlineStatus,
  ParamMapField,
  RemoteScheme,
  Role,
  SyncRunStatus,
  SyncTrigger,
} from './constants'

/**
 * Tipe DTO = bentuk JSON yang benar-benar lewat di jaringan.
 * (Tanggal selalu string ISO-8601 UTC.)
 *
 * Catatan: schema validasi runtime ada di API (TypeBox). Tipe di sini dipakai
 * web agar kompilasi gagal bila kontrak berubah. Jaga keduanya tetap sinkron.
 */

// ── Envelope respons (PRD §9.2 & §9.3) ──────────────────────────────────────
export interface ApiMeta {
  requestId: string
}
export interface ApiSuccess<T> {
  data: T
  meta: ApiMeta
}
export type ErrorCode =
  | 'AUTH_REQUIRED'
  | 'INVALID_CREDENTIALS'
  | 'FORBIDDEN'
  | 'CSRF_INVALID'
  | 'NOT_FOUND'
  | 'VALIDATION_ERROR'
  | 'BAD_REQUEST'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'NOT_IMPLEMENTED'
  | 'UPSTREAM_ERROR'
  | 'REMOTE_TARGET_NOT_ALLOWED'
  | 'REMOTE_UNAVAILABLE'
  | 'INTERNAL_ERROR'
export interface ApiFailure {
  error: { code: ErrorCode; message: string; requestId: string; details?: unknown }
}

export interface Pagination {
  page: number
  pageSize: number
  total: number
  totalPages: number
}
export interface Paginated<T> {
  items: T[]
  pagination: Pagination
}

// ── Auth ────────────────────────────────────────────────────────────────────
export interface UserDTO {
  id: number
  name: string
  email: string
  role: Role
  lastLoginAt: string | null
}
export interface SessionDTO {
  user: UserDTO
  /** Kirim sebagai header `x-csrf-token` pada request non-GET. */
  csrfToken: string
  expiresAt: string
}

// ── Dashboard (PRD §3.2) ────────────────────────────────────────────────────
export interface DashboardDeviceRow {
  uuid: string
  name: string
  serialNumber: string | null
  manufacturer: string | null
  model: string | null
  displayStatus: DeviceDisplayStatus
  lastSyncedAt: string | null
}
export interface DashboardSummaryDTO {
  totals: {
    total: number
    online: number
    offline: number
    unknown: number
    stale: number
    syncError: number
    /** Belum punya koordinat ATAU serial number. */
    needsData: number
  }
  recent: DashboardDeviceRow[]
  /** Waktu sinkronisasi terakhir yang berhasil di seluruh perangkat (null = belum pernah). */
  lastSyncedAt: string | null
}

// ── Inventaris ONU (PRD §3.3, §3.4, §9.1) ───────────────────────────────────

/** Baris tabel inventaris. Menggabungkan metadata manual (AMO) + data ACS. */
export interface InventoryListItemDTO {
  uuid: string
  name: string
  serialNumber: string | null
  manufacturer: string | null
  model: string | null
  managementIp: string | null
  locationName: string | null
  onlineStatus: OnlineStatus
  /** Status turunan untuk tampilan (online/offline/unknown/stale/sync_error). */
  displayStatus: DeviceDisplayStatus
  lastInformAt: string | null
  lastSyncedAt: string | null
  isActive: boolean
  /** true bila sudah tertaut ke device GenieACS. */
  linked: boolean
}

/** Detail ONU (PRD §5.3). */
export interface InventoryDetailDTO extends InventoryListItemDTO {
  oui: string | null
  productClass: string | null
  remoteScheme: RemoteScheme
  remotePort: number
  address: string | null
  latitude: number | null
  longitude: number | null
  notes: string | null
  createdAt: string
  updatedAt: string
  /** Data dari GenieACS; null bila belum tertaut. */
  device: {
    genieacsDeviceId: string
    lastInformAt: string | null
    lastSyncedAt: string | null
    onlineStatus: OnlineStatus
    syncError: string | null
    /** Snapshot parameter (sudah diredaksi). */
    parameters: Record<string, unknown> | null
  } | null
}

/** Titik peta — hanya perangkat dengan koordinat valid (PRD §3.4). */
export interface InventoryMapPointDTO {
  uuid: string
  name: string
  serialNumber: string | null
  manufacturer: string | null
  model: string | null
  latitude: number
  longitude: number
  locationName: string | null
  onlineStatus: OnlineStatus
  displayStatus: DeviceDisplayStatus
}

export interface InventoryListQuery {
  page?: number
  pageSize?: number
  q?: string
  status?: OnlineStatus | 'all'
  manufacturer?: string
  model?: string
  linked?: 'all' | 'linked' | 'unlinked'
  needsData?: boolean
  sort?: 'name' | 'createdAt' | 'lastSyncedAt' | 'status'
  order?: 'asc' | 'desc'
}

/** Body POST /inventory — metadata manual + tautan opsional ke device ACS. */
export interface InventoryCreateInput {
  name: string
  serialNumber?: string | null
  manufacturer?: string | null
  model?: string | null
  managementIp?: string | null
  remoteScheme?: RemoteScheme
  remotePort?: number
  locationName?: string | null
  address?: string | null
  latitude?: number | null
  longitude?: number | null
  notes?: string | null
  /** Bila diisi, record langsung ditautkan ke device GenieACS dengan ID ini. */
  genieacsDeviceId?: string | null
}

/** Body PATCH /inventory/:uuid — hanya field metadata manual (PRD §3.4). */
export type InventoryUpdateInput = Partial<Omit<InventoryCreateInput, 'genieacsDeviceId'>> & {
  isActive?: boolean
}

// ── Pengguna (PRD §2, §9.1) ─────────────────────────────────────────────────
export interface UserListItemDTO extends UserDTO {
  isActive: boolean
  createdAt: string
}

export interface UserCreateInput {
  name: string
  email: string
  password: string
  role: Role
}

export interface UserUpdateInput {
  name?: string
  email?: string
  password?: string
  role?: Role
  isActive?: boolean
}

// ── Audit log (PRD §9.1) ────────────────────────────────────────────────────
export interface AuditLogDTO {
  id: number
  userId: number | null
  userName: string | null
  action: string
  resourceType: string | null
  resourceId: string | null
  ipAddress: string | null
  userAgent: string | null
  requestId: string | null
  details: unknown
  createdAt: string
}

// ── Sinkronisasi GenieACS (PRD §8.4, §11) ───────────────────────────────────
export interface SyncRunDTO {
  id: number
  triggerType: SyncTrigger
  triggeredBy: number | null
  triggeredByName: string | null
  startedAt: string
  finishedAt: string | null
  status: SyncRunStatus
  foundCount: number
  successCount: number
  failedCount: number
  errorSummary: string | null
}

export interface SyncStatusDTO {
  enabled: boolean
  intervalSeconds: number
  onlineThresholdSeconds: number
  running: boolean
  lastRun: SyncRunDTO | null
  lastSyncedAt: string | null
}

// ── Pengaturan (PRD §7.6) ───────────────────────────────────────────────────
export interface AppSettingsDTO {
  values: Record<string, unknown>
  /** Nilai efektif (env + override app_settings). */
  effective: {
    syncIntervalSeconds: number
    onlineThresholdSeconds: number
    syncEnabled: boolean
    /** true = sync otomatis membuat record inventaris draft untuk device baru. */
    autoCreateInventory: boolean
    appName: string
    auditRetentionDays: number
  }
  /** Kebijakan remote yang berlaku (read-only, dari env). */
  remotePolicy: {
    allowedPorts: number[]
    allowedSchemes: RemoteScheme[]
    allowedCidrs: string[]
  }
}

/** Perangkat ACS (onu_devices) yang belum tertaut ke record inventaris. */
export interface UnlinkedDeviceDTO {
  id: number
  genieacsDeviceId: string
  serialNumber: string | null
  manufacturer: string | null
  model: string | null
  managementIp: string | null
  onlineStatus: OnlineStatus
  lastInformAt: string | null
  lastSyncedAt: string | null
}

export interface DeviceParameterMapDTO {
  id: number
  fieldKey: ParamMapField
  manufacturer: string | null
  model: string | null
  paramPath: string
  priority: number
  isActive: boolean
}

export interface DeviceParameterMapInput {
  fieldKey: ParamMapField
  manufacturer?: string | null
  model?: string | null
  paramPath: string
  priority?: number
  isActive?: boolean
}

// ── Remote (PRD §3.5, §10) ──────────────────────────────────────────────────
export interface RemoteSessionDTO {
  url: string
  uuid: string
  target: string
  scheme: RemoteScheme
  port: number
  expiresAt: string
}
