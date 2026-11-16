import {
  MARKET_ANALYSIS_CONTRACT_POLICY,
  isMarketAnalysisCanonicalUtc,
  type MarketAnalysisContextAvailable,
  type SnapshotTrigger
} from '../../../contracts/marketAnalysisContracts'
import type { IntelligenceItem } from '../schema/intelligenceRecord'
import type { NewsSentimentRecord } from '../schema/newsSentiment'
import type { MarketIntelligencePublicQueryService } from '../public-query/publicQueryService'
import { analysisNewsSentimentPolicy, composeFactValue } from './analysisNewsSentimentEvidence'
import { marketAnalysisUnsafeOutputPolicy } from './analysisConstants'

/**
 * 触发这次运行的那条新闻，强制进快照（R37 §1）。
 *
 * 为什么不能只靠既有的舆情窗口（`appendAnalysisNewsSentiment`）：那条路只收非中性、且落在
 * 「上次生成到本次」窗口里的条目，窗口内还没有判定时它连事实都不会建（运行时事故就是这样：
 * 冻结 09:07:42、判定 09:07:50）。触发项必须**按条目身份**补进去。
 *
 * 形状按合并稿：标题 + 源摘录（`evidenceQuote`），不带正文、不带摘要、不带模型的 `why`
 * ——那不是转述未校验，就是拿模型自己的输出当证据。
 */
export const analysisTriggeredNewsPolicy = Object.freeze({
  /** 只强制一条：主触发。同组其它条目仍走窗口概览当上下文，不进指针。 */
  maximumItems: 1,
  /** 摘录额外追加进 value 的长度上限；源的 `evidenceQuote` 本身就限 ≤200 字。 */
  maximumQuoteCharacters: 200
})

export type TriggeredNewsOutcome =
  | Readonly<{ state: 'appended'; context: MarketAnalysisContextAvailable; trigger: SnapshotTrigger }>
  /** 调用方没有要求强制任何条目。 */
  | Readonly<{ state: 'none' }>
  /**
   * 建不出证据引用。按合并稿 fail-closed：冻结即失败，不跑模型、不发布一份没读过新闻的综述。
   * 摘录不合格**不**算这一档——那可以退到只写标题。
   */
  | Readonly<{ state: 'unavailable'; detail: 'news-trigger-evidence-missing' }>

