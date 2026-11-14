import type { AgentFact, SourceHealthFlag } from '../../../contracts/marketAnalysisContracts'
import type {
  MarketIntelligenceQueryResult,
  SourceCoverageAsOf,
  SourceHealthData
} from './queryContracts'
import type { MarketIntelligencePublicQueryService as PublicQueryService } from './publicQueryService'

/**
 * 上下文装配用的公共小工具：安全读取、信封守卫、来源健康标记、证据哈希、字节数。
 *
 * 从 `marketAnalysisContextProjection` 抽出来（那个文件越过 500 行软上限）：这里没有一个投影
 * 规则，只有「读失败怎么答」「这个形状认不认」「同一份证据怎么取哈希」这类与业务无关的判断，
 * 事实投影与上下文构造共用它们。
 */

export async function safeQuery<T>(query: () => Promise<T>): Promise<T | undefined> {
  try { return await query() } catch { return undefined }
}

export async function safeSourceHealth(service: Pick<PublicQueryService, 'getSourceHealth'>, asOf: string): Promise<MarketIntelligenceQueryResult<SourceHealthData> | undefined> {
  const result = await safeQuery(() => service.getSourceHealth({ asOf }))
  return isEnvelope(result) && isSourceHealthData(result.data) ? result as MarketIntelligenceQueryResult<SourceHealthData> : undefined
}

export function hashSafeEvidenceIdentity(value: unknown): string {
  let serialized = ''
  try { serialized = JSON.stringify(value) } catch { serialized = 'unavailable' }
  let hash = 2166136261
  for (let index = 0; index < serialized.length; index += 1) hash = Math.imul(hash ^ serialized.charCodeAt(index), 16777619)
  return (hash >>> 0).toString(16).padStart(8, '0')
}

export function compareObservedAt(left: AgentFact, right: AgentFact): number {
  return (right.observedAt ?? '').localeCompare(left.observedAt ?? '')
}

export function isEnvelope(value: unknown): value is MarketIntelligenceQueryResult<unknown> {
  try { return !!value && typeof value === 'object' && 'data' in value && 'evidenceRefs' in value } catch { return false }
}

export function isSourceHealthData(value: unknown): value is SourceHealthData {
  try { return !!value && typeof value === 'object' && Array.isArray((value as { sources?: unknown }).sources) } catch { return false }
}

export function toSourceHealthFlag(source: SourceCoverageAsOf, asOf: string): SourceHealthFlag {
  const status = source.productionState === 'failed' ? 'failed' : source.productionState === 'stale' ? 'degraded' : source.productionState === 'disabled' || source.productionState === 'fixture-only' || source.productionState === 'planned' ? 'paused' : source.productionState === 'fresh' ? 'healthy' : 'degraded'
  return { sourceId: source.sourceId, status, asOf }
}

export function utf8JsonBytes(value: unknown): number {
  try { return new TextEncoder().encode(JSON.stringify(value)).byteLength } catch { return Number.POSITIVE_INFINITY }
}
