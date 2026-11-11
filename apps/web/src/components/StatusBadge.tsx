import type { DeviceDisplayStatus } from '@amo/shared'
import { cn } from '@/lib/utils'

/**
 * Label status perangkat (PRD §5 & §12): warna SELALU disertai teks + titik,
 * sehingga tetap terbaca oleh pengguna buta warna.
 *
 * Status turunan (dihitung API):
 *  - `stale`      → data terlalu lama diperbarui (sync tertunda)
 *  - `sync_error` → pengambilan data dari GenieACS gagal
 */
const CONFIG: Record<DeviceDisplayStatus, { label: string; dot: string; text: string; title: string }> = {
  online: { label: 'Online', dot: 'bg-status-online', text: 'text-status-online', title: 'Perangkat aktif (inform terbaru)' },
  offline: { label: 'Offline', dot: 'bg-status-offline', text: 'text-status-offline', title: 'Tidak ada inform dalam ambang waktu' },
  unknown: { label: 'Unknown', dot: 'bg-status-unknown', text: 'text-status-unknown', title: 'Belum cukup data untuk menentukan status' },
  stale: { label: 'Stale', dot: 'bg-status-stale', text: 'text-status-stale', title: 'Data terlalu lama diperbarui' },
  sync_error: { label: 'Sync error', dot: 'bg-status-offline', text: 'text-status-offline', title: 'Pengambilan data dari GenieACS gagal' },
}

export function StatusBadge({ status, className }: { status: DeviceDisplayStatus; className?: string }) {
  const c = CONFIG[status] ?? CONFIG.unknown
  return (
    <span
      title={c.title}
      className={cn('inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide', c.text, className)}
    >
      <span className={cn('size-2 rounded-full', c.dot)} aria-hidden />
      {c.label}
    </span>
  )
}
