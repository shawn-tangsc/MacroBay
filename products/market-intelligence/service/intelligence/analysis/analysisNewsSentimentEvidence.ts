import {
  MARKET_ANALYSIS_CONTEXT_CAVEATS,
  MARKET_ANALYSIS_CONTRACT_POLICY,
  type EventGroup,
  type MarketAnalysisContextAvailable
} from '../../../contracts/marketAnalysisContracts'
import type { MarketIntelligencePublicQueryService } from '../public-query/publicQueryService'
import type { NewsSentimentQuery } from '../schema/newsSentiment'
import type { NewsSentimentView } from '../news-sentiment/newsSentimentQuery'
import { appendAnalysisEventEvidence } from './analysisEventEvidence'

/**
 * 重点舆情进入自动分析。
 *
 * 读者在「Key sentiment」里看的就是这份列表，但冻结快照过去只带恐惧贪婪指数和事件锚点的
 * 一条新闻摘要，模型看不到当天真正的舆情。这里把**上次生成开始到现在**新增的非中性舆情
 * 作为 `sentiment` 域事实写进快照：窗口从上次分析开始，所以相邻两次结论不会重复同一条新闻；
 * 中性条目被过滤（它们多数不改变判断）；每条都通过 `appendAnalysisEventEvidence` 的同一套
 * 可见性与脱敏校验，带上可引用的 evidenceRef。
 */
export const analysisNewsSentimentPolicy = Object.freeze({
  maximumItems: 20,
  /** 首次分析（或读不到上次生成时间）时回看的窗口。 */
  fallbackLookbackMs: 24 * 60 * 60 * 1_000,
  /** 长时间没有分析也不能一次灌进无限历史；行情事实本身也只覆盖有限窗口。 */
  maximumLookbackMs: 7 * 24 * 60 * 60 * 1_000,
  defaultWindow: '24h' as const
})

export type AnalysisNewsSentimentQuery = Readonly<{
  query: (input: NewsSentimentQuery) => Promise<NewsSentimentView>
}>

const polarityLabel: Readonly<Record<string, string>> = Object.freeze({
  bullish: '看多', bearish: '看空', mixed: '多空混合'
})

export type NewsSentimentWindowResolution = Readonly<{
  sinceMs: number
  window: NewsSentimentQuery['window']
}>

/**
 * The query window only comes in fixed sizes, so the smallest one covering `since` is asked for
 * and the exact boundary is enforced afterwards by `publishedAt > since`.
 */
export function resolveNewsSentimentWindow(asOf: string, since: string | undefined): NewsSentimentWindowResolution {
  const asOfMs = Date.parse(asOf)
  const sinceMs = since ? Date.parse(since) : Number.NaN
  const start = Number.isFinite(sinceMs) && sinceMs < asOfMs
    ? Math.max(sinceMs, asOfMs - analysisNewsSentimentPolicy.maximumLookbackMs)
    : asOfMs - analysisNewsSentimentPolicy.fallbackLookbackMs
  const span = asOfMs - start
  const window: NewsSentimentQuery['window'] = span <= 60 * 60 * 1_000 ? '1h'
    : span <= 4 * 60 * 60 * 1_000 ? '4h'
      : span <= 24 * 60 * 60 * 1_000 ? '24h'
        : '7d'
  return { sinceMs: start, window }
}

export type AppendNewsSentimentInput = Readonly<{
  asOf: string
  /** 上一次分析的开始时间；缺省时回看 24 小时。 */
  since?: string
}>

/**
 * Appends the key sentiment as citable facts.
 *
 * Reuses the event-evidence path on purpose: the visibility, redaction, revision and excerpt-hash
 * rules must be the same ones the anchor news already goes through. Those facts are then re-labelled
 * as `news-sentiment` with the scored polarity and strength, which is what the model needs to weigh
 * them; the underlying evidence ref keeps the excerpt for audit.
 */
export async function appendAnalysisNewsSentiment(
  context: MarketAnalysisContextAvailable,
  query: Pick<MarketIntelligencePublicQueryService, 'getEvidenceExcerpt'>,
  reader: AnalysisNewsSentimentQuery | undefined,
  input: AppendNewsSentimentInput
): Promise<MarketAnalysisContextAvailable> {
  if (!reader) return withCaveat(context, MARKET_ANALYSIS_CONTEXT_CAVEATS.newsSentimentUnavailable)

  const { sinceMs, window } = resolveNewsSentimentWindow(input.asOf, input.since)
  let view: NewsSentimentView
  try {
    view = await reader.query({ asOf: input.asOf, window, scope: 'market', direction: 'all', limit: 100 })
  } catch {
    return withCaveat(context, MARKET_ANALYSIS_CONTEXT_CAVEATS.newsSentimentUnavailable)
  }
  if (view.state !== 'available') {
    // An empty or unavailable window carries no new 舆情: an empty window is normal between two
    // analyses, an unavailable store is the only case the reader is told about.
    return view.state === 'unavailable'
      ? withCaveat(context, MARKET_ANALYSIS_CONTEXT_CAVEATS.newsSentimentUnavailable)
      : context
  }

  const asOfMs = Date.parse(input.asOf)
  const selected = view.items
    .filter(item => item.polarity !== 'neutral')
    .filter(item => {
      const publishedAt = Date.parse(item.publishedAt)
      return Number.isFinite(publishedAt) && publishedAt > sinceMs && publishedAt <= asOfMs
    })
    .sort((left, right) => right.publishedAt.localeCompare(left.publishedAt))
    .slice(0, analysisNewsSentimentPolicy.maximumItems)
  if (selected.length === 0) return context

  const before = new Set(context.facts.map(fact => fact.factId))
  const withEvidence = await appendAnalysisEventEvidence(
    context,
    { eventRefs: selected.map(item => item.itemId), groupType: 'sentiment' } satisfies Pick<EventGroup, 'eventRefs' | 'groupType'>,
    query
  )
  const byItemId = new Map(selected.map(item => [item.itemId, item]))
  const facts = withEvidence.facts.map(fact => {
    if (before.has(fact.factId) || fact.metric !== 'event-excerpt' || !fact.subject) return fact
    const item = byItemId.get(fact.subject)
    if (!item) return fact
    return {
      ...fact,
      metric: 'news-sentiment',
      value: composeFactValue(item),
      // A news item can explain a judgement but never a market reaction: `isMarketReactionFact`
      // reads these two fields, so the analysis cannot claim a price move from a headline.
      freshness: asOfMs - Date.parse(item.publishedAt) <= analysisNewsSentimentPolicy.fallbackLookbackMs ? 'fresh' as const : 'stale' as const,
      confidence: Math.max(0, Math.min(1, item.confidence / 100)),
      comparability: 'not-comparable' as const
    }
  })
  return { ...withEvidence, facts }
}

function composeFactValue(item: NewsSentimentView['items'][number]): string {
  const title = item.displayTitle ?? item.title
  const label = polarityLabel[item.polarity] ?? item.polarity
  return `${label}（强度 ${item.strength}/5，置信 ${Math.round(item.confidence)}%）｜${title.slice(0, MARKET_ANALYSIS_CONTRACT_POLICY.maximumModelFieldCharacters)}`
}

function withCaveat(context: MarketAnalysisContextAvailable, caveat: string): MarketAnalysisContextAvailable {
  return context.caveats.includes(caveat) ? context : { ...context, caveats: [...context.caveats, caveat] }
}
