import type { DashboardSummaryDTO } from '@amo/shared'
import { api } from '@/lib/api'

export const dashboardKeys = { summary: ['dashboard', 'summary'] as const }
export const fetchDashboardSummary = () => api<DashboardSummaryDTO>('/dashboard/summary')
