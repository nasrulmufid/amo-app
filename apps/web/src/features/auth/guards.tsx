import { Navigate, Outlet, useLocation } from 'react-router-dom'
import type { Permission } from '@amo/shared'
import { Skeleton } from '@/components/ui/skeleton'
import { useAuth } from './auth-context'

/** Route induk: wajib login. Belum login → /login (menyimpan tujuan awal agar kembali setelah login). */
export function RequireAuth() {
  const { user, isLoading, returnToDisabled } = useAuth()
  const location = useLocation()

  if (isLoading) {
    return (
      <div className="grid min-h-screen place-items-center" role="status" aria-label="Memeriksa sesi">
        <Skeleton className="h-10 w-48" />
      </div>
    )
  }
  if (!user) {
    // Sesi berakhir / belum login → ingat tujuan awal. Logout eksplisit → jangan (lihat auth-context).
    const state = returnToDisabled ? undefined : { from: location.pathname + location.search }
    return <Navigate to="/login" replace state={state} />
  }
  return <Outlet />
}

/** Route anak: wajib izin tertentu. Tanpa izin → halaman "Akses ditolak". */
export function RequirePermission({ permission }: { permission: Permission }) {
  const { can } = useAuth()
  if (!can(permission)) {
    return (
      <div className="mx-auto max-w-md py-16 text-center">
        <h1 className="text-xl font-semibold">Akses ditolak</h1>
        <p className="mt-2 text-sm text-muted-foreground">Peran Anda tidak memiliki izin untuk membuka halaman ini.</p>
      </div>
    )
  }
  return <Outlet />
}
