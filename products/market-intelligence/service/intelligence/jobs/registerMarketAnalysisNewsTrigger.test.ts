import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import type { JobHandler, JobRuntime } from '@platform/jobs'
import type { IntelligenceItem } from '../schema/intelligenceRecord'
import type { IntelligencePipeline } from '../application/intelligencePipeline'
import type { MarketIntelligencePublicQueryService } from '../public-query/publicQueryService'
import type { NewsSentimentVerdict } from '../analysis/analysisItemSeverity'
import { FREEZE_MARKET_ANALYSIS_SNAPSHOT_JOB, GROUP_MARKET_ANALYSIS_CHANGE_JOB } from './marketAnalysisJobIds'
import { registerMarketAnalysisRuntime } from './registerMarketAnalysisRuntime'

const asOf = '2026-11-16T09:07:42.000Z'
const publishedAt = '2026-11-16T08:46:00.000Z'

const verdictRecord = (value: NewsSentimentVerdict) => ({
  itemId: 'item-rss:guid:614afcd7', sourceId: 'coindesk-rss', publishedAt,
  scoredAt: '2026-11-16T09:07:50.718Z', confidence: 88, reasonCode: 'no-direct-crypto-impact',
  engine: 'model' as const, caveats: [] as string[], ...value, symbols: [...value.symbols]
})
const neutralNoSymbol: NewsSentimentVerdict = { polarity: 'neutral', strength: 1, symbols: [] }
const directionalBitcoin: NewsSentimentVerdict = { polarity: 'bearish', strength: 3, symbols: ['BTC'] }

const newsItem: IntelligenceItem = {
  itemId: 'item-rss:guid:614afcd7',
  primaryRawRecordId: 'raw-1',
  canonicalDedupeKey: 'dedupe-1',
  sourceId: 'coindesk-rss',
  eventType: 'news',
  title: 'JPMorgan and DBS complete cross-border payment trial',
  sourceCategory: 'news',
  sourceTrust: 'high',
  publishedAt,
  detectedAt: publishedAt,
  severityHint: 'info',
  timelineStatus: 'evaluated',
  normalizerVersion: 'v1',
  processingLabelsJson: JSON.stringify({ dataDomain: 'sentiment', relevanceOutcome: 'full-intelligence', sentimentEligible: true })
}

const context = {
  jobRunId: 'news-trigger', signal: new AbortController().signal,
  log: async () => undefined, progress: async () => undefined
}

async function withRuntime<T>(input: {
  item?: IntelligenceItem
  verdict?: NewsSentimentVerdict
}, drive: (ctx: {
  runtime: ReturnType<typeof registerMarketAnalysisRuntime>
  handlers: Map<string, JobHandler>
  enqueued: { handlerId?: string }[]
}) => Promise<T>): Promise<T> {
  const dataDir = await mkdtemp(join(tmpdir(), 'mi-analysis-news-trigger-'))
  const handlers = new Map<string, JobHandler>()
  const enqueued: { handlerId?: string }[] = []
  const jobRuntime = {
    registerHandler: (id: string, handler: JobHandler) => { handlers.set(id, handler) },
    enqueueDefinition: async (definition: { handlerId?: string }) => {
      enqueued.push(definition)
      return { id: 'next-stage' }
    }
  } as unknown as JobRuntime
  const runtime = registerMarketAnalysisRuntime({
    jobRuntime,
    pipeline: { listItems: () => (input.item ? [input.item] : []), listRevisions: () => [] } as unknown as IntelligencePipeline,
    publicQueryService: {} as MarketIntelligencePublicQueryService,
    structuredModelInvocation: { invoke: async () => { throw new Error('分组阶段不得调用模型') } },
    ...(input.verdict ? { latestNewsSentiment: () => verdictRecord(input.verdict!) } : {}),
    dataDir,
    now: () => asOf
  })
  try {
    return await drive({ runtime, handlers, enqueued })
  } finally {
    runtime.dispose()
    await rm(dataDir, { recursive: true, force: true })
  }
}

