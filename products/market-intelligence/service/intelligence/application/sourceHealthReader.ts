import type { IntelligenceSourceProfile } from '../schema/intelligenceSource'
import {
  resolveConnectivityStatus,
  sanitizeSafeView,
  toSafeHealthView,
  type SafeIntelligenceSourceHealthView
} from '../schema/intelligenceSourcesContracts'
import type { IntelligencePipeline } from './intelligencePipeline'

/** 健康读数对外就是这一种视图；服务里原先用 `Awaited<ReturnType<typeof readHealth>>` 推断。 */
export type SourceHealthView = SafeIntelligenceSourceHealthView

export type SourceHealthReaderDeps = Readonly<{
  pipeline: Pick<IntelligencePipeline, 'getHealth'>
  capitalConditions?: Readonly<{
    getHealth: (enabled: boolean) => Promise<Readonly<{
      runtimeStatus: 'healthy' | 'degraded' | 'paused'
      lastSuccessAt?: string
      consecutiveFailures: number
    }>>
  }>
}>

  /** 健康读数：一处读、两处用（事实表与详情）。传进来的 profile 由调用方读好，避免重复读盘。 */
export async function readHealth(
  deps: SourceHealthReaderDeps,
  sourceId: string,
  profile: IntelligenceSourceProfile
): Promise<SourceHealthView> {
    if (sourceId === 'defillama-stablecoins') {
      const health = await deps.capitalConditions?.getHealth(profile.enabled)
      if (health) {
        return toCapitalConditionsSafeHealthView(sourceId, health, profile.enabled)
      }
    }
    const pipelineHealth = deps.pipeline.getHealth(sourceId)
    return toSafeHealthView(sourceId, pipelineHealth, profile.enabled)
  }

function toCapitalConditionsSafeHealthView(
  sourceId: string,
  health: Readonly<{
    runtimeStatus: 'healthy' | 'degraded' | 'paused'
    lastSuccessAt?: string
    consecutiveFailures: number
  }>,
  enabled: boolean
): SafeIntelligenceSourceHealthView {
  const normalized = {
    sourceId,
    runtimeStatus: enabled ? health.runtimeStatus : ('paused' as const),
    ...(health.lastSuccessAt ? { lastSuccessAt: health.lastSuccessAt } : {}),
    consecutiveFailures: health.consecutiveFailures
  }

  return sanitizeSafeView({
    ...normalized,
    connectivityStatus: resolveConnectivityStatus(normalized, enabled)
  })
}
