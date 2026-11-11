import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Loader2 } from 'lucide-react'
import { ROLES, type Role, type UserListItemDTO } from '@amo/shared'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { ApiError } from '@/lib/api'
import { createUser, ROLE_LABEL, updateUser, usersKeys } from './users.api'

const schema = z.object({
  name: z.string().min(1, 'Nama wajib diisi').max(120),
  email: z.string().email('Format email tidak valid').max(190),
  password: z.string().optional(),
  role: z.enum(ROLES),
  isActive: z.boolean(),
})
type FormValues = z.infer<typeof schema>

/**
 * Form tambah / ubah pengguna (PRD §2).
 * - Password opsional saat edit (kosong = tidak diubah).
 * - Menonaktifkan akun atau mengganti password mencabut semua sesi user (API).
 */
export function UserFormDialog({
  open,
  onOpenChange,
  user,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  user?: UserListItemDTO | null
}) {
  const queryClient = useQueryClient()
  const isEdit = Boolean(user)
  const [formError, setFormError] = useState<string | null>(null)

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { name: '', email: '', password: '', role: 'operator', isActive: true },
  })

  useEffect(() => {
    if (!open) return
    setFormError(null)
    form.reset(
      user
        ? { name: user.name, email: user.email, password: '', role: user.role, isActive: user.isActive }
        : { name: '', email: '', password: '', role: 'operator', isActive: true },
    )
  }, [open, user, form])

  const mutation = useMutation({
    mutationFn: async (values: FormValues) => {
      if (user) {
        const patch: Record<string, unknown> = {
          name: values.name,
          email: values.email,
          role: values.role,
          isActive: values.isActive,
        }
        if (values.password) patch.password = values.password
        return updateUser(user.id, patch)
      }
      if (!values.password || values.password.length < 8) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Password minimal 8 karakter.')
      }
      return createUser({ name: values.name, email: values.email, password: values.password, role: values.role })
    },
    onSuccess: () => {
      toast.success(isEdit ? 'Pengguna diperbarui' : 'Pengguna dibuat')
      void queryClient.invalidateQueries({ queryKey: usersKeys.all })
      onOpenChange(false)
    },
    onError: (err) => {
      setFormError(err instanceof ApiError ? err.message : 'Gagal menyimpan pengguna.')
    },
  })

  const errors = form.formState.errors

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Ubah pengguna' : 'Tambah pengguna'}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? 'Mengubah role, status, atau password akan mencabut semua sesi aktif pengguna ini.'
              : 'Akun baru dapat langsung login setelah dibuat.'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={form.handleSubmit((v) => mutation.mutate(v))} noValidate className="grid gap-4">
          {formError && <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{formError}</p>}

          <FormItem>
            <FormLabel htmlFor="user-name">Nama</FormLabel>
            <Input id="user-name" aria-invalid={!!errors.name} {...form.register('name')} />
            <FormMessage>{errors.name?.message}</FormMessage>
          </FormItem>

          <FormItem>
            <FormLabel htmlFor="user-email">Email</FormLabel>
            <Input id="user-email" type="email" aria-invalid={!!errors.email} {...form.register('email')} />
            <FormMessage>{errors.email?.message}</FormMessage>
          </FormItem>

          <FormItem>
            <FormLabel htmlFor="user-password">{isEdit ? 'Password baru (opsional)' : 'Password'}</FormLabel>
            <Input
              id="user-password"
              type="password"
              autoComplete="new-password"
              placeholder={isEdit ? 'Kosongkan bila tidak diubah' : 'Minimal 8 karakter'}
              {...form.register('password')}
            />
            <FormMessage>{errors.password?.message}</FormMessage>
          </FormItem>

          <FormItem>
            <FormLabel>Role</FormLabel>
            <Select value={form.watch('role')} onValueChange={(v) => form.setValue('role', v as Role)}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ROLES.map((r) => (
                  <SelectItem key={r} value={r}>
                    {ROLE_LABEL[r]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormItem>

          {isEdit && (
            <div className="flex items-center justify-between rounded-lg border px-3 py-2">
              <div>
                <p className="text-sm font-medium">Akun aktif</p>
                <p className="text-xs text-muted-foreground">Akun nonaktif tidak dapat login.</p>
              </div>
              <Switch
                checked={form.watch('isActive')}
                onCheckedChange={(v) => form.setValue('isActive', v)}
                aria-label="Akun aktif"
              />
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={mutation.isPending}>
              Batal
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending && <Loader2 className="animate-spin" aria-hidden />}
              Simpan
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
