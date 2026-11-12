import { lazy, Suspense } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { AlertCircle, MapPin } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Empty, EmptyDescription, EmptyIcon, EmptyTitle } from '@/components/ui/empty'
import { Skeleton } from '@/components/ui/skeleton'
import { fetchInventoryMap, inventoryKeys } from '@/features/inventory/inventory.api'

// Leaflet cukup berat → dimuat terpisah agar bundle awal tetap kecil (PRD §5.4).
const MapView = lazy(() => import('./MapView'))

/**
 * Halaman Peta Perangkat (PRD §5.4).
 * Hanya perangkat dengan koordinat valid yang ditampilkan; sisanya dilaporkan
 * sebagai "tanpa koordinat" agar operator tahu datanya belum lengkap.
 */
export default function MapPage() {
  const [searchParams] = useSearchParams()
  const focus = searchParams.get('focus') ?? undefined

  const { data, isPending, isError, error, refetch, isFetching } = useQuery({
    queryKey: inventoryKeys.map,
    queryFn: fetchInventoryMap,
    refetchInterval: 60_000,
  })

  return (
    <div className="grid grid-cols-1 gap-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Peta Perangkat</h1>
        <p className="text-sm text-muted-foreground">Sebaran lokasi ONU dengan koordinat yang valid.</p>
      </header>

      {isError && (
        <Alert variant="destructive">
          <AlertCircle />
          <AlertTitle>Gagal memuat peta</AlertTitle>
          <AlertDescription>
            <p>{error instanceof Error ? error.message : 'Terjadi kesalahan.'}</p>
            <Button variant="outline" size="sm" className="mt-2" onClick={() => refetch()} disabled={isFetching}>
              Coba lagi
            </Button>
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Sebaran perangkat</CardTitle>
          <CardDescription>
            {data
              ? `${data.items.length} perangkat dipetakan · ${data.withoutCoordinates} perangkat belum memiliki koordinat`
              : 'Memuat data perangkat…'}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          {isPending ? (
            <Skeleton className="h-[32rem] w-full rounded-xl" />
          ) : data && data.items.length === 0 ? (
            <Empty>
              <EmptyIcon>
                <MapPin />
              </EmptyIcon>
              <EmptyTitle>Belum ada perangkat dengan koordinat</EmptyTitle>
              <EmptyDescription>
                Isi latitude &amp; longitude pada detail perangkat agar muncul di peta. Perangkat tanpa koordinat tetap
                dapat dikelola di halaman Inventaris.
              </EmptyDescription>
            </Empty>
          ) : data ? (
            <>
              <Suspense fallback={<Skeleton className="h-[32rem] w-full rounded-xl" />}>
                <MapView points={data.items} focus={focus} />
              </Suspense>
              <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1.5">
                  <span className="size-2 rounded-full bg-status-online" aria-hidden /> Online
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="size-2 rounded-full bg-status-offline" aria-hidden /> Offline / sync error
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="size-2 rounded-full bg-status-unknown" aria-hidden /> Unknown
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="size-2 rounded-full bg-status-stale" aria-hidden /> Stale
                </span>
              </div>
            </>
          ) : null}
        </CardContent>
      </Card>
    </div>
  )
}
