import { createHash } from 'node:crypto'

import { expect, it, vi } from 'vitest'

import type {
  AnalysisRun, EvidenceSnapshot, EventGroup
} from '../../../contracts/marketAnalysisContracts'
import type { ValidatedAnalysisModelOutput } from './analysisOutputValidator'
import type { NewsInterpretationBody } from '../../../contracts/newsInterpretationContracts'
import { buildAnalysisSnapshotHash } from './analysisHash'
import { createAnalysisRunService } from './analysisRunService'
import { lineFor } from './analysisLineRegistry'
import { marketAnalysisLine } from './marketAnalysisLine'
import { createMarketAnalysisRepository } from '../store/marketAnalysisRepository'

const asOf = '2026-09-25T08:30:00.000Z'
const later = '2026-09-25T08:31:00.000Z'
const itemId = 'item-rss:guid:news-1'

const facts = [{
  factId: 'fact-A', domain: 'macro' as const, subject: 'US CPI', metric: 'actual', value: '3.2', unit: 'percent',
  sourceId: 'source-fed', sourceLabel: '官方', observedAt: asOf, asOf, freshness: 'fresh' as const,
  confidence: 1, comparability: 'comparable' as const, evidenceRefId: 'ev-A'
}]
const evidenceRefs = [{
  evidenceRefId: 'ev-A', sourceId: 'source-fed', sourceLabel: '官方', itemId, occurredAt: asOf,
  publishedAt: asOf, detectedAt: asOf, computedAt: null, visibleAt: asOf,
  excerptHash: createHash('sha256').update('ev-A').digest('hex')
}]
const trigger = { source: 'intelligence-item' as const, itemId, factId: 'triggered-news:item-1', evidenceRefId: 'ev-A' }

function snapshot(withTrigger = false): EvidenceSnapshot {
  const allFacts = withTrigger
    ? [{ ...facts[0]!, factId: 'triggered-news:item-1', metric: 'news-sentiment', subject: 'BTC', value: 'bearish · strength 3/5｜title｜quote' }]
    : facts
  return {
    id: 'mi-es-1', schemaVersion: withTrigger ? 3 : 1, eventGroupId: 'mi-eg-1', asOf, dataCutoff: asOf,
    snapshotHash: buildAnalysisSnapshotHash({ profileId: 'crypto-market-analysis-v1', asOf, dataCutoff: asOf, facts: allFacts, missingDomains: [], caveats: [], evidenceRefs }),
    profileId: 'crypto-market-analysis-v1', facts: allFacts, missingDomains: [], caveats: [], evidenceRefs,
    sourceHealth: [{ sourceId: 'source-fed', status: 'healthy' as const, asOf }], createdAt: asOf,
    policyVersion: 'cryptoMarketAnalysisTriggerPolicy.v1',
    ...(withTrigger ? { trigger } : {})
  }
}

const group: EventGroup = {
  id: 'mi-eg-1', schemaVersion: 1, status: 'monitoring', groupType: 'macro', mergeKey: `US.CPI|mi-eg-1`,
  firstObservedAt: asOf, lastObservedAt: asOf, reviewDeadlineAt: '2026-09-25T09:00:00.000Z',
  eventRefs: [itemId], triggerCount: 1, reviewCount: 0, currentSummaryId: null,
  supersededByGroupId: null, revision: 1, createdAt: asOf, updatedAt: asOf
}

