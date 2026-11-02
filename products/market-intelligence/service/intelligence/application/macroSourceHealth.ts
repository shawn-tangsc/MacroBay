import { isMacroSourceId, macroAdapterConfigForSource } from './macroSourceCatalogMetadata'
import type { IntelligenceSourceDefinition } from '../schema/intelligenceSource'

/** 没有按来源配置新鲜度时用的缺省窗口（6 小时）：来源覆盖视图与来源通知共用这一个值。 */
export const DEFAULT_SOURCE_FRESHNESS_MS = 6 * 60 * 60 * 1000

export function resolveMacroFreshnessWindowMs(
  sourceId: string,
  adapterConfig: Record<string, unknown> = {}
): number | undefined {
  if (!isMacroSourceId(sourceId)) return undefined
  const configured = Number(adapterConfig.freshnessWindowMs)
  if (Number.isFinite(configured) && configured > 0) return configured
  return macroAdapterConfigForSource(sourceId).freshnessWindowMs
}

export function isSourceStaleAsOf(input: {
  sourceId: string
  adapterConfig?: Record<string, unknown>
  lastSuccessAt?: string
  asOf: string
  defaultFreshnessMs: number
}): boolean {
  const freshnessMs = resolveMacroFreshnessWindowMs(input.sourceId, input.adapterConfig) ?? input.defaultFreshnessMs
  if (!input.lastSuccessAt) return true
  return Date.parse(input.asOf) - Date.parse(input.lastSuccessAt) > freshnessMs
}

export function readMacroReleaseCadence(
  definition: IntelligenceSourceDefinition
): 'daily' | 'weekly' | 'monthly' | 'quarterly' | undefined {
  if (!isMacroSourceId(definition.sourceId)) return undefined
  const cadence = definition.adapterConfig.releaseCadence
  return typeof cadence === 'string' ? (cadence as 'daily' | 'weekly' | 'monthly' | 'quarterly') : undefined
}
