import { describe, expect, it } from 'vitest'

import type { MarketAnalysisContextAvailable } from '../../../contracts/marketAnalysisContracts'
import type { IntelligenceItem } from '../schema/intelligenceRecord'
import type { NewsSentimentRecord } from '../schema/newsSentiment'
import type { MarketIntelligencePublicQueryService } from '../public-query/publicQueryService'
import { appendTriggeredNewsFact } from './analysisTriggeredNewsFact'

const asOf = '2026-11-16T09:07:42.000Z'

const item: IntelligenceItem = {
  itemId: 'item-rss:guid:614afcd7',
  primaryRawRecordId: 'raw-1',
  canonicalDedupeKey: 'dedupe-1',
  sourceId: 'coindesk-rss',
  eventType: 'news',
  title: 'JPMorgan and DBS complete cross-border payment trial',
  summary: 'The banks said the tokenised deposit pilot has no direct market impact.',
  url: 'https://www.coindesk.com/x',
  sourceCategory: 'news',
  sourceTrust: 'high',
  publishedAt: '2026-11-16T08:46:00.000Z',
  detectedAt: '2026-11-16T08:47:00.000Z',
  severityHint: 'info',
  timelineStatus: 'evaluated',
  normalizerVersion: 'v1'
}

const verdict: NewsSentimentRecord = {
  itemId: item.itemId,
  sourceId: 'coindesk-rss',
  publishedAt: '2026-11-16T08:46:00.000Z',
  scoredAt: '2026-11-16T09:07:50.718Z',
  polarity: 'bearish',
  strength: 3,
  confidence: 80,
  symbols: ['BTC'],
  reasonCode: 'etf-outflow',
  evidenceQuote: 'cross-border payment pilot with no direct crypto impact',
  engine: 'model',
  caveats: []
}

const context: MarketAnalysisContextAvailable = {
  state: 'available', eventGroupId: 'mi-eg-1', asOf, dataCutoff: asOf, profileId: 'crypto-market-analysis-v1',
  facts: [], missingDomains: [], caveats: [], evidenceRefs: [], sourceHealth: [], domainAccess: []
} as never

function queryReturning(overrides: Record<string, unknown> = {}, refOverrides: Record<string, unknown> = {}) {
  return {
    getEvidenceExcerpt: async () => ({
      schemaVersion: 1, queryId: 'q', queryType: 'evidence-excerpt', asOf, confidence: 0.8, caveats: [], sourceCoverage: [],
      evidenceRefs: [{
        evidenceRefId: 'news:item-rss:guid:614afcd7', itemId: item.itemId, sourceId: 'coindesk-rss',
        excerptHash: 'hash-1', visibleAt: '2026-11-16T08:47:00.000Z', publishedAt: '2026-11-16T08:46:00.000Z',
        detectedAt: '2026-11-16T08:47:00.000Z', occurredAt: '2026-11-16T08:46:00.000Z', computedAt: null, ...refOverrides
      }],
      data: { evidenceRef: { evidenceRefId: 'news:item-rss:guid:614afcd7' }, title: item.title, excerpt: 'body', sourceUrl: item.url, ...overrides }
    })
  } as unknown as Pick<MarketIntelligencePublicQueryService, 'getEvidenceExcerpt'>
}

describe('触发项作为强制事实进快照（R37 §1）', () => {
  it('标题 + 源摘录，指标与窗口舆情同一个 metric，指针指向它', async () => {
    const outcome = await appendTriggeredNewsFact(context, {
      itemId: item.itemId, items: [item], verdict, query: queryReturning()
    })
    if (outcome.state !== 'appended') throw new Error(`expected appended, got ${outcome.state}`)
    const fact = outcome.context.facts.find(candidate => candidate.factId === `triggered-news:${item.itemId}`)!
    // 同一个 metric 是设计的一部分：变化记录只比非舆情事实，所以它永远不会被当成「市场数据变了」。
    expect(fact.metric).toBe('news-sentiment')
    expect(fact.domain).toBe('sentiment')
    expect(fact.subject).toBe('BTC')
    expect(fact.value).toContain(item.title)
    expect(fact.value).toContain(verdict.evidenceQuote!)
    expect(fact.observedAt).toBe(verdict.scoredAt)
    expect(fact.evidenceRefId).toBe('news:item-rss:guid:614afcd7')
    expect(outcome.context.evidenceRefs.map(ref => ref.evidenceRefId)).toContain('news:item-rss:guid:614afcd7')
    expect(outcome.trigger).toEqual({
      source: 'intelligence-item', itemId: item.itemId,
      factId: `triggered-news:${item.itemId}`, evidenceRefId: 'news:item-rss:guid:614afcd7'
    })
    // 不带正文、不带摘要：事实里只有「判定 + 标题 + 摘录」。
    expect(JSON.stringify(fact)).not.toContain('tokenised deposit pilot has no direct market impact')
  })

  it('没有标的时 subject 留空，让焦点降级为只查引用', async () => {
    // 回落成 'market' 会让 strict 模式要求正文出现这个英文词：中文结论永远满足不了，
    // 手动解读一条无标的新闻（那条 JPMorgan）就会「点了必失败」。
    const outcome = await appendTriggeredNewsFact(context, {
      itemId: item.itemId, items: [item], verdict: { ...verdict, symbols: [] }, query: queryReturning()
    })
    if (outcome.state !== 'appended') throw new Error('expected appended')
    const fact = outcome.context.facts[0]!
    expect(fact.subject).toBe('')
    expect(fact.subjectLabel).toBe(item.title)
  })

  it('摘录与标题相同只写一遍（规则引擎的摘录就是标题截断）', async () => {
    const outcome = await appendTriggeredNewsFact(context, {
      itemId: item.itemId, items: [item], verdict: { ...verdict, evidenceQuote: item.title }, query: queryReturning()
    })
    if (outcome.state !== 'appended') throw new Error('expected appended')
    const value = outcome.context.facts[0]!.value as string
    expect(value.split(item.title).length - 1).toBe(1)
  })

  it('摘录不合格只退到标题，不丢这条事实', async () => {
    const outcome = await appendTriggeredNewsFact(context, {
      itemId: item.itemId, items: [item], verdict: { ...verdict, evidenceQuote: '[REDACTED] quote' }, query: queryReturning()
    })
    if (outcome.state !== 'appended') throw new Error('expected appended')
    const value = outcome.context.facts[0]!.value as string
    expect(value).toContain(item.title)
    expect(value).not.toContain('[REDACTED]')
  })

  it('建不出证据引用就 fail-closed：不写事实、报可判的 detail', async () => {
    const cases = [
      appendTriggeredNewsFact(context, { itemId: item.itemId, items: [item], verdict: undefined, query: queryReturning() }),
      appendTriggeredNewsFact(context, { itemId: item.itemId, items: [], verdict, query: queryReturning() }),
      appendTriggeredNewsFact(context, { itemId: item.itemId, items: [item], verdict, query: queryReturning({}, { visibleAt: '2026-11-16T10:00:00.000Z' }) }),
      appendTriggeredNewsFact(context, { itemId: item.itemId, items: [item], verdict, query: queryReturning({ title: '[REDACTED]' }) }),
      appendTriggeredNewsFact(context, {
        itemId: item.itemId, items: [item], verdict,
        query: { getEvidenceExcerpt: async () => { throw new Error('read-failed') } } as never
      })
    ]
    for (const outcome of await Promise.all(cases)) {
      expect(outcome).toEqual({ state: 'unavailable', detail: 'news-trigger-evidence-missing' })
    }
  })
})
