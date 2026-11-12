import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Filter,
  Link2,
  Plus,
  Router,
  Search,
  Trash2,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Empty, EmptyDescription, EmptyIcon, EmptyTitle } from '@/components/ui/empty'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { StatusBadge } from '@/components/StatusBadge'
import { useAuth } from '@/features/auth/auth-context'
import { SyncNowButton } from '@/features/genieacs/SyncNowButton'
import { formatRelative } from '@/lib/format'
import { fetchInventory, fetchInventoryFacets, fetchAcsUnlinkedDevices, inventoryKeys, linkInventoryToDevice, deleteInventory, type InventoryListParams } from './inventory.api'
import { InventoryFormDialog } from './InventoryFormDialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'

const PAGE_SIZE = 25

/**
 * Inventaris ONU (PRD §3.3, §5.2).
 *
 * - Pencarian & filter disimpan di URL (bisa dibagikan / di-refresh tanpa kehilangan state).
 * - Pagination di sisi SERVER.
 * - Empat state wajib: loading (skeleton), error (alert + coba lagi), empty, data.
 */
export default function InventoryPage() {
  const { can } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const [formOpen, setFormOpen] = useState(false)
  const [searchInput, setSearchInput] = useState(searchParams.get('q') ?? '')

  const params: InventoryListParams = useMemo(
    () => ({
      page: Number(searchParams.get('page') ?? 1),
      pageSize: PAGE_SIZE,
      q: searchParams.get('q') ?? undefined,
      status: searchParams.get('status') ?? undefined,
      manufacturer: searchParams.get('manufacturer') ?? undefined,
      model: searchParams.get('model') ?? undefined,
      linked: searchParams.get('linked') ?? undefined,
      sort: searchParams.get('sort') ?? 'createdAt',
      order: searchParams.get('order') ?? 'desc',
    }),
    [searchParams],
  )

  const list = useQuery({
    queryKey: inventoryKeys.list(params),
    queryFn: () => fetchInventory(params),
    placeholderData: keepPreviousData,
    refetchInterval: 60_000,
  })
  const facets = useQuery({ queryKey: inventoryKeys.facets, queryFn: fetchInventoryFacets, staleTime: 5 * 60_000 })

  // Panel "Perangkat ACS belum tertaut" — hanya untuk yang boleh menulis.
  const queryClient = useQueryClient()
  const canWrite = can('inventory.write')
  const unlinked = useQuery({
    queryKey: inventoryKeys.acsUnlinked,
    queryFn: fetchAcsUnlinkedDevices,
    enabled: canWrite,
    refetchInterval: 60_000,
  })
  const quickLink = useMutation({
    mutationFn: (d: { genieacsDeviceId: string; name: string }) => linkInventoryToDevice(d.genieacsDeviceId, d.name),
    onSuccess: (created) => {
      toast.success(`Perangkat "${created.name}" ditautkan ke inventaris.`)
      void queryClient.invalidateQueries({ queryKey: inventoryKeys.all })
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] })
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Gagal menautkan perangkat.'),
  })

  // ── Hapus ONU (soft-delete di server) ──
  const [deleteTarget, setDeleteTarget] = useState<{ uuid: string; name: string } | null>(null)
  const deleteMut = useMutation({
    mutationFn: (uuid: string) => deleteInventory(uuid),
    onSuccess: (res) => {
      toast.success(
        res.unlinkedDevices > 0
          ? `Perangkat dihapus. ${res.unlinkedDevices} tautan ACS dilepas dari inventaris.`
          : 'Perangkat dihapus dari inventaris.',
      )
      setDeleteTarget(null)
      void queryClient.invalidateQueries({ queryKey: inventoryKeys.all })
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] })
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Gagal menghapus perangkat.'),
  })

  /** Ubah satu parameter filter; reset ke halaman 1 kecuali yang diubah adalah `page`. */
  const setParam = (key: string, value: string | undefined) => {
    const next = new URLSearchParams(searchParams)
    if (value === undefined || value === '' || value === 'all') next.delete(key)
    else next.set(key, value)
    if (key !== 'page') next.delete('page')
    setSearchParams(next, { replace: true })
  }

  const submitSearch = (e: React.FormEvent) => {
    e.preventDefault()
    setParam('q', searchInput.trim() || undefined)
  }

  const clearFilters = () => {
    setSearchInput('')
    setSearchParams(new URLSearchParams(), { replace: true })
  }

  const hasFilters = ['q', 'status', 'manufacturer', 'model', 'linked'].some((k) => searchParams.has(k))
  const pagination = list.data?.pagination
  const items = list.data?.items ?? []

  return (
    <div className="grid grid-cols-1 gap-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Inventaris ONU</h1>
          <p className="text-sm text-muted-foreground">Cari, filter, dan kelola semua perangkat yang terdaftar.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <SyncNowButton />
          {can('inventory.write') && (
            <Button onClick={() => setFormOpen(true)}>
              <Plus aria-hidden /> Tambah / Tautkan ONU
            </Button>
          )}
        </div>
      </header>

      {/* Filter bar */}
      <Card>
        <CardContent className="grid gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <form onSubmit={submitSearch} className="flex min-w-56 flex-1 items-center gap-2">
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
                <Input
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  placeholder="Cari nama / serial / IP / lokasi…"
                  className="pl-8"
                  aria-label="Cari perangkat"
                />
              </div>
              <Button type="submit" variant="secondary">
                Cari
              </Button>
            </form>

            <Select value={params.status ?? 'all'} onValueChange={(v) => setParam('status', v)}>
              <SelectTrigger className="w-36" aria-label="Filter status">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Semua status</SelectItem>
                <SelectItem value="online">Online</SelectItem>
                <SelectItem value="offline">Offline</SelectItem>
                <SelectItem value="unknown">Unknown</SelectItem>
              </SelectContent>
            </Select>

            <Select value={params.manufacturer ?? 'all'} onValueChange={(v) => setParam('manufacturer', v)}>
              <SelectTrigger className="w-40" aria-label="Filter vendor">
                <SelectValue placeholder="Vendor" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Semua vendor</SelectItem>
                {(facets.data?.manufacturers ?? []).map((m) => (
                  <SelectItem key={m} value={m}>
                    {m}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={params.model ?? 'all'} onValueChange={(v) => setParam('model', v)}>
              <SelectTrigger className="w-40" aria-label="Filter model">
                <SelectValue placeholder="Model" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Semua model</SelectItem>
                {(facets.data?.models ?? []).map((m) => (
                  <SelectItem key={m} value={m}>
                    {m}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={params.linked ?? 'all'} onValueChange={(v) => setParam('linked', v)}>
              <SelectTrigger className="w-40" aria-label="Filter tautan ACS">
                <SelectValue placeholder="Tautan" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Semua tautan</SelectItem>
                <SelectItem value="linked">Tertaut GenieACS</SelectItem>
                <SelectItem value="unlinked">Belum tertaut</SelectItem>
              </SelectContent>
            </Select>

            {hasFilters && (
              <Button variant="ghost" size="sm" onClick={clearFilters}>
                <X aria-hidden /> Reset
              </Button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <Filter className="size-3.5" aria-hidden />
            <span>Urutkan:</span>
            <Select value={params.sort ?? 'createdAt'} onValueChange={(v) => setParam('sort', v)}>
              <SelectTrigger size="sm" className="w-36" aria-label="Urutkan berdasarkan">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="createdAt">Terbaru</SelectItem>
                <SelectItem value="name">Nama</SelectItem>
                <SelectItem value="lastSyncedAt">Sinkronisasi</SelectItem>
                <SelectItem value="status">Status</SelectItem>
              </SelectContent>
            </Select>
            <Select value={params.order ?? 'desc'} onValueChange={(v) => setParam('order', v)}>
              <SelectTrigger size="sm" className="w-28" aria-label="Arah urutan">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="desc">Menurun</SelectItem>
                <SelectItem value="asc">Menaik</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Panel: perangkat hasil sync yang belum tertaut (PRD §3.4) */}
      {canWrite && (unlinked.data?.items.length ?? 0) > 0 && (
        <Card>
          <CardContent className="grid gap-3">
            <div>
              <h2 className="flex items-center gap-2 text-sm font-semibold">
                <Link2 className="size-4" aria-hidden />
                Perangkat ACS belum tertaut
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium">{unlinked.data!.items.length}</span>
              </h2>
              <p className="text-xs text-muted-foreground">
                Hasil sinkronisasi GenieACS yang belum punya record inventaris. Tautkan cepat atau lengkapi lewat form.
              </p>
            </div>
            <div className="grid gap-2">
              {unlinked.data!.items.map((d) => (
                <div
                  key={d.genieacsDeviceId}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2"
                >
                  <div className="min-w-0">
                    <div className="truncate font-mono text-xs font-medium">{d.genieacsDeviceId}</div>
                    <div className="text-xs text-muted-foreground">
                      {[d.serialNumber, d.manufacturer, d.model].filter(Boolean).join(' · ') || 'Tanpa serial/model'}
                      {d.managementIp && <span className="font-mono"> · {d.managementIp}</span>}
                      {' · '}
                      <span className={d.onlineStatus === 'online' ? 'text-status-online' : 'text-status-offline'}>
                        {d.onlineStatus}
                      </span>
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={quickLink.isPending}
                    onClick={() =>
                      quickLink.mutate({
                        genieacsDeviceId: d.genieacsDeviceId,
                        name: d.serialNumber ?? d.model ?? d.genieacsDeviceId,
                      })
                    }
                  >
                    <Plus aria-hidden /> Tautkan cepat
                  </Button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {list.isError && (
        <Alert variant="destructive">
          <AlertCircle />
          <AlertTitle>Gagal memuat inventaris</AlertTitle>
          <AlertDescription>
            <p>{list.error instanceof Error ? list.error.message : 'Terjadi kesalahan.'}</p>
            <Button variant="outline" size="sm" className="mt-2" onClick={() => list.refetch()} disabled={list.isFetching}>
              Coba lagi
            </Button>
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardContent>
          {list.isPending ? (
            <div className="grid gap-2">
              {Array.from({ length: 6 }, (_, i) => (
                <Skeleton key={i} className="h-12" />
              ))}
            </div>
          ) : items.length === 0 ? (
            <Empty>
              <EmptyIcon>
                <Router />
              </EmptyIcon>
              <EmptyTitle>{hasFilters ? 'Tidak ada perangkat yang cocok' : 'Belum ada perangkat terdaftar'}</EmptyTitle>
              <EmptyDescription>
                {hasFilters
                  ? 'Coba ubah kata kunci atau reset filter.'
                  : 'Tambahkan perangkat baru atau jalankan sinkronisasi GenieACS untuk mengisi inventaris.'}
              </EmptyDescription>
              {hasFilters ? (
                <Button variant="outline" size="sm" onClick={clearFilters}>
                  Reset filter
                </Button>
              ) : can('inventory.write') ? (
                <Button size="sm" onClick={() => setFormOpen(true)}>
                  <Plus aria-hidden /> Tambah perangkat
                </Button>
              ) : null}
            </Empty>
          ) : (
            <>
              <div className="hidden md:block">
              <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nama perangkat</TableHead>
                  <TableHead>Serial number</TableHead>
                  <TableHead>Model</TableHead>
                  <TableHead>IP</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Sinkronisasi</TableHead>
                  <TableHead className="text-right">Aksi</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((d) => (
                  <TableRow key={d.uuid}>
                    <TableCell>
                      <Link to={`/inventory/${d.uuid}`} className="font-medium hover:underline">
                        {d.name}
                      </Link>
                      <div className="text-xs text-muted-foreground">{d.locationName ?? 'Lokasi belum diisi'}</div>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{d.serialNumber ?? '—'}</TableCell>
                    <TableCell>
                      {[d.manufacturer, d.model].filter(Boolean).join(' ') || '—'}
                      {!d.linked && (
                        <Badge variant="outline" className="ml-2 text-[10px]">
                          belum tertaut
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{d.managementIp ?? '—'}</TableCell>
                    <TableCell>
                      <StatusBadge status={d.displayStatus} />
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{formatRelative(d.lastSyncedAt)}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <Button asChild variant="outline" size="sm">
                          <Link to={`/inventory/${d.uuid}`}>
                            Detail <ExternalLink aria-hidden />
                          </Link>
                        </Button>
                        {canWrite && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="text-destructive hover:text-destructive"
                            aria-label={`Hapus ${d.name}`}
                            onClick={() => setDeleteTarget({ uuid: d.uuid, name: d.name })}
                          >
                            <Trash2 aria-hidden />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
              </Table>
              </div>
              <div className="grid gap-3 md:hidden">
                {items.map((d) => (
                  <Card key={d.uuid} size="sm" className="gap-0 overflow-hidden">
                  <CardHeader className="flex-row items-start justify-between gap-3 border-b pb-3">
                    <div className="min-w-0">
                      <CardTitle className="truncate text-sm">
                        <Link to={`/inventory/${d.uuid}`} className="hover:text-primary hover:underline">
                          {d.name}
                        </Link>
                      </CardTitle>
                      <p className="mt-1 truncate text-xs text-muted-foreground">
                        {d.locationName ?? 'Lokasi belum diisi'}
                      </p>
                    </div>
                    <StatusBadge status={d.displayStatus} className="shrink-0" />
                  </CardHeader>
                  <CardContent className="grid grid-cols-2 gap-x-4 gap-y-3 py-3 text-xs">
                    <div className="min-w-0">
                      <p className="text-muted-foreground">Serial number</p>
                      <p className="mt-0.5 truncate font-mono font-medium">{d.serialNumber ?? '—'}</p>
                    </div>
                    <div className="min-w-0">
                      <p className="text-muted-foreground">Model</p>
                      <p className="mt-0.5 truncate font-medium">{[d.manufacturer, d.model].filter(Boolean).join(' ') || '—'}</p>
                      {!d.linked && <Badge variant="outline" className="mt-1 text-[10px]">Belum tertaut</Badge>}
                    </div>
                    <div className="min-w-0">
                      <p className="text-muted-foreground">IP</p>
                      <p className="mt-0.5 truncate font-mono font-medium">{d.managementIp ?? '—'}</p>
                    </div>
                    <div className="min-w-0">
                      <p className="text-muted-foreground">Sinkronisasi</p>
                      <p className="mt-0.5 truncate font-medium">{formatRelative(d.lastSyncedAt)}</p>
                    </div>
                  </CardContent>
                  <CardFooter className="gap-2 border-t pt-3">
                    <Button asChild variant="outline" size="sm" className="flex-1">
                      <Link to={`/inventory/${d.uuid}`}>
                        Detail <ExternalLink aria-hidden />
                      </Link>
                    </Button>
                    {canWrite && (
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className="text-destructive hover:text-destructive"
                        aria-label={`Hapus ${d.name}`}
                        onClick={() => setDeleteTarget({ uuid: d.uuid, name: d.name })}
                      >
                        <Trash2 aria-hidden />
                      </Button>
                    )}
                  </CardFooter>
                  </Card>
                ))}
              </div>
            </>
          )}

          {pagination && pagination.total > 0 && (
            <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
              <span>
                Menampilkan {(pagination.page - 1) * pagination.pageSize + 1}–
                {Math.min(pagination.page * pagination.pageSize, pagination.total)} dari {pagination.total} perangkat
              </span>
              <div className="flex items-center gap-1">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={pagination.page <= 1}
                  onClick={() => setParam('page', String(pagination.page - 1))}
                >
                  <ChevronLeft aria-hidden /> Sebelumnya
                </Button>
                <span className="px-2">
                  {pagination.page} / {Math.max(pagination.totalPages, 1)}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={pagination.page >= pagination.totalPages}
                  onClick={() => setParam('page', String(pagination.page + 1))}
                >
                  Berikutnya <ChevronRight aria-hidden />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <InventoryFormDialog open={formOpen} onOpenChange={setFormOpen} />

      {/* Konfirmasi hapus: soft-delete di server, data tidak hilang fisik. */}
      <AlertDialog open={deleteTarget !== null} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Hapus perangkat "{deleteTarget?.name}"?</AlertDialogTitle>
            <AlertDialogDescription>
              Record dinonaktifkan (tidak dihapus fisik) dan penautan ke GenieACS dilepas.
              Perangkat bisa muncul kembali sebagai draft bila sinkronisasi otomatis aktif,
              atau ditambahkan lagi secara manual.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              disabled={deleteMut.isPending}
              onClick={(e) => {
                e.preventDefault()
                if (deleteTarget) deleteMut.mutate(deleteTarget.uuid)
              }}
            >
              {deleteMut.isPending ? 'Menghapus…' : 'Hapus'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
