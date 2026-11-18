import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createJobRuntime } from '@platform/jobs'
import type { AnalysisSummary, EventGroup, EvidenceSnapshot } from '../../../contracts/marketAnalysisContracts'
import type { IntelligenceItem } from '../schema/intelligenceRecord'
import { createMarketAnalysisRepository } from '../store/marketAnalysisRepository'
import { createAnalysisRunService } from '../analysis/analysisRunService'
import { buildAnalysisSnapshotHash, buildEvidenceFingerprint } from '../analysis/analysisHash'
import { createNewsInterpretationEndpoints } from '../analysis/analysisNewsInterpretationRequest'
import type { NewsSentimentRecord } from '../schema/newsSentiment'
import { FREEZE_MARKET_ANALYSIS_SNAPSHOT_JOB } from './marketAnalysisJobIds'
import { createInitialMarketAnalysisRequest } from './requestInitialMarketAnalysis'

/**
 * 「一条新闻只有一份解读」（S1 补口，Chief 按行数验收）。
 *
 * 卡片那条旧 IPC（遗留手动刷新）与服务端新闻写端点共用同一份读判：同 item、同证据指纹且有可读
 * 摘要就复用；指纹变了（新闻事实变了）才允许新建，旧的那份保留。判定只走只读口，不复制一份。
 */
const asOf = '2026-11-18T09:30:00.000Z'
const itemId = 'item-message'
const groupId = 'mi-eg-message'
const cleanups: (() => void)[] = []

// 「当前证据」由冻结同一条预计算给出；这里只把它固定成与已落库快照一致/不一致两档。
const preparedFingerprint = vi.hoisted(() => ({ value: null as string | null }))
vi.mock('../analysis/analysisSnapshotPreparation', async () => {
  const actual = await vi.importActual<typeof import('../analysis/analysisSnapshotPreparation')>('../analysis/analysisSnapshotPreparation')
  return {
    ...actual,
    prepareMarketAnalysisSnapshot: async () => preparedFingerprint.value === null
      ? { state: 'unavailable' as const, errorCode: 'analysis-missing-evidence:news-trigger-evidence-missing' }
      : {
          context: {} as never, snapshotHash: 'prepared-hash', evidenceFingerprint: preparedFingerprint.value,
          evidenceScope: { asOf, dataCutoff: asOf, factCount: 1, evidenceRefCount: 1, domains: ['sentiment'] }
        }
  }
})

afterEach(() => { cleanups.splice(0).forEach(cleanup => cleanup()); vi.restoreAllMocks() })
beforeEach(() => { preparedFingerprint.value = null })

const item: IntelligenceItem = {
  itemId, primaryRawRecordId: 'raw-1', canonicalDedupeKey: 'dedupe-1', sourceId: 'alternative-fear-greed',
  eventType: 'metric', title: '恐慌与贪婪指数跌至 18', sourceCategory: 'news', sourceTrust: 'high',
  detectedAt: asOf, publishedAt: asOf, timelineStatus: 'evaluated', normalizerVersion: 'v1',
  processingLabelsJson: JSON.stringify({ dataDomain: 'sentiment', relevanceOutcome: 'full-intelligence', sentimentEligible: true })
}

const group: EventGroup = {
  id: groupId, schemaVersion: 1, status: 'open', groupType: 'sentiment', mergeKey: `sentiment|${itemId}`,
  firstObservedAt: asOf, lastObservedAt: asOf, reviewDeadlineAt: asOf, eventRefs: [itemId],
  triggerCount: 1, reviewCount: 0, currentSummaryId: null, supersededByGroupId: null, revision: 1,
  createdAt: asOf, updatedAt: asOf
}

const judgment: NewsSentimentRecord = {
  itemId, sourceId: 'alternative-fear-greed', publishedAt: asOf, scoredAt: asOf,
  polarity: 'bearish', strength: 3, confidence: 80, symbols: ['BTC'], reasonCode: 'c', engine: 'model', caveats: []
} as NewsSentimentRecord

