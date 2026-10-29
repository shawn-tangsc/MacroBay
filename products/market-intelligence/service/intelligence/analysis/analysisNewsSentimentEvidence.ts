import {
  MARKET_ANALYSIS_CONTEXT_CAVEATS,
  MARKET_ANALYSIS_CONTRACT_POLICY,
  type AnalysisRun,
  type EventGroup,
  type MarketAnalysisContextAvailable
} from '../../../contracts/marketAnalysisContracts'
import type { MarketIntelligencePublicQueryService } from '../public-query/publicQueryService'
import type { NewsSentimentQuery } from '../schema/newsSentiment'
import type { NewsSentimentView } from '../news-sentiment/newsSentimentQuery'
import { appendAnalysisEventEvidence } from './analysisEventEvidence'
import { slotInstantsWithin } from './analysisSlotCoverage'

/**
 * 重点舆情进入自动分析。
 *
 * 读者在「Key sentiment」里看的就是这份列表，但冻结快照过去只带恐惧贪婪指数和事件锚点的
 * 一条新闻摘要，模型看不到当天真正的舆情。这里把**上次生成开始到现在**新增的非中性舆情
 * 作为 `sentiment` 域事实写进快照：窗口从上次分析开始，所以相邻两次结论不会重复同一条新闻；
 * 中性条目被过滤（它们多数不改变判断）；每条都通过 `appendAnalysisEventEvidence` 的同一套
 * 可见性与脱敏校验，带上可引用的 evidenceRef。
 *
 * 窗口起点还有一条硬下界：**理论上的上一次盘口**。分析按 08:00 / 16:00 / 24:00 三档执行，
 * 最大跨度 8 小时；即使应用关了几天、上次真正发布是三天前，舆情也不能向更早回溯——那一段
 * 本来就该由已经错过的分析负责，而不是堆进这一次结论。
 */
export const analysisNewsSentimentPolicy = Object.freeze({
  maximumItems: 20,
  /** 盘口解析失败时的兜底跨度：与三档盘口的最大间隔一致。 */
  fallbackLookbackMs: 8 * 60 * 60 * 1_000
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
 * The window start: the later of the previous generation and the previous session slot.
 *
 * The slot floor is the "theoretical" cadence, not the actual one: an app that was closed for
 * three days must not pour three days of news into one conclusion. If `since` is even later (a
 * manual refresh minutes ago) it wins, so the same headline never enters two analyses.
 */
export function resolveNewsSentimentWindow(asOf: string, since: string | undefined): NewsSentimentWindowResolution {
  const asOfMs = Date.parse(asOf)
  const floorMs = previousSessionSlotMs(asOfMs)
  const sinceMs = since ? Date.parse(since) : Number.NaN
  const start = Math.min(
    asOfMs,
    Number.isFinite(floorMs)
      ? Math.max(Number.isFinite(sinceMs) ? sinceMs : floorMs, floorMs)
      : asOfMs - analysisNewsSentimentPolicy.fallbackLookbackMs
  )
  const span = asOfMs - start
  const window: NewsSentimentQuery['window'] = span <= 60 * 60 * 1_000 ? '1h'
    : span <= 4 * 60 * 60 * 1_000 ? '4h'
      : span <= 24 * 60 * 60 * 1_000 ? '24h'
        : '7d'
  return { sinceMs: start, window }
}

/**
 * The most recent session slot strictly before `asOf`.
 *
 * Strictly before: a run serving the 16:00 open must look back to 08:00, not to the instant it is
 * already standing on (which would leave it with an empty news window).
 */
function previousSessionSlotMs(asOfMs: number): number {
  if (!Number.isFinite(asOfMs)) return Number.NaN
  const instants = slotInstantsWithin(new Date(asOfMs))
  for (let index = instants.length - 1; index >= 0; index -= 1) {
    if (instants[index]!.atMs < asOfMs) return instants[index]!.atMs
  }
  return Number.NaN
}

export type AppendNewsSentimentInput = Readonly<{
  asOf: string
  /** 上一次分析开始的时间；缺省（或早于理论盘口）时由盘口下界决定。 */
  since?: string
}>

/**
 * The run start the sentiment window should continue from.
 *
 * The latest *published* run wins regardless of which event group it belonged to: the reader's
 * complaint was that the same news was analysed twice. A failed or still-running run must not move
 * the boundary, and with no published run the previous snapshot of this group is the best boundary;
 * the session-slot floor in `resolveNewsSentimentWindow` still caps how far back it may reach.
 */
export function newsSentimentSince(
  runs: readonly Pick<AnalysisRun, 'status' | 'startedAt' | 'queuedAt' | 'completedAt'>[],
  previousSnapshotAsOf?: string
): string | undefined {
  const published = runs
    .filter(run => run.status === 'succeeded')
    .sort((left, right) => (right.completedAt ?? right.queuedAt).localeCompare(left.completedAt ?? left.queuedAt))[0]
  return published?.startedAt ?? published?.queuedAt ?? previousSnapshotAsOf
}

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
  input: AppendNewsSentimentInput,
  /**
   * The same revision guard the anchor path uses: an item revised after the cutoff may still be
   * "visible as of", but its current title is not what the analysis was written against.
   */
  listRevisions?: () => readonly { itemId: string; detectedAt: string }[]
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
    query,
    listRevisions
  )
  const byItemId = new Map(selected.map(item => [item.itemId, item]))
  const facts = withEvidence.facts.map(fact => {
    if (before.has(fact.factId) || fact.metric !== 'event-excerpt' || !fact.subject) return fact
    const item = byItemId.get(fact.subject)
    if (!item) return fact
    return {
      ...fact,
      metric: 'news-sentiment',
      // `appendAnalysisEventEvidence` keys the subject by the pipeline item id, which the model
      // must never read. A sentiment row is about an asset or the market, which is what the
      // readable vocabulary already has words for.
      subject: sentimentSubject(item),
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

/** The asset a headline is about, or the market when it names none of the two we track. */
function sentimentSubject(item: NewsSentimentView['items'][number]): string {
  return item.symbols.find(symbol => symbol === 'BTC' || symbol === 'ETH') ?? 'market'
}

function withCaveat(context: MarketAnalysisContextAvailable, caveat: string): MarketAnalysisContextAvailable {
  return context.caveats.includes(caveat) ? context : { ...context, caveats: [...context.caveats, caveat] }
}