describe('新闻条目不再进入自动分析触发路径（R39）', () => {
  it('有 BTC 标的、非中性、strength 3 的新闻：0 次分析运行、0 条时间轴、0 条触发账本', async () => {
    const outcome = await withRuntime({ item: newsItem, verdict: directionalBitcoin }, async ({ runtime, handlers, enqueued }) => {
      await handlers.get(GROUP_MARKET_ANALYSIS_CHANGE_JOB)!({ changeId: newsItem.itemId, eventRef: newsItem.itemId }, context as never)
      const groups = runtime.repository.listEventGroups()
      return {
        groups,
        ledger: groups.flatMap(group => runtime.repository.listTriggerLedger(group.id)),
        runs: runtime.repository.listRuns(),
        timeline: runtime.repository.listTimeline({ eventGroupId: groups[0]?.id }),
        enqueued
      }
    })
    expect(outcome.groups).toEqual([])
    expect(outcome.ledger).toEqual([])
    expect(outcome.runs).toEqual([])
    expect(outcome.timeline.items).toEqual([])
    expect(outcome.enqueued.filter(definition => definition.handlerId === FREEZE_MARKET_ANALYSIS_SNAPSHOT_JOB)).toEqual([])
  })

  it('a non-news item classified as sentiment does not auto-analyze either', async () => {
    // `github-releases` 这类 generics 条目被判成 sentiment/high：今天没有抽屉入口、也建不出
    // 触发事实，自动路径同样一次都不该跑（03 文档 §3 的「不可达分支」）。
    const genericItem: IntelligenceItem = {
      ...newsItem, itemId: 'item-generic', sourceId: 'github-releases', eventType: 'release',
      processingLabelsJson: JSON.stringify({ dataDomain: 'sentiment', relevanceOutcome: 'full-intelligence', sentimentEligible: true })
    }
    const outcome = await withRuntime({ item: genericItem }, async ({ runtime, handlers, enqueued }) => {
      await handlers.get(GROUP_MARKET_ANALYSIS_CHANGE_JOB)!({ changeId: genericItem.itemId, eventRef: genericItem.itemId }, context as never)
      const groups = runtime.repository.listEventGroups()
      return { groups, ledger: groups.flatMap(group => runtime.repository.listTriggerLedger(group.id)), runs: runtime.repository.listRuns(), enqueued }
    })
    expect(outcome.groups).toEqual([])
    expect(outcome.ledger).toEqual([])
    expect(outcome.runs).toEqual([])
    expect(outcome.enqueued).toEqual([])
  })

  it('中性、无标的的新闻同样零次运行（不再写「跳过」账本行）', async () => {
    const outcome = await withRuntime({ item: newsItem, verdict: neutralNoSymbol }, async ({ runtime, handlers, enqueued }) => {
      await handlers.get(GROUP_MARKET_ANALYSIS_CHANGE_JOB)!({ changeId: newsItem.itemId, eventRef: newsItem.itemId }, context as never)
      return { groups: runtime.repository.listEventGroups(), runs: runtime.repository.listRuns(), enqueued }
    })
    expect(outcome.groups).toEqual([])
    expect(outcome.runs).toEqual([])
    expect(outcome.enqueued).toEqual([])
  })

  it('判定还没写下来时也什么都不做', async () => {
    const outcome = await withRuntime({ item: newsItem }, async ({ runtime, handlers, enqueued }) => {
      await handlers.get(GROUP_MARKET_ANALYSIS_CHANGE_JOB)!({ changeId: newsItem.itemId, eventRef: newsItem.itemId }, context as never)
      return { groups: runtime.repository.listEventGroups(), runs: runtime.repository.listRuns(), enqueued }
    })
    expect(outcome.groups).toEqual([])
    expect(outcome.runs).toEqual([])
    expect(outcome.enqueued).toEqual([])
  })

  it('旧的自动新闻冻结作业（带 triggeredItemId、没有 analysisKind）不许产出市场运行', async () => {
    const outcome = await withRuntime({ item: newsItem }, async ({ runtime, handlers, enqueued }) => {
      await handlers.get(FREEZE_MARKET_ANALYSIS_SNAPSHOT_JOB)!({
        eventGroupId: 'mi-eg-legacy-news', triggerKey: 'manual.initial', analysisPhase: 'initial', asOf,
        triggeredItemId: newsItem.itemId
      }, context as never)
      return { runs: runtime.repository.listRuns(), enqueued }
    })
    expect(outcome.runs).toEqual([])
    expect(outcome.enqueued).toEqual([])
  })

  it('does not enqueue a change job for a sentiment item at the event consumer', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'mi-analysis-sentiment-consumer-'))
    const handlers = new Map<string, JobHandler>()
    const enqueued: { handlerId?: string; payload?: unknown }[] = []
    let consumer: ((event: unknown) => Promise<void>) | undefined
    const jobRuntime = {
      registerHandler: (id: string, handler: JobHandler) => { handlers.set(id, handler) },
      enqueueDefinition: async (definition: { handlerId?: string; payload?: unknown }) => { enqueued.push(definition); return { id: 'next-stage' } },
      listRuns: () => [], enqueueStartup: async (id: string) => ({ id })
    } as unknown as JobRuntime
    const items: IntelligenceItem[] = [
      { ...newsItem, itemId: 'item-message', sourceId: 'alternative-fear-greed', eventType: 'metric' },
      { ...newsItem, itemId: 'item-macro', eventType: 'metric', processingLabelsJson: JSON.stringify({ dataDomain: 'macro', relevanceOutcome: 'full-intelligence', sentimentEligible: true }) }
    ]
    const runtime = registerMarketAnalysisRuntime({
      jobRuntime,
      eventBusRuntime: {
        registerConsumer: (_config: unknown, handler: (event: unknown) => Promise<void>) => { consumer = handler },
        unregisterConsumer: () => undefined
      } as never,
      pipeline: { listItems: () => items, listRevisions: () => [] } as never,
      publicQueryService: {} as never,
      structuredModelInvocation: { invoke: async () => { throw new Error('入口阶段不得调用模型') } },
      dataDir, now: () => asOf
    })
    try {
      const baseline = enqueued.length
      await consumer!({ eventId: 'e-sentiment', topic: 'intelligence.item.detected', payload: { itemId: 'item-message' } })
      expect(enqueued).toHaveLength(baseline)
      await consumer!({ eventId: 'e-macro', topic: 'intelligence.item.detected', payload: { itemId: 'item-macro' } })
      expect(enqueued).toHaveLength(baseline + 1)
      expect(enqueued.at(-1)).toEqual(expect.objectContaining({ handlerId: GROUP_MARKET_ANALYSIS_CHANGE_JOB }))
    } finally {
      runtime.dispose()
      await rm(dataDir, { recursive: true, force: true })
    }
  })

  it('数据类条目照旧看准入：没有情绪判定也能触发', async () => {
    const outcome = await withRuntime({
      item: {
        ...newsItem, itemId: 'item-fear-greed', sourceId: 'alternative-fear-greed', eventType: 'metric',
        // 数据类条目的域是 macro；`sentiment` 域已从自动分析里摘掉（S1）。
        processingLabelsJson: JSON.stringify({ dataDomain: 'macro', relevanceOutcome: 'full-intelligence', sentimentEligible: true })
      }
    }, async ({ runtime, handlers, enqueued }) => {
      await handlers.get(GROUP_MARKET_ANALYSIS_CHANGE_JOB)!({
        changeId: 'item-fear-greed', eventRef: 'item-fear-greed'
      }, context as never)
      const groups = runtime.repository.listEventGroups()
      return {
        ledger: groups.flatMap(group => runtime.repository.listTriggerLedger(group.id)).map(row => ({ decision: row.decision, reasonCode: row.reasonCode })),
        enqueued
      }
    })
    expect(outcome.ledger).toEqual([{ decision: 'queued', reasonCode: 'severity-confirmed' }])
    expect(outcome.enqueued).toEqual(expect.arrayContaining([expect.objectContaining({ handlerId: FREEZE_MARKET_ANALYSIS_SNAPSHOT_JOB })]))
  })
})