const output: ValidatedAnalysisModelOutput = {
  conclusion: {
    direction: 'bullish', summary: '结论一句。', change: '这次变化两条读数。', causalChain: '起因 → 中间变量 → 方向 → 条件。',
    conditions: ['条件'], macro: null, evidenceStrength: null, dataGaps: []
  },
  knownFacts: [{ factId: 'fact-A', statement: 'actual=3.2', evidenceRefIds: ['ev-A'] }],
  transmissionHypotheses: [],
  marketReaction: [{ statement: 'BTC 上涨', factIds: ['fact-A'], evidenceRefIds: ['ev-A'] }],
  supportingEvidence: [{ statement: '官方数据', evidenceRefId: 'ev-A' }],
  counterEvidence: [],
  scenarios: [{ asset: 'BTC', horizon: '0-15m', baseCase: '震荡', conditions: ['守住支撑'], invalidation: '跌破支撑', status: 'pending' }],
  directions: [
    { horizon: 'short', direction: 'bullish', rationale: '资金转正。', confidence: 'medium', evidenceRefIds: ['ev-A'] },
    { horizon: 'medium', direction: 'range', rationale: '中期缺方向。', confidence: 'low', evidenceRefIds: ['ev-A'] },
    { horizon: 'long', direction: 'undecided', rationale: '长期证据不足。', confidence: 'low', evidenceRefIds: ['ev-A'] }
  ],
  nextCatalysts: [], dataCaveats: [], evidenceRefs: ['ev-A']
}

const newsBody: NewsInterpretationBody = {
  analysisKind: 'news', schemaVersion: 1,
  what: {
    evidenceRefId: 'ev-A', actor: '据报道，', action: '某公司宣布裁员。',
    whyRelated: '这会压低风险偏好，对 BTC 偏空。', stance: 'bearish'
  },
  reading: {
    checks: [
      { evidenceRefId: 'ev-A', effect: 'supports', statement: 'ETF 净流出，截至 2026-09-25 16:30 GMT+8。' },
      { evidenceRefId: 'ev-A', effect: 'supports', statement: '资金面同样偏弱，截至 2026-09-25 16:30 GMT+8。' }
    ],
    contradiction: false, verdict: 'supports'
  },
  outlook: {
    direction: 'bearish', mechanism: '短期偏空。新闻压低风险偏好，若资金流转正则这个判断作废。',
    watchFor: [{ refKind: 'fact', ref: 'fact-A' }], invalidation: { refKind: 'fact', factId: 'fact-A' }
  },
  gaps: []
}

function claimedRun(
  repository: ReturnType<typeof createMarketAnalysisRepository>,
  analysisKind: 'market' | 'news',
  id = `mi-ar-${analysisKind}`,
  analysisPhase: 'initial' | 'correction' = 'initial'
): AnalysisRun {
  const service = createAnalysisRunService({ repository, now: () => asOf, idFactory: () => id })
  const run = service.enqueue({
    analysisKind, eventGroupId: group.id, snapshotId: snapshot().id, snapshotHash: snapshot().snapshotHash,
    analysisPhase, triggerKey: analysisKind === 'news' ? 'news.manual' : 'signal.sentiment.rule'
  }).run
  expect(repository.claimRun(run.id, later)).toBe(true)
  return run
}

it('keeps the trigger contract out of the market line and in the news line', () => {
  const triggered = snapshot(true)
  const market = lineFor('market').buildMessages(triggered, [], undefined, { timeZone: 'UTC', proseLanguage: 'zh-CN' })
  const marketSystem = market.find(message => message.role === 'system')!.content
  const marketUser = JSON.parse(market.find(message => message.role === 'user')!.content) as Record<string, unknown>
  // 断在产出上：市场线即使拿到带 trigger 的快照，也没有触发段、没有 trigger 注入。
  expect(marketSystem).not.toContain('本次运行由**一条新闻**触发')
  expect(marketSystem).not.toContain('trigger.fact')
  expect(marketSystem).not.toContain('conclusion.newsImpact')
  expect(marketSystem).not.toContain('来源归属要自然')
  expect(marketUser.trigger).toBeUndefined()

  const news = lineFor('news').buildMessages(triggered, [], undefined, { timeZone: 'UTC', proseLanguage: 'zh-CN' })
  const newsSystem = news.find(message => message.role === 'system')!.content
  const newsUser = JSON.parse(news.find(message => message.role === 'user')!.content) as Record<string, unknown>
  // 新闻线走自己的契约：三段由 what/reading/outlook 承载，触发新闻单独作为 news 段给出。
  expect(newsSystem).toContain('三段各管一件事，顺序由字段承载')
  expect(newsSystem).toContain('每条 check 的 `statement` 必须逐字包含该事实的 `observedAtText`')
  expect(newsUser.news).toMatchObject({ subject: 'BTC' })
  expect(newsUser.marketFactRefs).toBeInstanceOf(Array)
})

