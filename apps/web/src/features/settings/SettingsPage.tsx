import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { AlertCircle, Loader2, Plus, RefreshCw, Save, Trash2, Wifi } from 'lucide-react'
import { PARAM_MAP_FIELDS, type ParamMapField, type SyncRunStatus } from '@amo/shared'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { FormItem, FormLabel } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ApiError } from '@/lib/api'
import { formatDateTime, formatRelative } from '@/lib/format'
import {
  createParameterMap,
  deleteParameterMap,
  fetchParameterMap,
  fetchSettings,
  fetchSyncRuns,
  fetchSyncStatus,
  pingGenieAcs,
  runSync,
  settingsKeys,
  updateParameterMap,
  updateSettings,
} from './settings.api'

const RUN_STATUS_VARIANT: Record<SyncRunStatus, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  running: 'outline',
  success: 'default',
  partial: 'secondary',
  failed: 'destructive',
}

/**
 * Pengaturan (PRD §7.6, §8.3, §11).
 *
 * Tab:
 *  1. Umum & sinkronisasi — interval, ambang online, retensi audit, nama aplikasi.
 *  2. Pemetaan parameter GenieACS — path tambahan per field/vendor/model.
 *  3. Riwayat sinkronisasi — status NBI, tombol "Sinkronkan sekarang", daftar run.
 *
 * Kebijakan remote (port/skema/CIDR) ditampilkan READ-ONLY karena berasal dari env.
 */
export default function SettingsPage() {
  return (
    <div className="grid grid-cols-1 gap-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Pengaturan</h1>
        <p className="text-sm text-muted-foreground">Konfigurasi operasional aplikasi dan integrasi GenieACS.</p>
      </header>

      <Tabs defaultValue="general">
        <TabsList>
          <TabsTrigger value="general">Umum & sinkronisasi</TabsTrigger>
          <TabsTrigger value="mapping">Pemetaan parameter</TabsTrigger>
          <TabsTrigger value="sync">Riwayat sinkronisasi</TabsTrigger>
        </TabsList>
        <TabsContent value="general">
          <GeneralSettings />
        </TabsContent>
        <TabsContent value="mapping">
          <ParameterMapping />
        </TabsContent>
        <TabsContent value="sync">
          <SyncPanel />
        </TabsContent>
      </Tabs>
    </div>
  )
}

function GeneralSettings() {
  const queryClient = useQueryClient()
  const { data, isPending, isError, error, refetch } = useQuery({
    queryKey: settingsKeys.detail,
    queryFn: fetchSettings,
  })

  const [form, setForm] = useState({
    appName: '',
    syncIntervalSeconds: 60,
    onlineThresholdSeconds: 600,
    syncEnabled: true,
    auditRetentionDays: 365,
  })

  useEffect(() => {
    if (!data) return
    setForm({
      appName: data.effective.appName,
      syncIntervalSeconds: data.effective.syncIntervalSeconds,
      onlineThresholdSeconds: data.effective.onlineThresholdSeconds,
      syncEnabled: data.effective.syncEnabled,
      auditRetentionDays: data.effective.auditRetentionDays,
    })
  }, [data])

  const mutation = useMutation({
    mutationFn: () =>
      updateSettings({
        'ui.appName': form.appName,
        'sync.intervalSeconds': Number(form.syncIntervalSeconds),
        'sync.onlineThresholdSeconds': Number(form.onlineThresholdSeconds),
        'sync.enabled': form.syncEnabled,
        'audit.retentionDays': Number(form.auditRetentionDays),
      }),
    onSuccess: () => {
      toast.success('Pengaturan disimpan')
      void queryClient.invalidateQueries({ queryKey: settingsKeys.all })
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : 'Gagal menyimpan pengaturan.'),
  })

  if (isPending) return <Skeleton className="h-72 rounded-xl" />
  if (isError || !data) {
    return (
      <Alert variant="destructive">
        <AlertCircle />
        <AlertTitle>Gagal memuat pengaturan</AlertTitle>
        <AlertDescription>
          <p>{error instanceof Error ? error.message : 'Terjadi kesalahan.'}</p>
          <Button variant="outline" size="sm" className="mt-2" onClick={() => refetch()}>
            Coba lagi
          </Button>
        </AlertDescription>
      </Alert>
    )
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Umum</CardTitle>
          <CardDescription>Nama aplikasi dan retensi data.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <FormItem>
            <FormLabel htmlFor="appName">Nama aplikasi</FormLabel>
            <Input id="appName" value={form.appName} onChange={(e) => setForm({ ...form, appName: e.target.value })} />
          </FormItem>
          <FormItem>
            <FormLabel htmlFor="retention">Retensi audit log (hari)</FormLabel>
            <Input
              id="retention"
              type="number"
              min={1}
              max={3650}
              value={form.auditRetentionDays}
              onChange={(e) => setForm({ ...form, auditRetentionDays: Number(e.target.value) })}
            />
          </FormItem>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Sinkronisasi GenieACS</CardTitle>
          <CardDescription>Interval dan ambang status perangkat.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="flex items-center justify-between rounded-lg border px-3 py-2">
            <div>
              <p className="text-sm font-medium">Sinkronisasi otomatis</p>
              <p className="text-xs text-muted-foreground">Jalankan sync berkala sesuai interval.</p>
            </div>
            <Switch
              checked={form.syncEnabled}
              onCheckedChange={(v) => setForm({ ...form, syncEnabled: v })}
              aria-label="Sinkronisasi otomatis"
            />
          </div>
          <FormItem>
            <FormLabel htmlFor="interval">Interval sinkronisasi (detik)</FormLabel>
            <Input
              id="interval"
              type="number"
              min={5}
              max={86400}
              value={form.syncIntervalSeconds}
              onChange={(e) => setForm({ ...form, syncIntervalSeconds: Number(e.target.value) })}
            />
          </FormItem>
          <FormItem>
            <FormLabel htmlFor="threshold">Ambang online (detik)</FormLabel>
            <Input
              id="threshold"
              type="number"
              min={30}
              max={86400}
              value={form.onlineThresholdSeconds}
              onChange={(e) => setForm({ ...form, onlineThresholdSeconds: Number(e.target.value) })}
            />
            <p className="text-xs text-muted-foreground">
              Perangkat dianggap offline bila last inform lebih lama dari nilai ini.
            </p>
          </FormItem>
        </CardContent>
      </Card>

      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle>Kebijakan remote (read-only)</CardTitle>
          <CardDescription>Diatur melalui environment server; tidak dapat diubah dari UI.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-2 text-sm sm:grid-cols-3">
          <div>
            <p className="text-xs text-muted-foreground">Port diizinkan</p>
            <p className="font-mono">{data.remotePolicy.allowedPorts.join(', ') || '—'}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Skema diizinkan</p>
            <p className="font-mono">{data.remotePolicy.allowedSchemes.join(', ')}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Allowlist CIDR</p>
            <p className="font-mono">{data.remotePolicy.allowedCidrs.join(', ') || 'kosong (tidak ada target)'}</p>
          </div>
        </CardContent>
      </Card>

      <div className="lg:col-span-2">
        <Button onClick={() => mutation.mutate()} disabled={mutation.isPending}>
          {mutation.isPending ? <Loader2 className="animate-spin" aria-hidden /> : <Save aria-hidden />}
          Simpan pengaturan
        </Button>
      </div>
    </div>
  )
}

