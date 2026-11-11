import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  AlertCircle,
  ArrowLeft,
  ChevronRight,
  Clock,
  Cpu,
  MapPin,
  Pencil,
  Router,
  ShieldAlert,
} from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { StatusBadge } from '@/components/StatusBadge'
import { useAuth } from '@/features/auth/auth-context'
import { RemoteButton } from '@/features/remote/RemoteButton'
import { formatDateTime, formatRelative } from '@/lib/format'
import { fetchInventoryDetail, inventoryKeys } from './inventory.api'
import { InventoryFormDialog } from './InventoryFormDialog'

/** Baris label–nilai untuk panel detail. */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[9rem_1fr] gap-2 py-1.5 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  )
}

/**
 * Detail ONU (PRD §5.3).
 * Menampilkan identitas, status, parameter, koordinat, peta mini, dan tombol remote.
 * Setiap data menyertakan sumber & waktu terakhir diperbarui (PRD §5).
 */
export default function InventoryDetailPage() {
  const { uuid = '' } = useParams()
  const { can } = useAuth()
  const [editOpen, setEditOpen] = useState(false)

  const { data, isPending, isError, error, refetch, isFetching } = useQuery({
    queryKey: inventoryKeys.detail(uuid),
    queryFn: () => fetchInventoryDetail(uuid),
    enabled: Boolean(uuid),
  })

  if (isPending) {
    return (
      <div className="grid gap-4">
        <Skeleton className="h-8 w-64" />
        <div className="grid gap-4 lg:grid-cols-[1.3fr_0.7fr]">
          <Skeleton className="h-72 rounded-xl" />
          <Skeleton className="h-72 rounded-xl" />
        </div>
      </div>
    )
  }

  if (isError || !data) {
    return (
      <div className="grid gap-4">
        <Button asChild variant="ghost" size="sm" className="w-fit">
          <Link to="/inventory">
            <ArrowLeft aria-hidden /> Kembali ke inventaris
          </Link>
        </Button>
        <Alert variant="destructive">
          <AlertCircle />
          <AlertTitle>Gagal memuat detail perangkat</AlertTitle>
          <AlertDescription>
            <p>{error instanceof Error ? error.message : 'Perangkat tidak ditemukan.'}</p>
            <Button variant="outline" size="sm" className="mt-2" onClick={() => refetch()} disabled={isFetching}>
              Coba lagi
            </Button>
          </AlertDescription>
        </Alert>
      </div>
    )
  }

  const hasCoords = data.latitude !== null && data.longitude !== null
  const remoteDisabled = !data.managementIp || !data.isActive
  const remoteDisabledReason = !data.isActive
    ? 'Perangkat nonaktif.'
    : 'Management IP belum diisi — remote tidak dapat dibuka.'

  return (
    <div className="grid grid-cols-1 gap-6">
      <nav aria-label="Breadcrumb" className="flex items-center gap-1 text-xs text-muted-foreground">
        <Link to="/inventory" className="hover:underline">
          Inventaris ONU
        </Link>
        <ChevronRight className="size-3" aria-hidden />
        <span>Detail perangkat</span>
      </nav>

      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="grid size-12 shrink-0 place-items-center rounded-xl bg-accent text-accent-foreground">
            <Router className="size-6" aria-hidden />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{data.name}</h1>
            <p className="text-sm text-muted-foreground">
              Serial: <span className="font-mono">{data.serialNumber ?? 'belum ada'}</span>
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={data.displayStatus} />
          {!data.isActive && <Badge variant="destructive">Nonaktif</Badge>}
          {can('inventory.write') && (
            <Button variant="outline" onClick={() => setEditOpen(true)}>
              <Pencil aria-hidden /> Edit metadata
            </Button>
          )}
          <RemoteButton uuid={data.uuid} disabled={remoteDisabled} disabledReason={remoteDisabledReason} />
        </div>
      </header>

      {data.displayStatus === 'sync_error' && (
        <Alert variant="destructive">
          <ShieldAlert />
          <AlertTitle>Sinkronisasi terakhir gagal</AlertTitle>
          <AlertDescription>
            {data.device?.syncError ?? 'Data dari GenieACS tidak dapat diperbarui.'} Data lama tetap ditampilkan.
          </AlertDescription>
        </Alert>
      )}
      {data.displayStatus === 'stale' && (
        <Alert>
          <Clock />
          <AlertTitle>Data mungkin sudah usang</AlertTitle>
          <AlertDescription>
            Sinkronisasi terakhir {formatRelative(data.lastSyncedAt)}. Status perangkat dapat berubah sejak saat itu.
          </AlertDescription>
        </Alert>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,0.7fr)]">
        <Card>
          <CardHeader>
            <CardTitle>Identitas & status</CardTitle>
            <CardDescription>Sumber: metadata AMO dan GenieACS.</CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="divide-y">
              <Field label="Vendor / Model">{[data.manufacturer, data.model].filter(Boolean).join(' · ') || '—'}</Field>
              <Field label="Product Class">{data.productClass ?? '—'}</Field>
              <Field label="OUI">{data.oui ?? '—'}</Field>
              <Field label="Management IP">
                <span className="font-mono">{data.managementIp ?? '—'}</span>
              </Field>
              <Field label="Target remote">
                <span className="font-mono">
                  {data.remoteScheme}://{data.managementIp ?? '—'}:{data.remotePort}
                </span>
              </Field>
              <Field label="Lokasi">{data.locationName ?? '—'}</Field>
              <Field label="Alamat">{data.address ?? '—'}</Field>
              <Field label="Koordinat">
                {hasCoords ? (
                  <a
                    className="text-primary hover:underline"
                    href={`https://www.google.com/maps?q=${data.latitude},${data.longitude}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {data.latitude}, {data.longitude}
                  </a>
                ) : (
                  'Belum ada koordinat'
                )}
              </Field>
              <Field label="Last inform">{formatDateTime(data.lastInformAt)}</Field>
              <Field label="Last sync">{formatDateTime(data.lastSyncedAt)}</Field>
              <Field label="Tertaut GenieACS">
                {data.linked ? (
                  <span className="font-mono text-xs">{data.device?.genieacsDeviceId}</span>
                ) : (
                  <Badge variant="outline">Belum tertaut</Badge>
                )}
              </Field>
              <Field label="Catatan">{data.notes ?? '—'}</Field>
            </dl>
          </CardContent>
        </Card>

        <Card className="h-fit">
          <CardHeader>
            <CardTitle>Lokasi perangkat</CardTitle>
            <CardDescription>Peta hanya menampilkan perangkat dengan koordinat valid.</CardDescription>
          </CardHeader>
          <CardContent>
            {hasCoords ? (
              <div className="grid gap-2">
                <div className="grid h-40 place-items-center rounded-lg border bg-muted/40 text-center">
                  <div className="grid gap-1">
                    <MapPin className="mx-auto size-6 text-primary" aria-hidden />
                    <p className="text-sm font-medium">
                      {data.latitude}, {data.longitude}
                    </p>
                    <Button asChild variant="link" size="sm">
                      <Link to={`/map?focus=${data.uuid}`}>Lihat di peta</Link>
                    </Button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="grid h-40 place-items-center rounded-lg border border-dashed text-center text-sm text-muted-foreground">
                <div className="grid gap-1 px-4">
                  <MapPin className="mx-auto size-5" aria-hidden />
                  <p>Koordinat belum diisi.</p>
                  <p className="text-xs">Perangkat tetap dapat dikelola tanpa pin peta.</p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Parameter perangkat</CardTitle>
          <CardDescription>Snapshot dari GenieACS (nilai sensitif sudah diredaksi).</CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="summary">
            <TabsList>
              <TabsTrigger value="summary">Ringkasan</TabsTrigger>
              <TabsTrigger value="raw">Parameter mentah</TabsTrigger>
            </TabsList>
            <TabsContent value="summary">
              <dl className="divide-y">
                <Field label="DeviceID.SerialNumber">{data.serialNumber ?? '—'}</Field>
                <Field label="DeviceID.Manufacturer">{data.manufacturer ?? '—'}</Field>
                <Field label="DeviceID.ProductClass">{data.productClass ?? '—'}</Field>
                <Field label="Management IP">
                  {data.managementIp ?? '—'} <span className="text-xs text-muted-foreground">(metadata AMO)</span>
                </Field>
              </dl>
            </TabsContent>
            <TabsContent value="raw">
              {data.device?.parameters ? (
                <pre className="max-h-96 overflow-auto rounded-lg bg-muted p-3 text-xs">
                  {JSON.stringify(data.device.parameters, null, 2)}
                </pre>
              ) : (
                <div className="grid place-items-center gap-1 py-10 text-center text-sm text-muted-foreground">
                  <Cpu className="size-5" aria-hidden />
                  <p>Belum ada snapshot parameter.</p>
                  <p className="text-xs">Jalankan sinkronisasi GenieACS untuk mengisi data ini.</p>
                </div>
              )}
            </TabsContent>
          </Tabs>
          <Separator className="my-4" />
          <p className="text-xs text-muted-foreground">
            Terakhir diperbarui: {formatDateTime(data.updatedAt)} · Dibuat: {formatDateTime(data.createdAt)}
          </p>
        </CardContent>
      </Card>

      <InventoryFormDialog open={editOpen} onOpenChange={setEditOpen} device={data} />
    </div>
  )
}
