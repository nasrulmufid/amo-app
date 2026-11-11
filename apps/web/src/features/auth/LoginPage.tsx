import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Navigate, useLocation } from 'react-router-dom'
import { z } from 'zod'
import { AlertCircle, Loader2, Router } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ApiError } from '@/lib/api'
import { useAuth } from './auth-context'

// Validasi sisi-klien hanya untuk UX cepat; validasi yang MENGIKAT ada di API.
const schema = z.object({
  email: z.string().min(1, 'Email wajib diisi').email('Format email tidak valid'),
  password: z.string().min(1, 'Password wajib diisi'),
})
type FormValues = z.infer<typeof schema>

/** Terjemahan pesan error API → bahasa UI. Jangan tampilkan `message` mentah dari server. */
function describeError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.code === 'INVALID_CREDENTIALS') return 'Email atau password salah.'
    if (err.code === 'RATE_LIMITED') return 'Terlalu banyak percobaan. Tunggu sebentar lalu coba lagi.'
    if (err.code === 'NETWORK_ERROR') return err.message
    if (err.requestId) return `Terjadi kesalahan (kode ${err.requestId}). Hubungi administrator.`
  }
  return 'Terjadi kesalahan. Silakan coba lagi.'
}

export default function LoginPage() {
  const { user, login } = useAuth()
  const location = useLocation()
  const [formError, setFormError] = useState<string | null>(null)
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema) })

  // Sudah login → langsung ke tujuan awal / dashboard.
  const from = (location.state as { from?: string } | null)?.from ?? '/dashboard'
  if (user) return <Navigate to={from} replace />

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null)
    try {
      await login(values) // setelah sukses, `user` terisi → <Navigate> di atas bekerja
    } catch (err) {
      setFormError(describeError(err))
    }
  })

  return (
    <main className="grid min-h-screen place-items-center bg-muted/40 p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="items-center text-center">
          <div className="mb-2 grid size-11 place-items-center rounded-xl bg-primary text-primary-foreground">
            <Router className="size-6" aria-hidden />
          </div>
          <CardTitle className="text-xl">AMO</CardTitle>
          <CardDescription>Aplikasi Management ONU — masuk untuk melanjutkan</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} noValidate className="grid gap-4">
            {formError && (
              <Alert variant="destructive">
                <AlertCircle />
                <AlertDescription>{formError}</AlertDescription>
              </Alert>
            )}

            <div className="grid gap-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" autoComplete="username" autoFocus aria-invalid={!!errors.email} {...register('email')} />
              {errors.email && <p className="text-xs text-destructive">{errors.email.message}</p>}
            </div>

            <div className="grid gap-2">
              <Label htmlFor="password">Password</Label>
              <Input id="password" type="password" autoComplete="current-password" aria-invalid={!!errors.password} {...register('password')} />
              {errors.password && <p className="text-xs text-destructive">{errors.password.message}</p>}
            </div>

            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting && <Loader2 className="animate-spin" aria-hidden />}
              Masuk
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  )
}