function ParameterMapping() {
  const queryClient = useQueryClient()
  const { data, isPending } = useQuery({ queryKey: settingsKeys.parameterMap, queryFn: fetchParameterMap })
  const [draft, setDraft] = useState<{ fieldKey: ParamMapField; paramPath: string; manufacturer: string; model: string }>({
    fieldKey: 'model',
    paramPath: '',
    manufacturer: '',
    model: '',
  })

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: settingsKeys.parameterMap })

  const create = useMutation({
    mutationFn: () =>
      createParameterMap({
        fieldKey: draft.fieldKey,
        paramPath: draft.paramPath,
        manufacturer: draft.manufacturer || null,
        model: draft.model || null,
      }),
    onSuccess: () => {
      toast.success('Pemetaan ditambahkan')
      setDraft({ ...draft, paramPath: '', manufacturer: '', model: '' })
      invalidate()
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : 'Gagal menambah pemetaan.'),
  })

  const toggle = useMutation({
    mutationFn: ({ id, isActive }: { id: number; isActive: boolean }) => updateParameterMap(id, { isActive }),
    onSuccess: invalidate,
    onError: () => toast.error('Gagal mengubah pemetaan.'),
  })

  const remove = useMutation({
    mutationFn: (id: number) => deleteParameterMap(id),
    onSuccess: () => {
      toast.success('Pemetaan dihapus')
      invalidate()
    },
    onError: () => toast.error('Gagal menghapus pemetaan.'),
  })

  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Tambah pemetaan</CardTitle>
          <CardDescription>
            Path dicoba lebih dulu sebelum fallback bawaan. Kosongkan vendor/model agar berlaku untuk semua perangkat.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-[10rem_1fr_10rem_10rem_auto] sm:items-end">
          <FormItem>
            <FormLabel>Field</FormLabel>
            <Select value={draft.fieldKey} onValueChange={(v) => setDraft({ ...draft, fieldKey: v as ParamMapField })}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PARAM_MAP_FIELDS.map((f) => (
                  <SelectItem key={f} value={f}>
                    {f}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormItem>
          <FormItem>
            <FormLabel>Path parameter</FormLabel>
            <Input
              placeholder="InternetGatewayDevice.DeviceInfo.ModelName"
              value={draft.paramPath}
              onChange={(e) => setDraft({ ...draft, paramPath: e.target.value })}
            />
          </FormItem>
          <FormItem>
            <FormLabel>Vendor</FormLabel>
            <Input placeholder="(semua)" value={draft.manufacturer} onChange={(e) => setDraft({ ...draft, manufacturer: e.target.value })} />
          </FormItem>
          <FormItem>
            <FormLabel>Model</FormLabel>
            <Input placeholder="(semua)" value={draft.model} onChange={(e) => setDraft({ ...draft, model: e.target.value })} />
          </FormItem>
          <Button onClick={() => create.mutate()} disabled={create.isPending || draft.paramPath.trim() === ''}>
            {create.isPending ? <Loader2 className="animate-spin" aria-hidden /> : <Plus aria-hidden />}
            Tambah
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          {isPending ? (
            <Skeleton className="h-40" />
          ) : (data?.items.length ?? 0) === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Belum ada pemetaan tambahan. Fallback bawaan tetap dipakai.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Field</TableHead>
                  <TableHead>Path</TableHead>
                  <TableHead>Vendor / Model</TableHead>
                  <TableHead>Prioritas</TableHead>
                  <TableHead>Aktif</TableHead>
                  <TableHead className="text-right">Aksi</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data?.items.map((m) => (
                  <TableRow key={m.id}>
                    <TableCell className="font-mono text-xs">{m.fieldKey}</TableCell>
                    <TableCell className="font-mono text-xs">{m.paramPath}</TableCell>
                    <TableCell className="text-xs">
                      {[m.manufacturer, m.model].filter(Boolean).join(' / ') || 'semua'}
                    </TableCell>
                    <TableCell className="text-xs">{m.priority}</TableCell>
                    <TableCell>
                      <Switch
                        checked={m.isActive}
                        onCheckedChange={(v) => toggle.mutate({ id: m.id, isActive: v })}
                        aria-label={`Aktifkan pemetaan ${m.paramPath}`}
                      />
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="sm" onClick={() => remove.mutate(m.id)} aria-label="Hapus pemetaan">
                        <Trash2 aria-hidden />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function SyncPanel() {
  const queryClient = useQueryClient()
  const status = useQuery({ queryKey: settingsKeys.syncStatus, queryFn: fetchSyncStatus, refetchInterval: 30_000 })
  const runs = useQuery({ queryKey: settingsKeys.syncRuns, queryFn: fetchSyncRuns, refetchInterval: 30_000 })
  const ping = useQuery({ queryKey: ['settings', 'ping'], queryFn: pingGenieAcs, staleTime: 30_000 })

  const sync = useMutation({
    mutationFn: runSync,
    onSuccess: (result) => {
      toast.success(`Sinkronisasi selesai: ${result.success} berhasil, ${result.failed} gagal.`)
      void queryClient.invalidateQueries({ queryKey: settingsKeys.all })
      void queryClient.invalidateQueries({ queryKey: ['inventory'] })
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] })
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : 'Sinkronisasi gagal.'),
  })

  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader className="flex-row items-start justify-between gap-3">
          <div>
            <CardTitle>Status sinkronisasi</CardTitle>
            <CardDescription>
              Interval {status.data?.intervalSeconds ?? '—'} detik · ambang online {status.data?.onlineThresholdSeconds ?? '—'} detik
            </CardDescription>
          </div>
          <Button onClick={() => sync.mutate()} disabled={sync.isPending || status.data?.running}>
            {sync.isPending ? <Loader2 className="animate-spin" aria-hidden /> : <RefreshCw aria-hidden />}
            Sinkronkan sekarang
          </Button>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm sm:grid-cols-3">
          <div>
            <p className="text-xs text-muted-foreground">Konektivitas NBI</p>
            <p className="flex items-center gap-1.5 font-medium">
              <Wifi className="size-4" aria-hidden />
              {ping.isPending ? 'Memeriksa…' : ping.data?.ok ? 'Terjangkau' : 'Tidak terjangkau'}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Sync terakhir</p>
            <p className="font-medium">{formatRelative(status.data?.lastSyncedAt)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Sedang berjalan</p>
            <p className="font-medium">{status.data?.running ? 'Ya' : 'Tidak'}</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Riwayat sinkronisasi</CardTitle>
          <CardDescription>20 run terakhir.</CardDescription>
        </CardHeader>
        <CardContent>
          {runs.isPending ? (
            <Skeleton className="h-40" />
          ) : (runs.data?.items.length ?? 0) === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">Belum ada riwayat sinkronisasi.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Mulai</TableHead>
                  <TableHead>Trigger</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Ditemukan</TableHead>
                  <TableHead>Berhasil</TableHead>
                  <TableHead>Gagal</TableHead>
                  <TableHead>Catatan</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {runs.data?.items.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="whitespace-nowrap text-xs">{formatDateTime(r.startedAt)}</TableCell>
                    <TableCell className="text-xs">
                      {r.triggerType === 'manual' ? `Manual${r.triggeredByName ? ` · ${r.triggeredByName}` : ''}` : 'Terjadwal'}
                    </TableCell>
                    <TableCell>
                      <Badge variant={RUN_STATUS_VARIANT[r.status]}>{r.status}</Badge>
                    </TableCell>
                    <TableCell className="text-xs">{r.foundCount}</TableCell>
                    <TableCell className="text-xs">{r.successCount}</TableCell>
                    <TableCell className="text-xs">{r.failedCount}</TableCell>
                    <TableCell className="max-w-64 truncate text-xs text-muted-foreground" title={r.errorSummary ?? ''}>
                      {r.errorSummary ?? '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
