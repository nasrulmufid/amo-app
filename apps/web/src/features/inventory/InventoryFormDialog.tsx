import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Loader2 } from 'lucide-react'
import type { InventoryDetailDTO } from '@amo/shared'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { ApiError } from '@/lib/api'
import { createInventory, inventoryKeys, updateInventory } from './inventory.api'
import {
  emptyInventoryForm,
  inventoryFormSchema,
  type InventoryFormOutput,
  type InventoryFormValues,
} from './inventory.form'

/**
 * Form Tambah / Edit ONU (PRD §3.4).
 *
 * - Mode `create`: semua field metadata manual + tautan opsional ke device GenieACS.
 * - Mode `edit`: field yang berasal dari ACS (serial/vendor/model) tetap dapat diubah
 *   hanya bila perangkat BELUM tertaut; setelah tertaut, sync yang memilikinya.
 */
export function InventoryFormDialog({
  open,
  onOpenChange,
  device,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  device?: InventoryDetailDTO | null
}) {
  const queryClient = useQueryClient()
  const isEdit = Boolean(device)
  const linked = Boolean(device?.linked)

  const form = useForm<InventoryFormValues, unknown, InventoryFormOutput>({
    resolver: zodResolver(inventoryFormSchema),
    defaultValues: emptyInventoryForm,
  })

  // Isi ulang form setiap kali dialog dibuka untuk perangkat berbeda.
  useEffect(() => {
    if (!open) return
    form.reset(
      device
        ? {
            name: device.name,
            serialNumber: device.serialNumber ?? '',
            manufacturer: device.manufacturer ?? '',
            model: device.model ?? '',
            managementIp: device.managementIp ?? '',
            remoteScheme: device.remoteScheme,
            remotePort: device.remotePort,
            locationName: device.locationName ?? '',
            address: device.address ?? '',
            latitude: device.latitude ?? '',
            longitude: device.longitude ?? '',
            notes: device.notes ?? '',
            genieacsDeviceId: '',
          }
        : emptyInventoryForm,
    )
  }, [open, device, form])

  const mutation = useMutation({
    mutationFn: async (values: InventoryFormOutput) => {
      if (device) {
        const { genieacsDeviceId: _ignored, ...patch } = values
        return updateInventory(device.uuid, patch)
      }
      return createInventory(values)
    },
    onSuccess: (saved) => {
      toast.success(isEdit ? 'Perubahan disimpan' : 'Perangkat ditambahkan')
      void queryClient.invalidateQueries({ queryKey: inventoryKeys.all })
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] })
      onOpenChange(false)
      void saved
    },
    onError: (err) => {
      const message = err instanceof ApiError ? err.message : 'Gagal menyimpan perangkat.'
      toast.error(message)
    },
  })

  const onSubmit = form.handleSubmit((values) => mutation.mutate(values))
  const errors = form.formState.errors

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit metadata ONU' : 'Tambah / Tautkan ONU'}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? 'Ubah metadata yang dikelola AMO. Data dari GenieACS diperbarui otomatis oleh sinkronisasi.'
              : 'Daftarkan perangkat baru. UUID dibuat otomatis oleh server.'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} noValidate className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <FormItem className="sm:col-span-2">
              <FormLabel htmlFor="name">Nama perangkat *</FormLabel>
              <Input id="name" placeholder="ONU-GANDUS-014" aria-invalid={!!errors.name} {...form.register('name')} />
              <FormMessage>{errors.name?.message}</FormMessage>
            </FormItem>

            <FormItem>
              <FormLabel htmlFor="serialNumber">Serial number</FormLabel>
              <Input
                id="serialNumber"
                placeholder="ZTEGCA8A001"
                disabled={linked}
                aria-invalid={!!errors.serialNumber}
                {...form.register('serialNumber')}
              />
              <FormMessage>{errors.serialNumber?.message}</FormMessage>
            </FormItem>

            <FormItem>
              <FormLabel htmlFor="managementIp">Management IP</FormLabel>
              <Input
                id="managementIp"
                placeholder="172.2.1.3"
                aria-invalid={!!errors.managementIp}
                {...form.register('managementIp')}
              />
              <FormMessage>{errors.managementIp?.message}</FormMessage>
            </FormItem>

            <FormItem>
              <FormLabel htmlFor="manufacturer">Vendor</FormLabel>
              <Input id="manufacturer" placeholder="ZTE" disabled={linked} {...form.register('manufacturer')} />
              <FormMessage>{errors.manufacturer?.message}</FormMessage>
            </FormItem>

            <FormItem>
              <FormLabel htmlFor="model">Model</FormLabel>
              <Input id="model" placeholder="F663NV3A" disabled={linked} {...form.register('model')} />
              <FormMessage>{errors.model?.message}</FormMessage>
            </FormItem>

            <FormItem>
              <FormLabel>Skema remote</FormLabel>
              <Select
                value={form.watch('remoteScheme')}
                onValueChange={(v) => form.setValue('remoteScheme', v as 'http' | 'https')}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="http">HTTP</SelectItem>
                  <SelectItem value="https">HTTPS</SelectItem>
                </SelectContent>
              </Select>
            </FormItem>

            <FormItem>
              <FormLabel htmlFor="remotePort">Port remote</FormLabel>
              <Input id="remotePort" type="number" aria-invalid={!!errors.remotePort} {...form.register('remotePort')} />
              <FormMessage>{errors.remotePort?.message}</FormMessage>
            </FormItem>

            <FormItem>
              <FormLabel htmlFor="locationName">Nama lokasi</FormLabel>
              <Input id="locationName" placeholder="Gandus · Blok A" {...form.register('locationName')} />
              <FormMessage>{errors.locationName?.message}</FormMessage>
            </FormItem>

            <FormItem>
              <FormLabel htmlFor="address">Alamat</FormLabel>
              <Input id="address" placeholder="Jl. …" {...form.register('address')} />
              <FormMessage>{errors.address?.message}</FormMessage>
            </FormItem>

            <FormItem>
              <FormLabel htmlFor="latitude">Latitude</FormLabel>
              <Input id="latitude" placeholder="-2.99" aria-invalid={!!errors.latitude} {...form.register('latitude')} />
              <FormMessage>{errors.latitude?.message}</FormMessage>
            </FormItem>

            <FormItem>
              <FormLabel htmlFor="longitude">Longitude</FormLabel>
              <Input id="longitude" placeholder="104.75" aria-invalid={!!errors.longitude} {...form.register('longitude')} />
              <FormMessage>{errors.longitude?.message}</FormMessage>
            </FormItem>

            {!isEdit && (
              <FormItem className="sm:col-span-2">
                <FormLabel htmlFor="genieacsDeviceId">ID perangkat GenieACS (opsional)</FormLabel>
                <Input
                  id="genieacsDeviceId"
                  placeholder="00259E-HG8245H-HWTC91B2401"
                  {...form.register('genieacsDeviceId')}
                />
                <p className="text-xs text-muted-foreground">
                  Isi bila perangkat sudah tersinkron dari GenieACS dan ingin langsung ditautkan.
                </p>
                <FormMessage>{errors.genieacsDeviceId?.message}</FormMessage>
              </FormItem>
            )}

            <FormItem className="sm:col-span-2">
              <FormLabel htmlFor="notes">Catatan</FormLabel>
              <Textarea id="notes" rows={3} placeholder="Catatan internal…" {...form.register('notes')} />
              <FormMessage>{errors.notes?.message}</FormMessage>
            </FormItem>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={mutation.isPending}>
              Batal
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending && <Loader2 className="animate-spin" aria-hidden />}
              {isEdit ? 'Simpan perubahan' : 'Tambah perangkat'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
