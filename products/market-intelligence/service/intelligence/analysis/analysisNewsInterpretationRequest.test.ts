import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { AnalysisRun, EventGroup } from '../../../contracts/marketAnalysisContracts'
import { createNewsInterpretationEndpoints } from './analysisNewsInterpretationRequest'
import { buildEvidenceFingerprint } from './analysisHash'

/**
 * 按条「AI 解读」写端点（R37 §1.1 / §9.4）。判据顺序可测：
 * 先判能不能跑（条目 / 源 / 过滤 / 判定 / 就绪），再判要不要跑（在飞 / 复用），最后才排队。
 */
const asOf = '2026-11-16T09:30:00.000Z'

const item = {
  itemId: 'item-1', sourceId: 'coindesk-rss', title: 'JPMorgan and DBS complete cross-border payment trial',
  summary: 'no direct market impact', publishedAt: '2026-11-16T08:46:00.000Z', detectedAt: '2026-11-16T08:47:00.000Z',
  sourceCategory: 'news', sourceTrust: 'high', eventType: 'news', primaryRawRecordId: 'raw-1', canonicalDedupeKey: 'k',
  severityHint: 'info', timelineStatus: 'evaluated', normalizerVersion: 'v1',
  processingLabelsJson: JSON.stringify({ relevanceOutcome: 'full-intelligence', sentimentEligible: true })
}

const group: EventGroup = {
  id: 'mi-eg-1', schemaVersion: 1, status: 'open', groupType: 'sentiment', mergeKey: 'sentiment|item-1',
  firstObservedAt: asOf, lastObservedAt: asOf, reviewDeadlineAt: asOf, eventRefs: ['item-1'],
  triggerCount: 1, reviewCount: 0, currentSummaryId: null, supersededByGroupId: null, revision: 1, createdAt: asOf, updatedAt: asOf
}

const run = (status: AnalysisRun['status']): AnalysisRun => ({
  id: 'mi-ar-1', schemaVersion: 1, eventGroupId: group.id, snapshotId: 'mi-es-1', snapshotHash: 'snap-hash',
  analysisPhase: 'initial', triggerKey: 'manual.initial', idempotencyKey: 'key', status, attempt: 1,
  retryRunOf: null, retryOfRunId: null, modelProviderId: null, modelId: null, policyVersion: 'p', promptVersion: 'v',
  skillVersion: 's', outputSchemaVersion: 3, jobRunId: null, traceId: null, failureCode: null, failureDetailCode: null,
  validationMode: 'strict', queuedAt: asOf, startedAt: asOf, completedAt: asOf
} as AnalysisRun)

const snapshotFacts = [
  { factId: 'triggered-news:item-1', domain: 'sentiment', subject: '', subjectLabel: item.title, metric: 'news-sentiment', evidenceRefId: 'news:item-1' },
  { factId: 'mi-fact-etf', domain: 'capital', subject: 'BTC', metric: 'etf-net-flow', evidenceRefId: 'ev-etf' }
]
const snapshot = {
  id: 'mi-es-1', schemaVersion: 3, eventGroupId: group.id, asOf, dataCutoff: asOf, snapshotHash: 'snap-hash',
  profileId: 'crypto-market-analysis-v1', facts: snapshotFacts,
  missingDomains: [], caveats: [], evidenceRefs: [{ evidenceRefId: 'news:item-1' }, { evidenceRefId: 'ev-etf' }],
  sourceHealth: [], createdAt: asOf, policyVersion: 'cryptoMarketAnalysisTriggerPolicy.v1',
  trigger: { source: 'intelligence-item', itemId: 'item-1', factId: 'triggered-news:item-1', evidenceRefId: 'news:item-1' }
}
const storedFingerprint = buildEvidenceFingerprint({ facts: snapshotFacts, evidenceRefs: snapshot.evidenceRefs })

// 「当前证据」由冻结同一条预计算给出；这里只为用例把它固定成与快照一致/不一致两档。
const preparedFingerprint = vi.hoisted(() => ({ value: null as string | null }))
vi.mock('./analysisSnapshotPreparation', async () => {
  const actual = await vi.importActual<typeof import('./analysisSnapshotPreparation')>('./analysisSnapshotPreparation')
  return {
    ...actual,
    prepareMarketAnalysisSnapshot: async () => preparedFingerprint.value === null
      ? { state: 'unavailable' as const, errorCode: 'analysis-missing-evidence:news-trigger-evidence-missing' }
      : { context: {} as never, snapshotHash: 'snap-hash', evidenceFingerprint: preparedFingerprint.value, evidenceScope: { asOf, dataCutoff: asOf, factCount: 2, evidenceRefCount: 2, domains: [] } }
  }
})

