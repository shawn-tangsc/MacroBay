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

/**
 * 事故样本（2026-11-16）：CoinDesk 的跨境支付新闻，自己的情绪判定写着中性、强度 1、
 * 没有标的、「对 BTC、ETH 没有直接影响」，却被判成高重要性并启动了一次分析。
 */
// 触发判定读的是整条判定记录（含判定时刻与置信度）：只要三个结构化字段是无法定严重度的。
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

async function driveChange(input: {
  item: IntelligenceItem
  verdict?: NewsSentimentVerdict
}): Promise<{
  groups: readonly { id: string }[]
  ledger: readonly { decision: string; reasonCode: string }[]
  runs: readonly unknown[]
  enqueued: readonly { handlerId?: string }[]
}> {
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
    pipeline: { listItems: () => [input.item], listRevisions: () => [] } as unknown as IntelligencePipeline,
    publicQueryService: {} as MarketIntelligencePublicQueryService,
    structuredModelInvocation: { invoke: async () => { throw new Error('分组阶段不得调用模型') } },
    ...(input.verdict ? { latestNewsSentiment: () => verdictRecord(input.verdict!) } : {}),
    dataDir,
    now: () => asOf
  })
  try {
    await handlers.get(GROUP_MARKET_ANALYSIS_CHANGE_JOB)!({ changeId: input.item.itemId, eventRef: input.item.itemId }, {
      jobRunId: 'news-trigger', signal: new AbortController().signal,
      log: async () => undefined, progress: async () => undefined
    })
    const groups = runtime.repository.listEventGroups()
    return {
      groups,
      ledger: groups.flatMap(group => runtime.repository.listTriggerLedger(group.id)).map(row => ({ decision: row.decision, reasonCode: row.reasonCode })),
      runs: runtime.repository.listRuns(),
      enqueued
    }
  } finally {
    runtime.dispose()
    await rm(dataDir, { recursive: true, force: true })
  }
}

describe('新闻触发分析：判据是它自己的情绪判定', () => {
  it('中性、无标的、没有直接影响的新闻，零次分析运行', async () => {
    const outcome = await driveChange({ item: newsItem, verdict: neutralNoSymbol })
    expect(outcome.ledger).toEqual([{ decision: 'skipped', reasonCode: 'trigger-score-insufficient' }])
    expect(outcome.runs).toEqual([])
    expect(outcome.enqueued.filter(definition => definition.handlerId === FREEZE_MARKET_ANALYSIS_SNAPSHOT_JOB)).toEqual([])
  })

  it('判定还没写下来时不做决定，也不写账本行：等判定落地再判', async () => {
    const outcome = await driveChange({ item: newsItem })
    expect(outcome.groups).toEqual([])
    expect(outcome.ledger).toEqual([])
    expect(outcome.runs).toEqual([])
    expect(outcome.enqueued).toEqual([])
  })

  it('方向明确、强度够、有标的的新闻，才排一次分析', async () => {
    const outcome = await driveChange({ item: newsItem, verdict: directionalBitcoin })
    expect(outcome.ledger).toEqual([{ decision: 'queued', reasonCode: 'severity-confirmed' }])
    expect(outcome.enqueued).toContainEqual(expect.objectContaining({ handlerId: FREEZE_MARKET_ANALYSIS_SNAPSHOT_JOB }))
  })

  it('数据类条目照旧看准入：没有情绪判定也能触发', async () => {
    const outcome = await driveChange({
      item: { ...newsItem, itemId: 'item-fear-greed', sourceId: 'alternative-fear-greed', eventType: 'metric' }
    })
    expect(outcome.ledger).toEqual([{ decision: 'queued', reasonCode: 'severity-confirmed' }])
  })
})
