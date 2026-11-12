import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { AlertCircle, ArrowRight, CircleAlert, ListChecks, MapPin, ScrollText, Wifi, WifiOff, Router } from 'lucide-react'
import type { ReactNode } from 'react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { StatusBadge } from '@/components/StatusBadge'
import { useAuth } from '@/features/auth/auth-context'
import { SyncNowButton } from '@/features/genieacs/SyncNowButton'
import { formatDateTime, formatRelative } from '@/lib/format'
import { dashboardKeys, fetchDashboardSummary } from './dashboard.api'

function StatCard({
  label,
  value,
  hint,
  icon,
  tone,
  href,
}: {
  label: string
  value: number
  hint: string
  icon: ReactNode
  tone?: string
  href: string
}) {
  return (
    <Link to={href} aria-label={`${label}: ${value}. ${hint}`} className="group/stat-card block rounded-2xl outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
      <Card className="h-full gap-2 py-4 transition-shadow group-hover/stat-card:ring-primary/30 sm:py-5">
        <CardHeader className="flex-row items-center justify-between px-4 sm:px-5">
          <CardDescription className="text-xs font-medium sm:text-sm">{label}</CardDescription>
          <span className={tone ?? 'text-muted-foreground'} aria-hidden>{icon}</span>
        </CardHeader>
        <CardContent className="px-4 sm:px-5">
          <div className="text-2xl font-semibold tabular-nums sm:text-3xl">{value.toLocaleString('id-ID')}</div>
          <p className="mt-1 text-[11px] leading-snug text-muted-foreground sm:text-xs">{hint}</p>
        </CardContent>
      </Card>
    </Link>
  )
}

/**
 * ✅ CONTOH REFERENSI halaman data (pola yang sama untuk Inventaris, Audit, dll):
 *   useQuery → 4 state wajib PRD §5: loading (Skeleton), error (Alert + coba lagi),
 *   empty (pesan + aksi), dan data. Plus info kesegaran data (last sync).
 */
