import { LayoutDashboard, MapPin, Router, ScrollText, Settings, Users, type LucideIcon } from 'lucide-react'
import type { Permission } from '@amo/shared'

export interface NavItem {
  to: string
  label: string
  icon: LucideIcon
  /** Menu hanya tampil bila user punya izin ini (kosmetik; API tetap menegakkan). */
  permission: Permission
}

/** Urutan & isi menu mengikuti wireframe PRD §5.1. Tambah menu baru cukup di sini. */
export const NAV_ITEMS: NavItem[] = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, permission: 'dashboard.read' },
  { to: '/inventory', label: 'Inventaris ONU', icon: Router, permission: 'inventory.read' },
  { to: '/map', label: 'Peta Perangkat', icon: MapPin, permission: 'inventory.read' },
  { to: '/settings', label: 'Pengaturan', icon: Settings, permission: 'settings.manage' },
  { to: '/users', label: 'Pengguna', icon: Users, permission: 'users.manage' },
  { to: '/audit', label: 'Audit Log', icon: ScrollText, permission: 'audit.read' },
]
