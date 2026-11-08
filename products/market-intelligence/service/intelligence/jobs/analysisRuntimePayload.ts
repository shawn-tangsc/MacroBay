import type { AnalysisChange } from '../analysis/eventGroupService'
import type { SignificanceSignal } from '../analysis/significanceChangeMatcher'

/**
 * 分析运行时读「外部塞进来的载荷」的那几个纯函数。
 *
 * 抽出来的理由只有一个：`registerMarketAnalysisRuntime.ts` 在体积门禁里已经是 671 行的基线文件，
 * 只能变小。这些函数不碰依赖、不藏状态，搬出来行为逐字不变。
 *
 * 共同的姿态是**读不懂就当没有**：载荷是别的模块塞过来的（作业参数、来源条目上的标签 JSON），
 * 一个坏字段不该把整次运行或整条分析变成失败。
 */

export function readSignificanceSignals(payload: unknown): readonly SignificanceSignal[] {
  const raw = (payload as { significanceSignals?: unknown } | null)?.significanceSignals
  if (typeof raw !== 'string' || raw.length === 0) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter(entry => entry && typeof entry === 'object' && typeof (entry as { eventKey?: unknown }).eventKey === 'string') as SignificanceSignal[] : []
  } catch { return [] }
}

export function readString(value: unknown, key: string): string | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const candidate = (value as Record<string, unknown>)[key]
  return typeof candidate === 'string' && candidate.length > 0 ? candidate : undefined
}

export function readCanonicalAsOf(value: unknown): string | undefined {
  const asOf = readString(value, 'asOf')
  if (!asOf) return undefined
  try { return new Date(asOf).toISOString() === asOf ? asOf : undefined } catch { return undefined }
}

export function safeJson(value: string | undefined): Record<string, unknown> {
  if (!value) return {}
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}
  } catch { return {} }
}

export function resolveDomain(value: unknown, sourceId: string): AnalysisChange['domain'] {
  if (value === 'macro' || value === 'capital' || value === 'sentiment' || value === 'funding' || value === 'cross-asset') return value
  if (sourceId.includes('funding')) return 'funding'
  if (sourceId.includes('stablecoin') || sourceId.includes('router')) return 'capital'
  return 'sentiment'
}

/** Same eligibility the anchor resolution uses; kept so the tick can answer "is there anything to analyse". */
export function hasEligibleAnalysisAnchor(item: { sourceTrust?: string; publishedAt?: string | null; processingLabelsJson?: string | null }): boolean {
  if (item.sourceTrust !== 'high' || !item.publishedAt) return false
  try {
    const labels = JSON.parse(item.processingLabelsJson ?? '{}')
    return labels.relevanceOutcome === 'full-intelligence' && labels.sentimentEligible === true
  } catch { return false }
}
