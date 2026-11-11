import type {
  InventoryCreateInput,
  InventoryDetailDTO,
  InventoryListItemDTO,
  InventoryMapPointDTO,
  InventoryUpdateInput,
  Paginated,
} from '@amo/shared'
import { api } from '@/lib/api'

/** Kunci cache React Query untuk inventaris. */
export const inventoryKeys = {
  all: ['inventory'] as const,
  list: (query: InventoryListParams) => ['inventory', 'list', query] as const,
  detail: (uuid: string) => ['inventory', 'detail', uuid] as const,
  map: ['inventory', 'map'] as const,
  facets: ['inventory', 'facets'] as const,
  acsUnlinked: ['inventory', 'acs-unlinked'] as const,
}

export interface InventoryListParams {
  page?: number
  pageSize?: number
  q?: string
  status?: string
  manufacturer?: string
  model?: string
  linked?: string
  sort?: string
  order?: string
}

function toQueryString(params: Record<string, unknown>): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue
    search.set(key, String(value))
  }
  const qs = search.toString()
  return qs ? `?${qs}` : ''
}

export const fetchInventory = (params: InventoryListParams) =>
  api<Paginated<InventoryListItemDTO>>(`/inventory${toQueryString({ ...params })}`)

export const fetchInventoryDetail = (uuid: string) => api<InventoryDetailDTO>(`/inventory/${uuid}`)

export const fetchInventoryMap = () =>
  api<{ items: InventoryMapPointDTO[]; withoutCoordinates: number }>('/inventory/map')

export const fetchInventoryFacets = () =>
  api<{ manufacturers: string[]; models: string[] }>('/inventory/facets')

/** Perangkat ACS (hasil sync) yang belum tertaut ke record inventaris. */
export interface AcsUnlinkedDevice {
  id: number
  genieacsDeviceId: string
  serialNumber: string | null
  manufacturer: string | null
  model: string | null
  onlineStatus: 'online' | 'offline' | 'unknown'
  lastInformAt: string | null
  lastSyncedAt: string | null
}

export const fetchAcsUnlinkedDevices = () =>
  api<{ items: AcsUnlinkedDevice[] }>('/inventory/acs-unlinked')

/** Buat inventaris draft langsung tertaut ke device ACS (dari panel belum tertaut). */
export const linkInventoryToDevice = (genieacsDeviceId: string, name: string) =>
  api<InventoryDetailDTO>('/inventory', {
    method: 'POST',
    body: { name, genieacsDeviceId },
  })

export const createInventory = (input: InventoryCreateInput) =>
  api<InventoryDetailDTO>('/inventory', { method: 'POST', body: input })

export const updateInventory = (uuid: string, input: InventoryUpdateInput) =>
  api<InventoryDetailDTO>(`/inventory/${uuid}`, { method: 'PATCH', body: input })

/** Hapus inventaris (soft-delete di server). Mengembalikan jumlah device ACS yang dilepas. */
export const deleteInventory = (uuid: string) =>
  api<{ uuid: string; unlinkedDevices: number }>(`/inventory/${uuid}`, { method: 'DELETE' })