export default function DashboardPage() {
  const { can } = useAuth()
  const { data, isPending, isError, error, refetch, isFetching } = useQuery({
    queryKey: dashboardKeys.summary,
    queryFn: fetchDashboardSummary,
    refetchInterval: 60_000, // selaras interval sync default (60 dtk)
  })

  return (
    // grid-cols-1 = minmax(0,1fr): tanpa ini kolom implisit membengkak mengikuti lebar tabel → overflow di HP.
    <div className="grid grid-cols-1 gap-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
          <p className="text-sm text-muted-foreground">Ringkasan kondisi perangkat jaringan Anda.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {/* PRD §5: tampilkan sumber & waktu data terakhir diperbarui */}
          {data && (
            <p className="text-xs text-muted-foreground">
              Sinkronisasi GenieACS terakhir: <span className="font-medium text-foreground">{formatDateTime(data.lastSyncedAt)}</span>
            </p>
          )}
          <SyncNowButton />
        </div>
      </header>

      {isError && (
        <Alert variant="destructive">
          <AlertCircle />
          <AlertTitle>Gagal memuat dashboard</AlertTitle>
          <AlertDescription>
            <p>{error instanceof Error ? error.message : 'Terjadi kesalahan.'}</p>
            <Button variant="outline" size="sm" className="mt-2" onClick={() => refetch()} disabled={isFetching}>Coba lagi</Button>
          </AlertDescription>
        </Alert>
      )}

      {/* Kartu ringkasan — 2×2 di mobile, 4 kolom di layar lebar */}
      <section aria-label="Ringkasan" className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        {isPending ? (
          Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-32 rounded-xl" />)
        ) : data ? (
          <>
            <StatCard href="/inventory" label="Total ONU" value={data.totals.total} hint="Terdaftar · lihat inventaris" icon={<Router className="size-4" />} />
            <StatCard href="/inventory?status=online" label="Online" value={data.totals.online} hint="Status aktif · lihat perangkat" icon={<Wifi className="size-4" />} tone="text-status-online" />
            <StatCard href="/inventory?status=offline" label="Offline" value={data.totals.offline} hint={`${data.totals.stale} data stale · ${data.totals.unknown} unknown · ${data.totals.syncError} sync error`} icon={<WifiOff className="size-4" />} tone="text-status-offline" />
            <StatCard href="/inventory?needsData=true" label="Perlu data" value={data.totals.needsData} hint="Koordinat / serial belum lengkap · lihat perangkat" icon={<CircleAlert className="size-4" />} tone="text-status-stale" />
          </>
        ) : null}
      </section>

      <div className="grid gap-6 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_16rem]">
        {/* Perangkat terbaru */}
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>Perangkat terbaru</CardTitle>
            {can('inventory.read') && (
              <Button asChild variant="link" size="sm"><Link to="/inventory">Lihat semua <ArrowRight /></Link></Button>
            )}
          </CardHeader>
          <CardContent>
            {isPending ? (
              <div className="grid gap-2">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-10" />)}</div>
            ) : data && data.recent.length === 0 ? (
              <div className="py-10 text-center text-sm text-muted-foreground">
                <p className="font-medium text-foreground">Belum ada perangkat terdaftar</p>
                <p className="mt-1">Tambahkan atau tautkan ONU di halaman Inventaris untuk mulai memantau.</p>
              </div>
            ) : data ? (
              <>
                <div className="hidden md:block">
                <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nama / Serial</TableHead>
                    <TableHead>Model</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Sinkronisasi</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.recent.map((d) => (
                    <TableRow key={d.uuid}>
                      <TableCell>
                        <div className="font-medium">{d.name}</div>
                        <div className="text-xs text-muted-foreground">{d.serialNumber ?? 'Serial belum ada'}</div>
                      </TableCell>
                      <TableCell>{[d.manufacturer, d.model].filter(Boolean).join(' ') || '—'}</TableCell>
                      <TableCell><StatusBadge status={d.displayStatus} /></TableCell>
                      <TableCell className="text-muted-foreground">{formatRelative(d.lastSyncedAt)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
                </Table>
                </div>
                <div className="grid gap-3 md:hidden">
                  {data.recent.map((d) => (
                    <Card key={d.uuid} size="sm" className="gap-0">
                    <CardHeader className="flex-row items-start justify-between gap-3 border-b pb-3">
                      <div className="min-w-0">
                        <CardTitle className="truncate text-sm">{d.name}</CardTitle>
                        <p className="mt-1 truncate font-mono text-xs text-muted-foreground">
                          {d.serialNumber ?? 'Serial belum ada'}
                        </p>
                      </div>
                      <StatusBadge status={d.displayStatus} className="shrink-0" />
                    </CardHeader>
                    <CardFooter className="justify-between gap-3 pt-3 text-xs">
                      <div className="min-w-0 truncate">
                        <span className="text-muted-foreground">Model · </span>
                        {[d.manufacturer, d.model].filter(Boolean).join(' ') || '—'}
                      </div>
                      <span className="shrink-0 text-muted-foreground">{formatRelative(d.lastSyncedAt)}</span>
                    </CardFooter>
                    </Card>
                  ))}
                </div>
              </>
            ) : null}
          </CardContent>
        </Card>

        {/* Pintasan (PRD §3.2) — hanya yang diizinkan untuk role ini */}
        <Card className="h-fit">
          <CardHeader><CardTitle>Pintasan</CardTitle></CardHeader>
          <CardContent className="grid gap-2">
            {can('inventory.read') && <Button asChild variant="outline" className="justify-start"><Link to="/inventory"><ListChecks /> Inventaris ONU</Link></Button>}
            {can('inventory.read') && <Button asChild variant="outline" className="justify-start"><Link to="/map"><MapPin /> Peta Perangkat</Link></Button>}
            {can('audit.read') && <Button asChild variant="outline" className="justify-start"><Link to="/audit"><ScrollText /> Audit Log</Link></Button>}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
