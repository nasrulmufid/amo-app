import { z } from 'zod'

/**
 * Validasi form inventaris (sisi klien, untuk UX cepat).
 * Validasi MENGIKAT tetap di API (TypeBox) — pesan di sini hanya membantu pengguna.
 */

const optionalText = (max: number) =>
  z
    .string()
    .max(max, `Maksimal ${max} karakter`)
    .optional()
    .transform((v) => (v === undefined || v.trim() === '' ? null : v.trim()))

const optionalNumber = (min: number, max: number, label: string) =>
  z
    .union([z.string(), z.number()])
    .optional()
    .transform((v) => {
      if (v === undefined || v === '') return null
      const n = typeof v === 'number' ? v : Number(v)
      return Number.isFinite(n) ? n : Number.NaN
    })
    .refine((v) => v === null || (Number.isFinite(v) && v >= min && v <= max), `${label} harus antara ${min} dan ${max}`)

export const inventoryFormSchema = z
  .object({
    name: z.string().min(1, 'Nama perangkat wajib diisi').max(160, 'Maksimal 160 karakter'),
    serialNumber: optionalText(128),
    manufacturer: optionalText(128),
    model: optionalText(128),
    managementIp: optionalText(45),
    remoteScheme: z.enum(['http', 'https']),
    remotePort: z
      .union([z.string(), z.number()])
      .transform((v) => (typeof v === 'number' ? v : Number(v)))
      .refine((v) => Number.isInteger(v) && v >= 1 && v <= 65535, 'Port harus 1–65535'),
    locationName: optionalText(190),
    address: optionalText(2000),
    latitude: optionalNumber(-90, 90, 'Latitude'),
    longitude: optionalNumber(-180, 180, 'Longitude'),
    notes: optionalText(4000),
    genieacsDeviceId: optionalText(190),
  })
  .refine((v) => (v.latitude === null) === (v.longitude === null), {
    message: 'Latitude dan longitude harus diisi bersama atau dikosongkan bersama',
    path: ['latitude'],
  })
  .refine((v) => v.managementIp === null || /^[0-9a-fA-F:.]+$/.test(v.managementIp), {
    message: 'Gunakan alamat IP literal (bukan hostname)',
    path: ['managementIp'],
  })

export type InventoryFormValues = z.input<typeof inventoryFormSchema>
export type InventoryFormOutput = z.output<typeof inventoryFormSchema>

/** Nilai awal form (tambah baru). */
export const emptyInventoryForm: InventoryFormValues = {
  name: '',
  serialNumber: '',
  manufacturer: '',
  model: '',
  managementIp: '',
  remoteScheme: 'http',
  remotePort: 80,
  locationName: '',
  address: '',
  latitude: '',
  longitude: '',
  notes: '',
  genieacsDeviceId: '',
}
