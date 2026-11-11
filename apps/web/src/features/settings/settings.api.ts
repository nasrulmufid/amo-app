import type { AppSettingsDTO, DeviceParameterMapDTO, DeviceParameterMapInput, SyncRunDTO, SyncStatusDTO } from '@amo/shared'
import { api } from '@/lib/api'

export const settingsKeys = {
  all: ['settings'] as const,
  detail: ['settings', 'detail'] as const,
  parameterMap: ['settings', 'parameter-map'] as const,
  syncStatus: ['settings', 'sync-status'] as const,
  syncRuns: ['settings', 'sync-runs'] as const,
}

export const fetchSettings = () => api<AppSettingsDTO>('/settings')

export const updateSettings = (values: Record<string, unknown>) =>
  api<AppSettingsDTO>('/settings', { method: 'PATCH', body: { values } })

export const fetchParameterMap = () =>
  api<{ items: DeviceParameterMapDTO[] }>('/settings/parameter-map')

export const createParameterMap = (input: DeviceParameterMapInput) =>
  api<DeviceParameterMapDTO>('/settings/parameter-map', { method: 'POST', body: input })

export const updateParameterMap = (id: number, input: Partial<DeviceParameterMapInput>) =>
  api<DeviceParameterMapDTO>(`/settings/parameter-map/${id}`, { method: 'PATCH', body: input })

export const deleteParameterMap = (id: number) =>
  api<{ deleted: boolean }>(`/settings/parameter-map/${id}`, { method: 'DELETE' })

export const fetchSyncStatus = () => api<SyncStatusDTO>('/admin/sync/status')

export const fetchSyncRuns = () => api<{ items: SyncRunDTO[] }>('/admin/sync/runs?limit=20')

export const runSync = () =>
  api<{ runId: number; status: string; found: number; success: number; failed: number; linked: number; errorSummary: string | null }>(
    '/admin/sync',
    { method: 'POST' },
  )

export const pingGenieAcs = () =>
  api<{ ok: boolean; status?: number; error?: string }>('/admin/genieacs/ping')
