import type { Role } from './constants'

/**
 * Matriks izin (RBAC) — SATU-SATUNYA tempat kebijakan akses didefinisikan.
 *
 * - API memakai `app.requirePermission('x')` (lihat apps/api/src/plugins/auth.ts)
 * - Web memakai `can('x')` untuk menyembunyikan menu/tombol (hanya kosmetik!
 *   penegakan sesungguhnya SELALU di API).
 *
 * PRD §2 & §9 menyebut "sesuai policy/izin" — mengubah kebijakan cukup dengan
 * mengedit tabel ROLE_PERMISSIONS di bawah.
 */
export const PERMISSIONS = [
  'dashboard.read',
  'inventory.read',
  'inventory.write', // buat/ubah metadata inventaris
  'remote.open', // tombol "Buka Remote" + proxy /remote/:uuid
  'users.manage',
  'audit.read',
  'sync.run', // sinkronisasi manual GenieACS
  'settings.manage',
] as const
export type Permission = (typeof PERMISSIONS)[number]

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  admin: PERMISSIONS,
  operator: ['dashboard.read', 'inventory.read', 'inventory.write', 'remote.open'],
  viewer: ['dashboard.read', 'inventory.read'],
}

export function roleHasPermission(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission)
}
