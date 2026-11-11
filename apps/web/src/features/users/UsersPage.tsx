import { useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { AlertCircle, ChevronLeft, ChevronRight, Pencil, Plus, Search, Users } from 'lucide-react'
import type { UserListItemDTO } from '@amo/shared'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Empty, EmptyDescription, EmptyIcon, EmptyTitle } from '@/components/ui/empty'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { formatDateTime } from '@/lib/format'
import { fetchUsers, ROLE_LABEL, usersKeys } from './users.api'
import { UserFormDialog } from './UserFormDialog'

const PAGE_SIZE = 20

/** Manajemen pengguna (PRD §2) — admin saja. */
export default function UsersPage() {
  const [page, setPage] = useState(1)
  const [q, setQ] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [role, setRole] = useState<string>('all')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<UserListItemDTO | null>(null)

  const { data, isPending, isError, error, refetch, isFetching } = useQuery({
    queryKey: usersKeys.list({ page, pageSize: PAGE_SIZE, q, role: role === 'all' ? undefined : role }),
    queryFn: () => fetchUsers({ page, pageSize: PAGE_SIZE, q, role: role === 'all' ? undefined : role }),
    placeholderData: keepPreviousData,
  })

  const openCreate = () => {
    setEditing(null)
    setDialogOpen(true)
  }
  const openEdit = (user: UserListItemDTO) => {
    setEditing(user)
    setDialogOpen(true)
  }

  const items = data?.items ?? []
  const pagination = data?.pagination

  return (
    <div className="grid grid-cols-1 gap-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Pengguna</h1>
          <p className="text-sm text-muted-foreground">Kelola akun, role, dan status akses.</p>
        </div>
        <Button onClick={openCreate}>
          <Plus aria-hidden /> Tambah pengguna
        </Button>
      </header>

      <Card>
        <CardContent className="flex flex-wrap items-center gap-2">
          <form
            className="flex min-w-56 flex-1 items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              setPage(1)
              setQ(searchInput.trim())
            }}
          >
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <Input
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="Cari nama / email…"
                className="pl-8"
                aria-label="Cari pengguna"
              />
            </div>
            <Button type="submit" variant="secondary">
              Cari
            </Button>
          </form>
          <Select
            value={role}
            onValueChange={(v) => {
              setRole(v)
              setPage(1)
            }}
          >
            <SelectTrigger className="w-40" aria-label="Filter role">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Semua role</SelectItem>
              <SelectItem value="admin">Administrator</SelectItem>
              <SelectItem value="operator">Operator</SelectItem>
              <SelectItem value="viewer">Viewer</SelectItem>
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      {isError && (
        <Alert variant="destructive">
          <AlertCircle />
          <AlertTitle>Gagal memuat pengguna</AlertTitle>
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
              {Array.from({ length: 5 }, (_, i) => (
                <Skeleton key={i} className="h-12" />
              ))}
            </div>
          ) : items.length === 0 ? (
            <Empty>
              <EmptyIcon>
                <Users />
              </EmptyIcon>
              <EmptyTitle>Tidak ada pengguna</EmptyTitle>
              <EmptyDescription>Ubah kata kunci pencarian atau tambahkan pengguna baru.</EmptyDescription>
            </Empty>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nama</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Login terakhir</TableHead>
                  <TableHead className="text-right">Aksi</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((u) => (
                  <TableRow key={u.id}>
                    <TableCell className="font-medium">{u.name}</TableCell>
                    <TableCell className="text-sm">{u.email}</TableCell>
                    <TableCell>
                      <Badge variant={u.role === 'admin' ? 'default' : 'secondary'}>{ROLE_LABEL[u.role]}</Badge>
                    </TableCell>
                    <TableCell>
                      {u.isActive ? (
                        <span className="text-xs font-semibold text-status-online">Aktif</span>
                      ) : (
                        <span className="text-xs font-semibold text-status-offline">Nonaktif</span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{formatDateTime(u.lastLoginAt)}</TableCell>
                    <TableCell className="text-right">
                      <Button variant="outline" size="sm" onClick={() => openEdit(u)}>
                        <Pencil aria-hidden /> Ubah
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}

          {pagination && pagination.total > 0 && (
            <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
              <span>
                {pagination.total} pengguna · halaman {pagination.page} / {Math.max(pagination.totalPages, 1)}
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

      <UserFormDialog open={dialogOpen} onOpenChange={setDialogOpen} user={editing} />
    </div>
  )
}