function newsSnapshot(id: string): { snapshot: EvidenceSnapshot; snapshotHash: string } {
  const facts = [{
    factId: `triggered-news:${itemId}`, domain: 'sentiment', subject: '', subjectLabel: item.title,
    metric: 'news-sentiment', evidenceRefId: `news:${itemId}`
  }]
  const evidenceRefs = [{
    evidenceRefId: `news:${itemId}`, sourceId: item.sourceId, sourceLabel: '消息面', itemId,
    occurredAt: asOf, publishedAt: asOf, detectedAt: asOf, computedAt: null, visibleAt: asOf, excerptHash: 'h'
  }]
  const shape = {
    id, schemaVersion: 3, eventGroupId: groupId, asOf, dataCutoff: asOf,
    profileId: 'crypto-market-analysis-v1', facts, missingDomains: [], caveats: [], evidenceRefs,
    sourceHealth: [], createdAt: asOf, policyVersion: 'cryptoMarketAnalysisTriggerPolicy.v1',
    trigger: { source: 'intelligence-item', itemId, factId: `triggered-news:${itemId}`, evidenceRefId: `news:${itemId}` }
  }
  const snapshotHash = buildAnalysisSnapshotHash(shape)
  // 快照事实在本用例里只需要身份与证据指针；完整字段由冻结路径负责，这里照既有用例的写法收窄。
  return { snapshot: { ...shape, snapshotHash } as unknown as EvidenceSnapshot, snapshotHash }
}

function summaryFor(runId: string, version: number): AnalysisSummary {
  return {
    id: `mi-as-news-${version}`, schemaVersion: 1, analysisKind: 'news', analysisRunId: runId,
    eventGroupId: groupId, version, createdAt: asOf,
    conclusion: {
      direction: 'bearish', summary: '第一段：某消息面读数偏空。', change: '第二段：读数变得更空。',
      causalChain: '第三段：若情绪继续走弱则维持判断。', conditions: [], macro: null, evidenceStrength: null, dataGaps: []
    },
    knownFacts: [], transmissionHypotheses: [], marketReaction: [], supportingEvidence: [], counterEvidence: [],
    scenarios: [], directions: [], nextCatalysts: [], dataCaveats: [],
    evidenceRefs: [`news:${itemId}`]
  }
}

function setup() {
  const repository = createMarketAnalysisRepository({ filePath: ':memory:' })
  const jobRuntime = createJobRuntime()
  cleanups.push(() => { jobRuntime.stopAll(); repository.close() })
  repository.appendEventGroup(group)

  // 真冻结作业的替身：造快照 → 造 news 运行 → 写成三段摘要（与线上写入路径同一个提交口）。
  const written: { runIds: string[]; summaryIds: string[] } = { runIds: [], summaryIds: [] }
  jobRuntime.registerHandler(FREEZE_MARKET_ANALYSIS_SNAPSHOT_JOB, async () => {
    const version = repository.latestSummaryVersion(groupId) + 1
    const { snapshot, snapshotHash } = newsSnapshot(`mi-es-news-${version}`)
    repository.appendSnapshot({ ...snapshot, snapshotHash })
    const { run } = createAnalysisRunService({ repository, now: () => asOf, idFactory: () => `mi-ar-news-${version}` })
      .enqueue({ analysisKind: 'news', eventGroupId: groupId, snapshotId: snapshot.id, snapshotHash, analysisPhase: 'initial', triggerKey: 'news.manual' })
    repository.claimRun(run.id, asOf)
    const summary = summaryFor(run.id, version)
    repository.commitSuccessfulAnalysis({ runId: run.id, summary, predictions: [], recordGroupPointer: false })
    written.runIds.push(run.id)
    written.summaryIds.push(summary.id)
    preparedFingerprint.value = buildEvidenceFingerprint({ facts: snapshot.facts, evidenceRefs: snapshot.evidenceRefs })
  })

  const endpointEnqueue = vi.fn(async () => ({ state: 'enqueued' as const, runId: 'mi-ar-from-endpoint' }))
  const endpoints = createNewsInterpretationEndpoints({
    publicQueryService: {} as never,
    pipeline: { listItems: () => [item], listRevisions: () => [] } as never,
    repository,
    latestNewsSentiment: () => judgment,
    timeZone: () => 'UTC', now: () => asOf,
    isEnabled: async () => true, hasModel: async () => true,
    ensureGroup: async () => group,
    enqueue: endpointEnqueue as never
  })

  const request = createInitialMarketAnalysisRequest({
    repository, jobRuntime, listItems: () => [item], now: () => asOf,
    createGroup: () => group, latestNewsSentiment: () => judgment,
    readNewsInterpretation: endpoints.readNewsInterpretation
  })
  return { repository, jobRuntime, request, endpoints, endpointEnqueue, written }
}

