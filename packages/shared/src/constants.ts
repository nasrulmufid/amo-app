/**
 * Konstanta yang HARUS sama antara API dan Web.
 * Menaruhnya di sini mencegah "magic string" yang bisa tidak sinkron.
 */

/** Prefix seluruh endpoint REST (PRD §9). */
export const API_PREFIX = '/api/v1'

/** Nama cookie sesi (sesuai skeleton OpenAPI PRD §9.4: `amo_session`). */
export const SESSION_COOKIE_NAME = 'amo_session'

/**
 * Header yang membawa token CSRF pada request yang mengubah state
 * (POST/PATCH/PUT/DELETE). Nilainya didapat dari /auth/login atau /auth/me.
 */
export const CSRF_HEADER_NAME = 'x-csrf-token'

/** Peran pengguna (PRD §2). Urutan tidak berarti; hak akses ada di permissions.ts. */
export const ROLES = ['admin', 'operator', 'viewer'] as const
export type Role = (typeof ROLES)[number]

/**
 * Status perangkat yang DISIMPAN di database (kolom onu_devices.online_status).
 * PRD §12 juga mendefinisikan "stale" dan "sync error" — itu status TURUNAN
 * yang dihitung saat tampil (dari last_synced_at / sync_error), bukan kolom.
 */
export const ONLINE_STATUSES = ['online', 'offline', 'unknown'] as const
export type OnlineStatus = (typeof ONLINE_STATUSES)[number]

/**
 * Status TURUNAN untuk tampilan (PRD §12). Dihitung di API dari
 * `online_status` + `last_synced_at` + `sync_error` sehingga UI tidak perlu
 * menebak. `stale` = data terlalu lama; `sync_error` = pengambilan data gagal.
 */
export const DEVICE_DISPLAY_STATUSES = ['online', 'offline', 'unknown', 'stale', 'sync_error'] as const
export type DeviceDisplayStatus = (typeof DEVICE_DISPLAY_STATUSES)[number]

/** Skema remote yang diizinkan (PRD §10.1). */
export const REMOTE_SCHEMES = ['http', 'https'] as const
export type RemoteScheme = (typeof REMOTE_SCHEMES)[number]

/** Tipe trigger sinkronisasi (kolom sync_runs.trigger_type). */
export const SYNC_TRIGGERS = ['scheduler', 'manual'] as const
export type SyncTrigger = (typeof SYNC_TRIGGERS)[number]

/** Status satu run sinkronisasi (kolom sync_runs.status). */
export const SYNC_RUN_STATUSES = ['running', 'success', 'partial', 'failed'] as const
export type SyncRunStatus = (typeof SYNC_RUN_STATUSES)[number]

/**
 * Daftar aksi audit log (PRD §10 & §16). Tambahkan di sini saat fitur baru
 * perlu dicatat, agar halaman Audit Log di web bisa menampilkan labelnya.
 */
export const AUDIT_ACTIONS = [
  'auth.login',
  'auth.login_failed',
  'auth.logout',
  'auth.refresh',
  'inventory.create',
  'inventory.update',
  'inventory.delete',
  'sync.run',
  'remote.session_open',
  'remote.denied',
  'user.create',
  'user.update',
  'settings.update',
] as const
export type AuditAction = (typeof AUDIT_ACTIONS)[number]

/** Label ramah untuk halaman Audit Log (PRD §13.5). */
export const AUDIT_ACTION_LABELS: Record<AuditAction, string> = {
  'auth.login': 'Login berhasil',
  'auth.login_failed': 'Login gagal',
  'auth.logout': 'Logout',
  'auth.refresh': 'Perpanjang sesi',
  'inventory.create': 'Tambah inventaris',
  'inventory.update': 'Ubah inventaris',
  'inventory.delete': 'Hapus inventaris',
  'sync.run': 'Sinkronisasi GenieACS',
  'remote.session_open': 'Buka remote',
  'remote.denied': 'Remote ditolak',
  'user.create': 'Tambah pengguna',
  'user.update': 'Ubah pengguna',
  'settings.update': 'Ubah pengaturan',
}

/** Kunci pengaturan aplikasi yang dikenal (tabel app_settings). */
export const SETTING_KEYS = [
  'sync.intervalSeconds',
  'sync.onlineThresholdSeconds',
  'sync.enabled',
  'sync.autoCreateInventory',
  'ui.appName',
  'audit.retentionDays',
] as const
export type SettingKey = (typeof SETTING_KEYS)[number]

/** Field yang dapat dipetakan ke path parameter GenieACS (tabel device_parameter_map). */
export const PARAM_MAP_FIELDS = [
  'serialNumber',
  'manufacturer',
  'model',
  'productClass',
  'oui',
  'managementIp',
] as const
export type ParamMapField = (typeof PARAM_MAP_FIELDS)[number]
