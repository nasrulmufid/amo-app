import { useState, type ReactNode } from 'react'
import { QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter } from 'react-router-dom'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { authKeys } from '@/features/auth/auth.api'
import { AuthProvider } from '@/features/auth/auth-context'
import { ApiError } from '@/lib/api'

/** Pembungkus global: cache data, router, auth, toast. */
export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        // Sesi berakhir di tengah pemakaian (401 dari query mana pun) → tandai "belum login";
        // <RequireAuth> otomatis mengarahkan ke /login.
        queryCache: new QueryCache({
          onError: (error, query) => {
            if (error instanceof ApiError && error.status === 401 && query.queryKey[0] !== authKeys.me[0]) {
              queryClient.setQueryData(authKeys.me, null)
            }
          },
        }),
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            // Jangan ulangi error 4xx (pasti gagal lagi); ulangi gangguan jaringan/5xx maks 2×.
            retry: (count, error) => !(error instanceof ApiError && error.status >= 400 && error.status < 500) && count < 2,
          },
        },
      }),
  )
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <TooltipProvider>
          <AuthProvider>
            {children}
            <Toaster />
          </AuthProvider>
        </TooltipProvider>
      </BrowserRouter>
    </QueryClientProvider>
  )
}
