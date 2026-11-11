import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { roleHasPermission, type Permission, type UserDTO } from '@amo/shared'
import { authKeys, fetchMe, login as loginRequest, logout as logoutRequest } from './auth.api'

interface AuthContextValue {
  /** null = belum login. */
  user: UserDTO | null
  /** true selama pengecekan sesi awal (cegah "kedip" halaman login). */
  isLoading: boolean
  login: (input: { email: string; password: string }) => Promise<void>
  logout: () => Promise<void>
  /**
   * Cek izin untuk MENYEMBUNYIKAN menu/tombol. Ini hanya kosmetik UX —
   * penegakan izin yang sebenarnya SELALU di API (PRD §10).
   */
  can: (permission: Permission) => boolean
  /**
   * true setelah logout EKSPLISIT. <RequireAuth> lalu tidak menyimpan "halaman tujuan awal",
   * agar user BERIKUTNYA yang login di perangkat yang sama tidak terlempar ke halaman
   * milik user sebelumnya (yang mungkin tak boleh ia akses). Direset saat login sukses.
   */
  returnToDisabled: boolean
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  const [returnToDisabled, setReturnToDisabled] = useState(false)

  const me = useQuery({
    queryKey: authKeys.me,
    queryFn: fetchMe,
    retry: false, // 401 sudah jadi `null`; error lain (jaringan) ditampilkan, tidak diulang-ulang
    staleTime: 60_000,
    refetchOnWindowFocus: true, // sesi kedaluwarsa terdeteksi saat user kembali ke tab
  })

  const loginMutation = useMutation({
    mutationFn: loginRequest,
    onSuccess: (session) => {
      setReturnToDisabled(false)
      queryClient.clear() // buang cache sisa user sebelumnya
      queryClient.setQueryData(authKeys.me, session)
    },
  })

  const logoutMutation = useMutation({
    mutationFn: logoutRequest,
    onSettled: () => {
      setReturnToDisabled(true)
      // Apa pun hasilnya, bersihkan data sensitif di memori browser.
      queryClient.clear()
      queryClient.setQueryData(authKeys.me, null)
    },
  })

  const value = useMemo<AuthContextValue>(() => {
    const user = me.data?.user ?? null
    return {
      user,
      isLoading: me.isLoading,
      login: async (input) => {
        await loginMutation.mutateAsync(input)
      },
      logout: async () => {
        await logoutMutation.mutateAsync()
      },
      can: (permission) => (user ? roleHasPermission(user.role, permission) : false),
      returnToDisabled,
    }
  }, [me.data, me.isLoading, loginMutation, logoutMutation, returnToDisabled])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth harus dipakai di dalam <AuthProvider>')
  return ctx
}
