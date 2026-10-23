import type { CapitalConditionsRefreshResult } from './capitalConditionsRefreshService'

export const capitalConditionsSourcePolicy = Object.freeze({
  sourceId: 'defillama-stablecoins'
})

export function createCapitalConditionsSourceIntegration(deps: {
  refreshService: {
    refresh: () => Promise<CapitalConditionsRefreshResult>
    probe: () => Promise<Readonly<{ state: 'available' | 'unavailable' }>>
  }
  readHealth?: () => Promise<Readonly<{ status: 'healthy' | 'degraded'; lastSuccessAt?: string; consecutiveFailures: number }> | null>
}) {
  return {
    refresh() {
      return deps.refreshService.refresh()
    },
    async probe(): Promise<Readonly<{ ok: boolean }>> {
      try {
        return Object.freeze({ ok: (await deps.refreshService.probe()).state === 'available' })
      } catch {
        return Object.freeze({ ok: false })
      }
    },
    async getHealth(enabled: boolean): Promise<Readonly<{ runtimeStatus: 'healthy' | 'degraded' | 'paused'; lastSuccessAt?: string; consecutiveFailures: number }>> {
      if (!enabled) return Object.freeze({ runtimeStatus: 'paused' as const, consecutiveFailures: 0 })
      try {
        const health = await deps.readHealth?.()
        return health
          ? Object.freeze({ runtimeStatus: health.status, ...(health.lastSuccessAt ? { lastSuccessAt: health.lastSuccessAt } : {}), consecutiveFailures: health.consecutiveFailures })
          : Object.freeze({ runtimeStatus: 'healthy' as const, consecutiveFailures: 0 })
      } catch {
        return Object.freeze({ runtimeStatus: 'degraded' as const, consecutiveFailures: 0 })
      }
    }
  }
}