describe('一条新闻只有一份解读（遗留刷新与抽屉同源）', () => {
  it('reuses the existing reading when the card refresh and the drawer ask for the same evidence', async () => {
    const fixture = setup()
    const enqueueSpy = vi.spyOn(fixture.jobRuntime, 'enqueueDefinition')

    // 卡片上的遗留刷新先成功一次：1 条 news 运行、1 份摘要。
    await expect(fixture.request(itemId, undefined, 'refresh', 'manual')).resolves.toEqual({ itemId, queued: true })
    expect(fixture.repository.listRuns().map(run => run.analysisKind)).toEqual(['news'])
    expect(fixture.repository.latestSummaryVersion(groupId)).toBe(1)
    const freezeCalls = enqueueSpy.mock.calls.length

    // 抽屉右键同一条、同证据：复用已读，不新建。
    const drawer = await fixture.endpoints.requestNewsInterpretation(itemId)
    expect(drawer).toMatchObject({ state: 'already-available', itemId })
    expect(fixture.endpointEnqueue).not.toHaveBeenCalled()

    // 卡片再点一次（遗留 IPC）：同样不新建，也不谎报一次新的冻结。
    await expect(fixture.request(itemId, undefined, 'refresh', 'manual')).resolves.toEqual({ itemId, queued: true })
    expect(enqueueSpy.mock.calls.length).toBe(freezeCalls)
    expect(fixture.repository.listRuns()).toHaveLength(1)
    expect(fixture.repository.latestSummaryVersion(groupId)).toBe(1)
  })

  it('allows a new reading when the news facts changed, and keeps the old one', async () => {
    const fixture = setup()
    await expect(fixture.request(itemId, undefined, 'refresh', 'manual')).resolves.toEqual({ itemId, queued: true })
    const firstRunId = fixture.written.runIds[0]!

    // 新闻事实变了（证据指纹不同）：读者再点必须能读到新的一份，旧的一份保留。
    preparedFingerprint.value = 'different-evidence'
    await expect(fixture.request(itemId, undefined, 'refresh', 'manual')).resolves.toEqual({ itemId, queued: true })

    expect(fixture.repository.listRuns()).toHaveLength(2)
    expect(fixture.repository.latestSummaryVersion(groupId)).toBe(2)
    expect(fixture.repository.getSummaryForRun(firstRunId)?.conclusion?.summary).toBe('第一段：某消息面读数偏空。')
  })

  it('keeps one run when the news reading is already in flight', async () => {
    const fixture = setup()
    const { snapshot, snapshotHash } = newsSnapshot('mi-es-inflight')
    fixture.repository.appendSnapshot({ ...snapshot, snapshotHash })
    const { run } = createAnalysisRunService({ repository: fixture.repository, now: () => asOf, idFactory: () => 'mi-ar-inflight' })
      .enqueue({ analysisKind: 'news', eventGroupId: groupId, snapshotId: snapshot.id, snapshotHash, analysisPhase: 'initial', triggerKey: 'news.manual' })
    const enqueueSpy = vi.spyOn(fixture.jobRuntime, 'enqueueDefinition')

    await expect(fixture.request(itemId, undefined, 'refresh', 'manual')).resolves.toEqual({ itemId, queued: true })
    await expect(fixture.request(itemId, undefined, 'refresh', 'manual')).resolves.toEqual({ itemId, queued: true })
    expect(enqueueSpy).not.toHaveBeenCalled()
    expect(fixture.repository.listRuns().map(candidate => candidate.id)).toEqual([run.id])
  })
})
