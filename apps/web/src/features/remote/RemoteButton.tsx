import { useRef, type ComponentProps } from 'react'
import { useMutation } from '@tanstack/react-query'
import { toast } from 'sonner'
import { ExternalLink, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/features/auth/auth-context'
import { ApiError } from '@/lib/api'
import { openRemoteSession } from './remote.api'

/**
 * Tombol "Buka Remote" (PRD §3.5).
 *
 * - Hanya tampil untuk pengguna dengan izin `remote.open` (API tetap menegakkan).
 * - URL remote dibuat SERVER; browser tidak pernah menyusun target sendiri.
 * - Dibuka di tab baru dengan `noopener,noreferrer` agar halaman perangkat tidak
 *   dapat mengakses `window.opener` aplikasi AMO.
 */
export function RemoteButton({
  uuid,
  disabled,
  disabledReason,
  size,
  className,
  compact = false,
}: {
  uuid: string
  disabled?: boolean
  disabledReason?: string
  size?: ComponentProps<typeof Button>['size']
  className?: string
  compact?: boolean
}) {
  const { can } = useAuth()
  const remoteWindowRef = useRef<Window | null>(null)
  const mutation = useMutation({
    mutationFn: () => openRemoteSession(uuid),
    onSuccess: (session) => {
      const win = remoteWindowRef.current
      remoteWindowRef.current = null
      if (!win || win.closed) {
        toast.error('Jendela remote ditutup sebelum perangkat siap dibuka.')
        return
      }
      win.location.replace(session.url)
    },
    onError: (err) => {
      remoteWindowRef.current?.close()
      remoteWindowRef.current = null
      if (err instanceof ApiError) {
        if (err.code === 'REMOTE_TARGET_NOT_ALLOWED') {
          toast.error('Remote ditolak kebijakan server. Periksa management IP, port, dan allowlist jaringan.')
          return
        }
        if (err.code === 'REMOTE_UNAVAILABLE') {
          toast.error('Perangkat tidak dapat dihubungi.')
          return
        }
        toast.error(err.message)
        return
      }
      toast.error('Gagal membuka remote.')
    },
  })

  if (!can('remote.open')) return null

  const handleClick = () => {
    // Buka jendela sinkron dari aksi klik agar tidak diblokir browser setelah request API selesai.
    const win = window.open('about:blank', '_blank')
    if (!win) {
      toast.error('Popup diblokir browser. Izinkan popup untuk membuka remote.')
      return
    }
    win.opener = null
    remoteWindowRef.current = win
    mutation.mutate()
  }

  return (
    <Button
      onClick={handleClick}
      disabled={disabled || mutation.isPending}
      title={disabled ? disabledReason : undefined}
      aria-label="Buka Remote"
      size={size}
      className={className}
    >
      {mutation.isPending ? <Loader2 className="animate-spin" aria-hidden /> : <ExternalLink aria-hidden />}
      <span className={compact ? 'max-[480px]:sr-only' : undefined}>Buka Remote</span>
    </Button>
  )
}
