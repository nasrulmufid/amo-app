/**
 * Format tampilan. DB & API menyimpan UTC (ISO-8601); konversi ke zona lokal
 * browser HANYA dilakukan di sini (PRD §8.3).
 */
const dateTime = new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short' })
const relative = new Intl.RelativeTimeFormat('id-ID', { numeric: 'auto' })

export function formatDateTime(iso: string | null | undefined): string {
  return iso ? dateTime.format(new Date(iso)) : '—'
}

/** "2 menit lalu", "baru saja", dst. */
export function formatRelative(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return 'Belum pernah'
  const diffSec = Math.round((new Date(iso).getTime() - now) / 1000)
  const abs = Math.abs(diffSec)
  if (abs < 45) return 'Baru saja'
  if (abs < 3600) return relative.format(Math.round(diffSec / 60), 'minute')
  if (abs < 86400) return relative.format(Math.round(diffSec / 3600), 'hour')
  return relative.format(Math.round(diffSec / 86400), 'day')
}
