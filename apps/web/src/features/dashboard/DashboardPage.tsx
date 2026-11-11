import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { AlertCircle, ArrowRight, CircleAlert, ListChecks, MapPin, ScrollText, Wifi, WifiOff, Router } from 'lucide-react'
import type { ReactNode } from 'react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { StatusBadge } from '@/components/StatusBadge'
import { useAuth } from '@/features/auth/auth-context'
import { formatDateTime, formatRelative } from '@/lib/format'
import { dashboardKeys, fetchDashboardSummary } from './dashboard.api'

function StatCard({ label, value, hint, icon, tone }: { label: string; value: number; hint: string; icon: ReactNode; tone?: string }) {
  return (
    <Card className="gap-2 py-4 sm:py-5">
      <CardHeader className="flex-row items-center justify-between px-4 sm:px-5">
        <CardDescription className="text-xs font-medium sm:text-sm">{label}</CardDescription>
        <span className={tone ?? 'text-muted-foreground'} aria-hidden>{icon}</span>
      </CardHeader>
      <CardContent className="px-4 sm:px-5">
        <div className="text-2xl font-semibold tabular-nums sm:text-3xl">{value.toLocaleString('id-ID')}</div>
        <p className="mt-1 text-[11px] leading-snug text-muted-foreground sm:text-xs">{hint}</p>
      </CardContent>
    </Card>
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
      <header className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
          <p className="text-sm text-muted-foreground">Ringkasan kondisi perangkat jaringan Anda.</p>
        </div>
        {/* PRD §5: tampilkan sumber & waktu data terakhir diperbarui */}
        {data && (
          <p className="text-xs text-muted-foreground">
            Sinkronisasi GenieACS terakhir: <span className="font-medium text-foreground">{formatDateTime(data.lastSyncedAt)}</span>
          </p>
        )}
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
            <StatCard label="Total ONU" value={data.totals.total} hint="Terdaftar" icon={<Router className="size-4" />} />
            <StatCard label="Online" value={data.totals.online} hint="Status aktif" icon={<Wifi className="size-4" />} tone="text-status-online" />
            <StatCard label="Offline" value={data.totals.offline} hint={`Perlu diperiksa · ${data.totals.unknown} belum diketahui`} icon={<WifiOff className="size-4" />} tone="text-status-offline" />
            <StatCard label="Perlu data" value={data.totals.needsData} hint="Koordinat / serial belum lengkap" icon={<CircleAlert className="size-4" />} tone="text-status-stale" />
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
                      <TableCell><StatusBadge status={d.onlineStatus} /></TableCell>
                      <TableCell className="text-muted-foreground">{formatRelative(d.lastSyncedAt)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
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
