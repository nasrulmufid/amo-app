import { useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { AlertCircle, ChevronLeft, ChevronRight, ScrollText } from 'lucide-react'
import { AUDIT_ACTIONS, AUDIT_ACTION_LABELS, type AuditAction } from '@amo/shared'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Empty, EmptyDescription, EmptyIcon, EmptyTitle } from '@/components/ui/empty'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { formatDateTime } from '@/lib/format'
import { auditKeys, fetchAuditLogs } from './audit.api'

const PAGE_SIZE = 25

/** Audit log (PRD §9.1, §16) — role dengan izin `audit.read`. */
export default function AuditLogPage() {
  const [page, setPage] = useState(1)
  const [action, setAction] = useState<string>('all')

  const { data, isPending, isError, error, refetch, isFetching } = useQuery({
    queryKey: auditKeys.list({ page, pageSize: PAGE_SIZE, action: action === 'all' ? undefined : action }),
    queryFn: () => fetchAuditLogs({ page, pageSize: PAGE_SIZE, action: action === 'all' ? undefined : action }),
    placeholderData: keepPreviousData,
  })

  const items = data?.items ?? []
  const pagination = data?.pagination

  return (
    <div className="grid grid-cols-1 gap-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Audit Log</h1>
          <p className="text-sm text-muted-foreground">Riwayat aktivitas penting untuk penelusuran dan keamanan.</p>
        </div>
        <Select
          value={action}
          onValueChange={(v) => {
            setAction(v)
            setPage(1)
          }}
        >
          <SelectTrigger className="w-56" aria-label="Filter aksi">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Semua aksi</SelectItem>
            {AUDIT_ACTIONS.map((a) => (
              <SelectItem key={a} value={a}>
                {AUDIT_ACTION_LABELS[a]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </header>

      {isError && (
        <Alert variant="destructive">
          <AlertCircle />
          <AlertTitle>Gagal memuat audit log</AlertTitle>
          <AlertDescription>
            <p>{error instanceof Error ? error.message : 'Terjadi kesalahan.'}</p>
            <Button variant="outline" size="sm" className="mt-2" onClick={() => refetch()} disabled={isFetching}>
              Coba lagi
            </Button>
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardContent>
          {isPending ? (
            <div className="grid gap-2">
              {Array.from({ length: 6 }, (_, i) => (
                <Skeleton key={i} className="h-12" />
              ))}
            </div>
          ) : items.length === 0 ? (
            <Empty>
              <EmptyIcon>
                <ScrollText />
              </EmptyIcon>
              <EmptyTitle>Belum ada aktivitas tercatat</EmptyTitle>
              <EmptyDescription>Aktivitas login, perubahan inventaris, dan akses remote akan muncul di sini.</EmptyDescription>
            </Empty>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Waktu</TableHead>
                  <TableHead>Aksi</TableHead>
                  <TableHead>Pengguna</TableHead>
                  <TableHead>Resource</TableHead>
                  <TableHead>IP</TableHead>
                  <TableHead>Request ID</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((log) => (
                  <TableRow key={log.id}>
                    <TableCell className="whitespace-nowrap text-xs">{formatDateTime(log.createdAt)}</TableCell>
                    <TableCell>
                      <Badge variant={log.action.includes('failed') || log.action.includes('denied') ? 'destructive' : 'secondary'}>
                        {AUDIT_ACTION_LABELS[log.action as AuditAction] ?? log.action}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm">{log.userName ?? '—'}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {log.resourceType ? `${log.resourceType}${log.resourceId ? ` · ${log.resourceId}` : ''}` : '—'}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{log.ipAddress ?? '—'}</TableCell>
                    <TableCell className="font-mono text-[11px] text-muted-foreground">{log.requestId ?? '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}

          {pagination && pagination.total > 0 && (
            <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
              <span>
                {pagination.total} entri · halaman {pagination.page} / {Math.max(pagination.totalPages, 1)}
              </span>
              <div className="flex items-center gap-1">
                <Button variant="outline" size="sm" disabled={pagination.page <= 1} onClick={() => setPage((p) => p - 1)}>
                  <ChevronLeft aria-hidden /> Sebelumnya
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={pagination.page >= pagination.totalPages}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Berikutnya <ChevronRight aria-hidden />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
