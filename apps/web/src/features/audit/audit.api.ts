import type { AuditLogDTO } from '@amo/shared'
import { api } from '@/lib/api'

export const auditKeys = {
  all: ['audit'] as const,
  list: (params: { page: number; pageSize: number; action?: string; userId?: number }) =>
    ['audit', 'list', params] as const,
}

export const fetchAuditLogs = (params: { page: number; pageSize: number; action?: string; userId?: number }) => {
  const search = new URLSearchParams()
  search.set('page', String(params.page))
  search.set('pageSize', String(params.pageSize))
  if (params.action) search.set('action', params.action)
  if (params.userId) search.set('userId', String(params.userId))
  return api<{
    items: AuditLogDTO[]
    pagination: { page: number; pageSize: number; total: number; totalPages: number }
  }>(`/audit-logs?${search.toString()}`)
}
