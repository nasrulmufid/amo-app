import type { Env } from '../../config/env'

export interface SyncRuntimeConfig {
  enabled: boolean
  intervalSeconds: number
  onlineThresholdSeconds: number
}

/** Resolve persisted sync overrides while safely falling back to validated environment defaults. */
export function resolveSyncRuntimeConfig(values: Record<string, unknown>, env: Env): SyncRuntimeConfig {
  const interval = values['sync.intervalSeconds']
  const threshold = values['sync.onlineThresholdSeconds']
  const enabled = values['sync.enabled']

  return {
    enabled: typeof enabled === 'boolean' ? enabled : true,
    intervalSeconds:
      typeof interval === 'number' && Number.isInteger(interval) && interval >= 5 && interval <= 86_400
        ? interval
        : env.GENIEACS_SYNC_INTERVAL_SECONDS,
    onlineThresholdSeconds:
      typeof threshold === 'number' && Number.isInteger(threshold) && threshold >= 30 && threshold <= 86_400
        ? threshold
        : env.ONLINE_THRESHOLD_SECONDS,
  }
}