it('writes the line’s own prompt and skill versions onto the run row', () => {
  const repository = createMarketAnalysisRepository({ filePath: ':memory:' })
  try {
    repository.appendEventGroup(group)
    repository.appendSnapshot(snapshot())
    const market = claimedRun(repository, 'market', 'mi-ar-market').id
    const news = claimedRun(repository, 'news', 'mi-ar-news').id
    expect(repository.getRun(market)).toMatchObject({ analysisKind: 'market', promptVersion: 'market-analysis-v3', skillVersion: 'market-analysis-v1' })
    expect(repository.getRun(news)).toMatchObject({ analysisKind: 'news', promptVersion: 'news-analysis-v2', skillVersion: 'news-analysis-v1' })
  } finally {
    repository.close()
  }
})

it('keeps the news line’s record out of the market surfaces', async () => {
  const repository = createMarketAnalysisRepository({ filePath: ':memory:' })
  try {
    repository.appendEventGroup(group)
    repository.appendSnapshot(snapshot())
    const run = claimedRun(repository, 'news')
    const appendRunSummary = vi.fn(async () => undefined)
    const notifyAnalysisConclusion = vi.fn(async () => undefined)
    await lineFor('news').persist(run, newsBody, {
      repository, snapshot: snapshot(true), now: later, idFactory: () => 'mi-as-1',
      appendRunSummary, notifyAnalysisConclusion
    })

    const summary = repository.getSummaryForRun(run.id)
    expect(summary).toMatchObject({ analysisKind: 'news', eventGroupId: group.id, version: 1 })
    expect(repository.getRun(run.id)?.status).toBe('succeeded')
    // 不写预测、不写时间轴、不挂组当前结论、不写会话摘要、不推送。
    expect(repository.listPredictions(summary!.id)).toEqual([])
    expect(repository.listTimeline({ eventGroupId: group.id }).items).toEqual([])
    expect(repository.getEventGroup(group.id)?.currentSummaryId).toBeNull()
    expect(appendRunSummary).not.toHaveBeenCalled()
    expect(notifyAnalysisConclusion).not.toHaveBeenCalled()

    // 同一条新闻的第二次解读：版本按行递增，不撞 (event_group_id, version) 唯一键。
    const second = claimedRun(repository, 'news', 'mi-ar-news-2', 'correction')
    await lineFor('news').persist(second, newsBody, {
      repository, snapshot: snapshot(true), now: later, idFactory: () => 'mi-as-2',
      appendRunSummary, notifyAnalysisConclusion
    })
    expect(repository.getSummaryForRun(second.id)?.version).toBe(2)
  } finally {
    repository.close()
  }
})

it('lets the market line write predictions, the timeline, the group pointer and the session summary', async () => {
  const repository = createMarketAnalysisRepository({ filePath: ':memory:' })
  try {
    repository.appendEventGroup(group)
    repository.appendSnapshot(snapshot())
    const run = claimedRun(repository, 'market')
    const appendRunSummary = vi.fn(async () => undefined)
    await marketAnalysisLine.persist(run, output, { repository, snapshot: snapshot(), now: later, idFactory: () => 'mi-as-1', appendRunSummary })

    const summary = repository.getSummaryForRun(run.id)!
    expect(summary).toMatchObject({ analysisKind: 'market', version: 1 })
    expect(repository.listPredictions(summary.id)).toHaveLength(1)
    expect(repository.listTimeline({ eventGroupId: group.id }).items).toHaveLength(1)
    expect(repository.getEventGroup(group.id)?.currentSummaryId).toBe(summary.id)
    expect(appendRunSummary).toHaveBeenCalledWith({ runId: run.id, summary: '结论一句。' })
  } finally {
    repository.close()
  }
})
