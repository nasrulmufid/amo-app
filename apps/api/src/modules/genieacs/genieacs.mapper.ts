import type { OnlineStatus } from '@amo/shared'
import type { GenieDevice } from './genieacs.client'

/**
 * Pemetaan parameter GenieACS → field AMO (PRD §8.3).
 *
 * Fungsi di file ini MURNI (tanpa I/O) → mudah di-unit-test (test/genieacs.mapper.test.ts).
 *
 * ⚠ Path parameter BERBEDA menurut vendor/model/firmware (TR-098 `InternetGatewayDevice.*`
 *   vs TR-181 `Device.*`). Karena itu tiap field punya DAFTAR path yang dicoba
 *   berurutan (fallback chain). Sprint 3: muat tambahan dari tabel `device_parameter_map`
 *   sehingga admin bisa menambah path tanpa deploy ulang.
 */
export const PARAM_PATHS = {
  serialNumber: [
    'DeviceID.SerialNumber',
    'InternetGatewayDevice.DeviceInfo.SerialNumber',
    'Device.DeviceInfo.SerialNumber',
  ],
  manufacturer: [
    'DeviceID.Manufacturer',
    'InternetGatewayDevice.DeviceInfo.Manufacturer',
    'Device.DeviceInfo.Manufacturer',
  ],
  model: [
    'DeviceID.Manufacturer',
    'InternetGatewayDevice.DeviceInfo.ModelName',
    'Device.DeviceInfo.ModelName',
    'DeviceID.ProductClass', // fallback sesuai PRD: "Jika kosong, gunakan ProductClass"
  ],
  productClass: ['DeviceID.ProductClass'],
  oui: ['DeviceID.OUI'],
  // IP manajemen WAN/TR-069. "IPTR069" umum di firmware ZTE/Huawei; fallback ke
  // path standar TR-098/TR-181. Bisa ditimpa per model lewat device_parameter_map.
  managementIp: [
    'VirtualParameters.IPTR069',
    'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANIPConnection.1.ExternalIPAddress',
    'Device.WANDevice.1.WANConnectionDevice.1.WANIPConnection.1.ExternalIPAddress',
  ],
} as const satisfies Record<string, readonly string[]>

export interface NormalizedDevice {
  genieDeviceId: string
  serialNumber: string | null
  manufacturer: string | null
  model: string | null
  productClass: string | null
  oui: string | null
  managementIp: string | null
  lastInformAt: Date | null
}

/** Telusuri path bertitik (`A.B.C`) pada pohon NBI. GenieACS dapat mengirim leaf sebagai `_value` atau nilai langsung. */
export function readParam(device: GenieDevice, path: string): string | null {
  let node: unknown = device
  for (const key of path.split('.')) {
    if (node === null || typeof node !== 'object') return null
    node = (node as Record<string, unknown>)[key]
  }
  if (node === null || node === undefined) return null
  const value = typeof node === 'object' ? (node as { _value?: unknown })._value : node
  if (value === undefined || value === null) return null
  const text = String(value).trim()
  return text === '' ? null : text
}

/** Coba tiap path berurutan; kembalikan nilai non-kosong pertama. */
export function pickParam(device: GenieDevice, paths: readonly string[]): string | null {
  for (const path of paths) {
    const v = readParam(device, path)
    if (v !== null) return v
  }
  return null
}

export function normalizeDevice(device: GenieDevice, extraPaths: Partial<Record<keyof typeof PARAM_PATHS, readonly string[]>> = {}): NormalizedDevice {
  const lastInform = device._lastInform ? new Date(device._lastInform) : null
  // Path dari `device_parameter_map` (admin) dicoba LEBIH DULU, lalu fallback bawaan.
  const paths = (field: keyof typeof PARAM_PATHS) => [...(extraPaths[field] ?? []), ...PARAM_PATHS[field]]
  return {
    genieDeviceId: device._id,
    // Hanya trim — pencocokan duplikat case-insensitive sudah dijamin collation *_ai_ci MySQL.
    serialNumber: pickParam(device, paths('serialNumber')),
    manufacturer: pickParam(device, paths('manufacturer')),
    model: pickParam(device, paths('model')),
    productClass: pickParam(device, paths('productClass')),
    oui: pickParam(device, paths('oui')),
    managementIp: pickParam(device, paths('managementIp')),
    lastInformAt: lastInform && !Number.isNaN(lastInform.getTime()) ? lastInform : null,
  }
}

/**
 * Status online = ESTIMASI operasional dari last inform vs ambang (PRD §8.3 & §12),
 * BUKAN jaminan ICMP reachability.
 *   - tidak pernah inform  → 'unknown' (bukan offline!)
 *   - umur ≤ threshold     → 'online'
 *   - umur  > threshold    → 'offline'
 * Catatan: bila GenieACS sendiri tak terjangkau, JANGAN panggil fungsi ini untuk
 * menandai semua perangkat offline (PRD §11.1) — biarkan status terakhir + tandai stale.
 */
export function deriveOnlineStatus(
  lastInformAt: Date | null,
  thresholdSeconds: number,
  now: Date = new Date(),
): OnlineStatus {
  if (!lastInformAt) return 'unknown'
  const ageMs = now.getTime() - lastInformAt.getTime()
  return ageMs <= thresholdSeconds * 1000 ? 'online' : 'offline'
}
