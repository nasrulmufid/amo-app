import type { Role, UserCreateInput, UserListItemDTO, UserUpdateInput } from '@amo/shared'
import { api } from '@/lib/api'

export const usersKeys = {
  all: ['users'] as const,
  list: (params: { page: number; pageSize: number; q?: string; role?: string }) => ['users', 'list', params] as const,
}

export const fetchUsers = (params: { page: number; pageSize: number; q?: string; role?: string }) => {
  const search = new URLSearchParams()
  search.set('page', String(params.page))
  search.set('pageSize', String(params.pageSize))
  if (params.q) search.set('q', params.q)
  if (params.role) search.set('role', params.role)
  return api<{ items: UserListItemDTO[]; pagination: { page: number; pageSize: number; total: number; totalPages: number } }>(
    `/users?${search.toString()}`,
  )
}

export const createUser = (input: UserCreateInput) => api<UserListItemDTO>('/users', { method: 'POST', body: input })

export const updateUser = (id: number, input: UserUpdateInput) =>
  api<UserListItemDTO>(`/users/${id}`, { method: 'PATCH', body: input })

export const ROLE_LABEL: Record<Role, string> = {
  admin: 'Administrator',
  operator: 'Operator',
  viewer: 'Viewer',
}
