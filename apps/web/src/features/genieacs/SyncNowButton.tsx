import { useMutation, useQueryClient } from '@tanstack/react-query'
import { RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/features/auth/auth-context'
import { settingsKeys } from '@/features/settings/settings.api'
import { runSync } from '@/features/settings/settings.api'

/** Trigger a GenieACS sync, then refresh all status views once the run finishes. */
export function SyncNowButton({ className }: { className?: string }) {
  const { can } = useAuth()
  const queryClient = useQueryClient()
  const mutation = useMutation({
    mutationFn: runSync,
    onSuccess: async (result) => {
      toast.success(`Pembaruan selesai: ${result.success} perangkat berhasil, ${result.failed} gagal.`)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['dashboard'] }),
        queryClient.invalidateQueries({ queryKey: ['inventory'] }),
        queryClient.invalidateQueries({ queryKey: settingsKeys.syncStatus }),
        queryClient.invalidateQueries({ queryKey: settingsKeys.syncRuns }),
      ])
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Gagal memperbarui status perangkat.')
    },
  })

  if (!can('sync.run')) return null

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className={className}
      onClick={() => mutation.mutate()}
      disabled={mutation.isPending}
      aria-label="Perbarui status ONU dari GenieACS"
      title="Sinkronkan status terbaru dari GenieACS"
    >
      <RefreshCw className={mutation.isPending ? 'animate-spin' : undefined} aria-hidden />
      <span>{mutation.isPending ? 'Memperbarui…' : 'Refresh status'}</span>
    </Button>
  )
}