const summary = { id: 'mi-as-1', analysisRunId: 'mi-ar-1', eventGroupId: group.id, createdAt: asOf }

function harness(overrides: Readonly<{
  items?: readonly unknown[]
  runs?: readonly AnalysisRun[]
  summary?: unknown
  enabled?: boolean
  model?: boolean
  enqueue?: (input: unknown) => Promise<unknown>
}> = {}) {
  const enqueue = vi.fn(overrides.enqueue ?? (async () => ({ state: 'enqueued' as const, runId: 'mi-ar-2' })))
  const ensureGroup = vi.fn(async () => group)
  const endpoints = createNewsInterpretationEndpoints({
    publicQueryService: {} as never,
    pipeline: { listItems: () => (overrides.items ?? [item]) as never, listRevisions: () => [] } as never,
    repository: {
      listEventGroups: () => [group],
      listRuns: () => overrides.runs ?? [],
      getSnapshot: () => snapshot as never,
      getSummaryForRun: () => ('summary' in overrides ? overrides.summary : summary) as never
    } as never,
    latestNewsSentiment: () => ({ polarity: 'bearish', strength: 3, confidence: 80, symbols: ['BTC'], scoredAt: '2026-11-16T09:07:50.718Z', itemId: 'item-1', sourceId: 'coindesk-rss', publishedAt: item.publishedAt, reasonCode: 'c', engine: 'model', caveats: [] }) as never,
    timeZone: () => 'UTC',
    now: () => asOf,
    isEnabled: async () => overrides.enabled ?? true,
    hasModel: async () => overrides.model ?? true,
    ensureGroup,
    enqueue: enqueue as never
  })
  return { request: endpoints.requestNewsInterpretation, enqueue, ensureGroup }
}

beforeEach(() => { preparedFingerprint.value = null })

describe('按条解读：先判能不能跑', () => {
  it('splits not-eligible into three reasons', async () => {
    const { request } = harness()
    await expect(request('missing-item')).resolves.toEqual({ state: 'not-eligible', itemId: 'missing-item', reason: 'item-not-found' })
    const other = harness({ items: [{ ...item, sourceId: 'alternative-fear-greed' }] })
    await expect(other.request('item-1')).resolves.toEqual({ state: 'not-eligible', itemId: 'item-1', reason: 'source-not-covered' })
    // 没有发布时间就建不出触发事实（它要引发生时刻）：这一条仍是「不能单独解读」，且不排运行。
    const noTime = harness({ items: [{ ...item, publishedAt: '' }] })
    await expect(noTime.request('item-1')).resolves.toEqual({ state: 'not-eligible', itemId: 'item-1', reason: 'item-not-eligible' })
    expect(noTime.enqueue).not.toHaveBeenCalled()
  })

  it('admits a low-trust item inside the judged sources when it has a judgment', async () => {
    // 手动入口的准入不是自动分析那把「值不值得花预算」的尺子：读者点名要读这一条，意愿本身就是准入。
    // 线上那次被拒就是这条——有情绪判定，却因为信任度/标签没过自动分析的门槛被告知「不够格」。
    preparedFingerprint.value = 'ev'
    const lowTrust = harness({ items: [{ ...item, sourceTrust: 'low', processingLabelsJson: '{}' }] })
    await expect(lowTrust.request('item-1')).resolves.toMatchObject({ state: 'queued' })
    expect(lowTrust.enqueue).toHaveBeenCalledWith(expect.objectContaining({ triggeredItemId: 'item-1' }))
  })

  it('refuses an item with no sentiment judgment, and never queues', async () => {
    const { enqueue } = harness()
    const endpoints = createNewsInterpretationEndpoints({
      publicQueryService: {} as never,
      pipeline: { listItems: () => [item], listRevisions: () => [] } as never,
      repository: { listEventGroups: () => [group], listRuns: () => [], getSnapshot: () => snapshot as never, getSummaryForRun: () => summary as never } as never,
      latestNewsSentiment: () => undefined,
      timeZone: () => 'UTC', now: () => asOf, isEnabled: async () => true, hasModel: async () => true,
      ensureGroup: async () => group, enqueue: enqueue as never
    })
    await expect(endpoints.requestNewsInterpretation('item-1')).resolves.toEqual({ state: 'no-judgment', itemId: 'item-1' })
    expect(enqueue).not.toHaveBeenCalled()
  })

  it('reports not-ready for a disabled capability or an unset model — before queueing', async () => {
    const disabled = harness({ enabled: false })
    await expect(disabled.request('item-1')).resolves.toEqual({ state: 'not-ready', itemId: 'item-1', failureCode: 'analysis-not-enabled' })
    expect(disabled.enqueue).not.toHaveBeenCalled()
    const noModel = harness({ model: false })
    await expect(noModel.request('item-1')).resolves.toEqual({ state: 'not-ready', itemId: 'item-1', failureCode: 'analysis-provider-not-ready' })
    expect(noModel.enqueue).not.toHaveBeenCalled()
  })
})

