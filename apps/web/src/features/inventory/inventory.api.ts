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

export const createInventory = (input: InventoryCreateInput) =>
  api<InventoryDetailDTO>('/inventory', { method: 'POST', body: input })

export const updateInventory = (uuid: string, input: InventoryUpdateInput) =>
  api<InventoryDetailDTO>(`/inventory/${uuid}`, { method: 'PATCH', body: input })
