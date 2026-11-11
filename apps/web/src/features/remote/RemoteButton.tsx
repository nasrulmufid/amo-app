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
export function RemoteButton({ uuid, disabled, disabledReason }: { uuid: string; disabled?: boolean; disabledReason?: string }) {
  const { can } = useAuth()
  const mutation = useMutation({
    mutationFn: () => openRemoteSession(uuid),
    onSuccess: (session) => {
      const win = window.open(session.url, '_blank', 'noopener,noreferrer')
      if (!win) toast.error('Popup diblokir browser. Izinkan popup untuk membuka remote.')
    },
    onError: (err) => {
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

  return (
    <Button
      onClick={() => mutation.mutate()}
      disabled={disabled || mutation.isPending}
      title={disabled ? disabledReason : undefined}
    >
      {mutation.isPending ? <Loader2 className="animate-spin" aria-hidden /> : <ExternalLink aria-hidden />}
      Buka Remote
    </Button>
  )
}