describe('按条解读：再判要不要跑', () => {
  it('reports in-flight while the group already has a queued run', async () => {
    const { request, enqueue } = harness({ runs: [run('queued')] })
    await expect(request('item-1')).resolves.toEqual({ state: 'in-flight', itemId: 'item-1', runId: 'mi-ar-1' })
    expect(enqueue).not.toHaveBeenCalled()
  })

  it('reuses the existing reading when the item and the evidence are unchanged', async () => {
    preparedFingerprint.value = storedFingerprint
    const { request, enqueue } = harness({ runs: [run('succeeded')] })
    await expect(request('item-1')).resolves.toMatchObject({
      state: 'already-available', itemId: 'item-1', runId: 'mi-ar-1', summaryId: 'mi-as-1',
      evidenceFingerprint: storedFingerprint
    })
    expect(enqueue).not.toHaveBeenCalled()
  })

  it('starts a new run when the evidence changed, and treats a failed run as a retry', async () => {
    preparedFingerprint.value = 'different-evidence'
    const changed = harness({ runs: [run('succeeded')] })
    await expect(changed.request('item-1')).resolves.toEqual({ state: 'queued', itemId: 'item-1', runId: 'mi-ar-2' })
    expect(changed.enqueue).toHaveBeenCalledWith(expect.objectContaining({ triggeredItemId: 'item-1', triggerKey: 'manual.refresh' }))

    const failedBefore = harness({ runs: [run('failed')] })
    await expect(failedBefore.request('item-1')).resolves.toMatchObject({ state: 'queued' })
  })

  it('carries the trigger item into the freeze payload on both phases (initial and correction)', async () => {
    // 线上那次：运行成功、快照 96 条事实里没有那条新闻、trigger_json 为 NULL——读者花一次钱拿到
    // 一篇与新闻无关的市场综述。指针必须随载荷进冻结；组里已有分析时走 correction，同样要带。
    preparedFingerprint.value = 'ev'
    const first = harness({ runs: [] })
    await first.request('item-1')
    expect(first.enqueue).toHaveBeenCalledWith(expect.objectContaining({
      triggerKey: 'manual.initial', analysisPhase: 'initial', triggeredItemId: 'item-1'
    }))
    preparedFingerprint.value = 'ev-different'
    const again = harness({ runs: [run('succeeded')] })
    await again.request('item-1')
    expect(again.enqueue).toHaveBeenCalledWith(expect.objectContaining({
      triggerKey: 'manual.refresh', analysisPhase: 'correction', triggeredItemId: 'item-1'
    }))
  })

  it('refuses with insufficient-facts when the news cannot be cited at all', async () => {
    preparedFingerprint.value = null
    const { request, enqueue } = harness({ runs: [] })
    await expect(request('item-1')).resolves.toEqual({
      state: 'insufficient-facts', itemId: 'item-1', details: { reason: 'trigger-evidence-missing' }
    })
    expect(enqueue).not.toHaveBeenCalled()
  })

  it('maps freeze failures into the closed set: group missing vs default', async () => {
    preparedFingerprint.value = 'ev'
    const noGroup = harness()
    noGroup.ensureGroup.mockResolvedValue(undefined as never)
    await expect(noGroup.request('item-1')).resolves.toEqual({ state: 'failed', itemId: 'item-1', failureCode: 'analysis-event-group-not-found' })

    // 冻结回来的 `analysis-insufficient-data` 翻成「市场读数不够」，不在这里重判一次。
    const insufficient = harness({ enqueue: async () => ({ state: 'failed', errorCode: 'analysis-insufficient-data' }) })
    await expect(insufficient.request('item-1')).resolves.toEqual({
      state: 'insufficient-facts', itemId: 'item-1', details: { reason: 'market-facts-below-minimum' }
    })
    const unknown = harness({ enqueue: async () => ({ state: 'failed', errorCode: 'analysis-provider-error' }) })
    await expect(unknown.request('item-1')).resolves.toEqual({ state: 'failed', itemId: 'item-1', failureCode: 'analysis-initial-request-failed' })
  })
})