export async function appendTriggeredNewsFact(
  context: MarketAnalysisContextAvailable,
  input: Readonly<{
    itemId: string
    items: readonly IntelligenceItem[]
    verdict: Pick<NewsSentimentRecord, 'polarity' | 'strength' | 'confidence' | 'symbols' | 'scoredAt'> & { evidenceQuote?: string } | undefined
    query: Pick<MarketIntelligencePublicQueryService, 'getEvidenceExcerpt'>
    listRevisions?: () => readonly { itemId: string; detectedAt: string }[]
  }>
): Promise<TriggeredNewsOutcome> {
  const item = input.items.find(candidate => candidate.itemId === input.itemId)
  // 没有条目、或没有判定：都算「建不出证据」。判定缺席时连「这条新闻被判成什么」都写不出来，
  // 补一条没有判断的新闻等于让模型自己猜它的方向，正是这次要治的病。
  if (!item || !input.verdict) return { state: 'unavailable', detail: 'news-trigger-evidence-missing' }
  if ((input.listRevisions?.() ?? []).some(revision => revision.itemId === input.itemId && revision.detectedAt > context.asOf)) {
    return { state: 'unavailable', detail: 'news-trigger-evidence-missing' }
  }
  let excerpt
  try {
    excerpt = await input.query.getEvidenceExcerpt({ itemId: input.itemId, asOf: context.asOf })
  } catch {
    return { state: 'unavailable', detail: 'news-trigger-evidence-missing' }
  }
  const ref = excerpt.evidenceRefs.find(candidate => candidate.itemId === input.itemId && candidate.evidenceRefId === excerpt.data.evidenceRef.evidenceRefId)
  const title = (excerpt.data.title ?? '').trim()
  if (!ref || !ref.excerptHash || !isMarketAnalysisCanonicalUtc(ref.visibleAt) || ref.visibleAt > context.asOf ||
    !ref.publishedAt || !isMarketAnalysisCanonicalUtc(ref.publishedAt) || ref.publishedAt > context.asOf || !title ||
    title.includes('[REDACTED]') || title.length > MARKET_ANALYSIS_CONTRACT_POLICY.maximumModelFieldCharacters ||
    marketAnalysisUnsafeOutputPolicy.prohibitedPatterns.some(pattern => pattern.test(title))) {
    return { state: 'unavailable', detail: 'news-trigger-evidence-missing' }
  }
  // 摘录要过与锚点新闻同一组安全判据；不过就退到只写标题——不因为摘录不合格丢掉这条事实，
  // 丢掉就退回今天的事故（触发项不在快照里）。
  const quote = safeQuote(input.verdict.evidenceQuote)
  const titleAsItem = { polarity: input.verdict.polarity, strength: input.verdict.strength, confidence: input.verdict.confidence, symbols: input.verdict.symbols, title }
  const factId = `triggered-news:${input.itemId}`
  const fact = {
    factId,
    domain: 'sentiment' as const,
    // 与窗口概览同一个 metric：`computeSnapshotChange` 只比非舆情事实，所以它永远不会被当成
    // 「市场数据动了什么」——合并稿要的正是这个，不需要新规则。
    metric: 'news-sentiment',
    // 没有标的就留空：焦点据此降级为 `reference-only`（只要求引用证据）。回落成 `'market'`
    // 会让 strict 模式要求正文出现这个英文词——中文结论永远满足不了，手动解读无标的新闻必败。
    subject: input.verdict.symbols.find(symbol => symbol === 'BTC' || symbol === 'ETH') ?? '',
    subjectLabel: title,
    value: composeFactValue(titleAsItem, quote),
    unit: null,
    sourceId: item.sourceId,
    sourceLabel: excerpt.data.evidenceRef.sourceId,
    // 与窗口事实同一套投影：观测时刻是评分时刻，它才是这条判断「何时可见」的依据。
    observedAt: input.verdict.scoredAt,
    asOf: context.asOf,
    freshness: (Date.parse(context.asOf) - Date.parse(input.verdict.scoredAt) <= analysisNewsSentimentPolicy.fallbackLookbackMs ? 'fresh' : 'stale') as 'fresh' | 'stale',
    confidence: Math.max(0, Math.min(1, input.verdict.confidence / 100)),
    comparability: 'not-comparable' as const,
    evidenceRefId: ref.evidenceRefId,
    ...(excerpt.data.sourceUrl ? { sourceUrl: excerpt.data.sourceUrl } : {})
  }
  const evidenceRefs = context.evidenceRefs.some(candidate => candidate.evidenceRefId === ref.evidenceRefId)
    ? context.evidenceRefs
    : [...context.evidenceRefs, {
      evidenceRefId: ref.evidenceRefId,
      sourceId: ref.sourceId,
      sourceLabel: ref.sourceId,
      itemId: input.itemId,
      occurredAt: ref.occurredAt ?? null,
      publishedAt: ref.publishedAt,
      detectedAt: ref.detectedAt ?? null,
      computedAt: ref.computedAt ?? null,
      visibleAt: ref.visibleAt,
      excerptHash: ref.excerptHash,
      ...(excerpt.data.sourceUrl ? { sourceUrl: excerpt.data.sourceUrl } : {})
    }]
  return {
    state: 'appended',
    context: { ...context, facts: [...context.facts.filter(existing => existing.factId !== factId), fact], evidenceRefs },
    trigger: { source: 'intelligence-item', itemId: input.itemId, factId, evidenceRefId: ref.evidenceRefId }
  }
}

/**
 * 冻结阶段用：返回「该冻进快照的上下文 + 指针」。建不出证据引用就抛出带 detail 的失败——
 * 不跑模型、不发布一份没读过新闻的综述。
 */
export async function triggeredNewsForFreeze(
  context: MarketAnalysisContextAvailable,
  input: Readonly<{
    triggeredItemId?: string
    items: readonly IntelligenceItem[]
    verdict: Parameters<typeof appendTriggeredNewsFact>[1]['verdict']
    query: Parameters<typeof appendTriggeredNewsFact>[1]['query']
    listRevisions?: () => readonly { itemId: string; detectedAt: string }[]
  }>
): Promise<Readonly<{ context: MarketAnalysisContextAvailable; trigger?: SnapshotTrigger }>> {
  if (!input.triggeredItemId) return { context }
  const outcome = await appendTriggeredNewsFact(context, {
    itemId: input.triggeredItemId,
    items: input.items,
    verdict: input.verdict,
    query: input.query,
    ...(input.listRevisions ? { listRevisions: input.listRevisions } : {})
  })
  if (outcome.state === 'unavailable') throw new Error('analysis-missing-evidence:news-trigger-evidence-missing')
  return outcome.state === 'appended' ? { context: outcome.context, trigger: outcome.trigger } : { context }
}

function safeQuote(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  if (!trimmed || trimmed.includes('[REDACTED]') || trimmed.length > analysisTriggeredNewsPolicy.maximumQuoteCharacters) return undefined
  return marketAnalysisUnsafeOutputPolicy.prohibitedPatterns.some(pattern => pattern.test(trimmed)) ? undefined : trimmed
}
