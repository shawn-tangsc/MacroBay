import { describe, expect, it, vi } from 'vitest'

import type { JobContext, JobHandler, JobRuntime } from '@platform/jobs'

import type { IntelligencePipeline } from '../application/intelligencePipeline'
import {
  INTELLIGENCE_ASSESS_CHANGED_ITEMS_JOB,
  INTELLIGENCE_ARCHIVE_COMPACTION_JOB,
  INTELLIGENCE_COLLECT_SOURCE_JOB,
  INTELLIGENCE_NORMALIZE_RAW_RECORDS_JOB,
  INTELLIGENCE_REFRESH_SENTIMENT_AGGREGATES_JOB,
  INTELLIGENCE_REPLAY_WINDOW_JOB,
  INTELLIGENCE_TRANSLATE_ITEMS_JOB
} from './intelligenceJobIds'
import { registerIntelligenceJobs } from './registerIntelligenceJobs'
import { zeroXRouterSourcePolicy } from '../application/zeroXRouterSourcePolicy'

describe('registerIntelligenceJobs', () => {
  it('writes the collection counts into the run result, so "nothing new" and "failed" differ', async () => {
    // 判据（Chief 2026-11-07）：一次「抓到了但 0 条新」和一次「抓不到」，运行记录必须长得不一样。
    // 平台的结论只有四个计数，所以映射成：总数=解析、成功=新增、跳过=重复；失败时 失败=1 + 原因码。
    const handlers = new Map<string, JobHandler>()
    const jobRuntime = {
      registerHandler(handlerId: string, handler: JobHandler) { handlers.set(handlerId, handler) },
      enqueueDefinition: vi.fn(async () => ({ id: 'run-x' }))
    } as unknown as JobRuntime

    const collectedNothing = vi.fn(async () => ({
      queuedJobs: [] as string[],
      counts: { httpCalls: 1, fetchedBytes: 30_729, parsed: 25, appended: 0, duplicates: 25 }
    }))
    registerIntelligenceJobs(jobRuntime, { pipeline: { ...createPipelineStub(), collectSource: collectedNothing } as IntelligencePipeline })
    const collectHandler = handlers.get(INTELLIGENCE_COLLECT_SOURCE_JOB)!
    const okResult = vi.fn(async () => undefined)
    await collectHandler({ sourceId: 'coindesk-rss' }, createContext('ok-run', { result: okResult }))
    expect(okResult).toHaveBeenCalledWith({ counts: { total: 25, succeeded: 0, failed: 0, skipped: 25 } })

    // 抓取失败：计数归零，但带原因码 —— 与上面那条一眼可分。
    const failed = vi.fn(async () => ({
      queuedJobs: [] as string[],
      counts: { httpCalls: 0, fetchedBytes: 0, parsed: 0, appended: 0, duplicates: 0 },
      reasonCode: 'collect-failed' as const,
      reason: 'feed unreachable'
    }))
    const handlers2 = new Map<string, JobHandler>()
    registerIntelligenceJobs(
      {
        registerHandler(handlerId: string, handler: JobHandler) { handlers2.set(handlerId, handler) },
        enqueueDefinition: vi.fn(async () => ({ id: 'run-y' }))
      } as unknown as JobRuntime,
      { pipeline: { ...createPipelineStub(), collectSource: failed } as IntelligencePipeline }
    )
    const failedResult = vi.fn(async () => undefined)
    await handlers2.get(INTELLIGENCE_COLLECT_SOURCE_JOB)!(
      { sourceId: 'coindesk-rss' },
      createContext('fail-run', { result: failedResult })
    )
    expect(failedResult).toHaveBeenCalledWith({
      counts: { total: 0, succeeded: 0, failed: 1, skipped: 0 },
      reasonCode: 'collect-failed'
    })
  })

  it('enqueues downstream jobs returned by collect and normalize handlers', async () => {
    const handlers = new Map<string, JobHandler>()
    const enqueueDefinition = vi.fn(async () => ({ id: 'run-1' }))
    const jobRuntime = {
      registerHandler(handlerId: string, handler: JobHandler) {
        handlers.set(handlerId, handler)
      },
      enqueueDefinition
    } as unknown as JobRuntime
    const pipeline = createPipelineStub()

    registerIntelligenceJobs(jobRuntime, { pipeline })

    const collectHandler = handlers.get(INTELLIGENCE_COLLECT_SOURCE_JOB)
    expect(collectHandler).toBeTruthy()
    await collectHandler!(
      { sourceId: 'coindesk-rss' },
      createContext('collect-run')
    )

    expect(pipeline.collectSource).toHaveBeenCalledWith({
      sourceId: 'coindesk-rss',
      runId: 'collect-run'
    })
    expect(enqueueDefinition).toHaveBeenCalledWith(
      expect.objectContaining({
        handlerId: INTELLIGENCE_NORMALIZE_RAW_RECORDS_JOB,
        payload: { sourceId: 'coindesk-rss' }
      })
    )

    enqueueDefinition.mockClear()
    const normalizeHandler = handlers.get(INTELLIGENCE_NORMALIZE_RAW_RECORDS_JOB)
    expect(normalizeHandler).toBeTruthy()
    await normalizeHandler!(
      { sourceId: 'coindesk-rss' },
      createContext('normalize-run')
    )

    expect(enqueueDefinition).toHaveBeenCalledWith(
      expect.objectContaining({
        handlerId: INTELLIGENCE_ASSESS_CHANGED_ITEMS_JOB,
        payload: { sourceId: 'coindesk-rss', newItemIds: ['item-1'], itemIds: ['item-1'] }
      })
    )
    expect(enqueueDefinition).toHaveBeenCalledWith(
      expect.objectContaining({
        handlerId: INTELLIGENCE_REFRESH_SENTIMENT_AGGREGATES_JOB,
        payload: { sourceId: 'coindesk-rss', newItemIds: ['item-1'], itemIds: ['item-1'] }
      })
    )
  })

  it('rejects forged retired stablecoin replay and archive jobs before services run', async () => {
    const handlers = new Map<string, JobHandler>()
    const jobRuntime = {
      registerHandler(handlerId: string, handler: JobHandler) {
        handlers.set(handlerId, handler)
      },
      enqueueDefinition: vi.fn()
    } as unknown as JobRuntime
    const replayService = { replayWindow: vi.fn() }
    const archiveService = { compactSource: vi.fn() }

    registerIntelligenceJobs(jobRuntime, {
      pipeline: createPipelineStub(),
      replayService: replayService as never,
      archiveService: archiveService as never
    })

    const context = createContext('forged-run')
    await handlers.get(INTELLIGENCE_REPLAY_WINDOW_JOB)!({ sourceId: 'defillama-stablecoins' }, context)
    await handlers.get(INTELLIGENCE_ARCHIVE_COMPACTION_JOB)!({ sourceId: 'defillama-stablecoins' }, context)

    expect(replayService.replayWindow).not.toHaveBeenCalled()
    expect(archiveService.compactSource).not.toHaveBeenCalled()
  })

  it('routes the stablecoin collect job only to the special collector', async () => {
    const handlers = new Map<string, JobHandler>()
    const jobRuntime = {
      registerHandler(handlerId: string, handler: JobHandler) { handlers.set(handlerId, handler) },
      enqueueDefinition: vi.fn()
    } as unknown as JobRuntime
    const pipeline = createPipelineStub()
    const refresh = vi.fn(async () => ({ state: 'updated' as const }))

    registerIntelligenceJobs(jobRuntime, { pipeline, capitalConditions: { refresh } })
    await handlers.get(INTELLIGENCE_COLLECT_SOURCE_JOB)!({ sourceId: 'defillama-stablecoins' }, createContext('capital-run'))

    expect(refresh).toHaveBeenCalledOnce()
    expect(pipeline.collectSource).not.toHaveBeenCalled()
  })

  it('routes the enabled 0xRouter ETF collect job only to the current-state refresh', async () => {
    const handlers = new Map<string, JobHandler>()
    const jobRuntime = {
      registerHandler(handlerId: string, handler: JobHandler) { handlers.set(handlerId, handler) },
      enqueueDefinition: vi.fn()
    } as unknown as JobRuntime
    const pipeline = createPipelineStub()
    const refresh = vi.fn(async () => ({ state: 'updated' as const }))

    registerIntelligenceJobs(jobRuntime, { pipeline, etfFlowHistory: { refresh } })
    await handlers.get(INTELLIGENCE_COLLECT_SOURCE_JOB)!({ sourceId: zeroXRouterSourcePolicy.sourceId }, createContext('etf-run'))

    expect(refresh).toHaveBeenCalledOnce()
    expect(pipeline.collectSource).not.toHaveBeenCalled()
  })

  it('routes Binance funding collect jobs only to funding history refresh', async () => {
    const handlers = new Map<string, JobHandler>()
    const jobRuntime = {
      registerHandler(handlerId: string, handler: JobHandler) { handlers.set(handlerId, handler) },
      enqueueDefinition: vi.fn()
    } as unknown as JobRuntime
    const pipeline = createPipelineStub()
    const refresh = vi.fn(async () => ({ state: 'updated' as const }))

    registerIntelligenceJobs(jobRuntime, { pipeline, fundingRateHistory: { refresh } })
    await handlers.get(INTELLIGENCE_COLLECT_SOURCE_JOB)!({ sourceId: 'binance-futures-positioning' }, createContext('funding-run'))

    expect(refresh).toHaveBeenCalledOnce()
    expect(pipeline.collectSource).not.toHaveBeenCalled()
  })

  it('keeps ten years of stablecoin polling out of generic collection work', async () => {
    const handlers = new Map<string, JobHandler>()
    const jobRuntime = {
      registerHandler(handlerId: string, handler: JobHandler) { handlers.set(handlerId, handler) },
      enqueueDefinition: vi.fn()
    } as unknown as JobRuntime
    const pipeline = createPipelineStub()
    const refresh = vi.fn(async () => ({ state: 'unchanged' as const }))

    registerIntelligenceJobs(jobRuntime, { pipeline, capitalConditions: { refresh } })
    const collect = handlers.get(INTELLIGENCE_COLLECT_SOURCE_JOB)!
    for (let day = 0; day < 365 * 10; day += 1) {
      await collect({ sourceId: 'defillama-stablecoins' }, createContext(`capital-${day}`))
    }

    expect(refresh).toHaveBeenCalledTimes(365 * 10)
    expect(pipeline.collectSource).not.toHaveBeenCalled()
    expect(pipeline.normalizeRawRecords).not.toHaveBeenCalled()
    expect(pipeline.assessChangedItems).not.toHaveBeenCalled()
    expect(pipeline.refreshSentimentAggregates).not.toHaveBeenCalled()
  })

  it('records what the translation batch concluded', async () => {
    const handlers = new Map<string, JobHandler>()
    const jobRuntime = {
      registerHandler(handlerId: string, handler: JobHandler) {
        handlers.set(handlerId, handler)
      },
      enqueueDefinition: vi.fn()
    } as unknown as JobRuntime
    const result = vi.fn(async () => undefined)

    registerIntelligenceJobs(jobRuntime, {
      pipeline: createPipelineStub(),
      translationService: {
        translateItems: async () => ({
          processed: 2,
          failed: 1,
          counts: { total: 3, succeeded: 2, failed: 1, skipped: 0 },
          reasonCode: 'model.rate-limited'
        })
      }
    })
    const translate = handlers.get(INTELLIGENCE_TRANSLATE_ITEMS_JOB)!
    await translate({ itemIds: ['item-1'] }, createContext('run-1', { result }))

    expect(result).toHaveBeenCalledWith({
      counts: { total: 3, succeeded: 2, failed: 1, skipped: 0 },
      reasonCode: 'model.rate-limited'
    })
  })

  it('leaves the run without a conclusion when the batch could not be counted', async () => {
    const handlers = new Map<string, JobHandler>()
    const jobRuntime = {
      registerHandler(handlerId: string, handler: JobHandler) {
        handlers.set(handlerId, handler)
      },
      enqueueDefinition: vi.fn()
    } as unknown as JobRuntime
    const result = vi.fn(async () => undefined)

    registerIntelligenceJobs(jobRuntime, {
      pipeline: createPipelineStub(),
      translationService: { translateItems: async () => ({ processed: 0, failed: 0 }) }
    })
    const translate = handlers.get(INTELLIGENCE_TRANSLATE_ITEMS_JOB)!
    await translate({ filters: { sourceIds: ['coindesk-rss'] } }, createContext('run-2', { result }))

    // No counts means the row reads as legacy, never as a batch that succeeded zero times.
    expect(result).not.toHaveBeenCalled()
  })
})

function createContext(jobRunId: string, extra?: { result?: JobContext['result'] }): JobContext {
  return {
    jobRunId,
    signal: new AbortController().signal,
    log: vi.fn(async () => undefined),
    progress: vi.fn(async () => undefined),
    ...(extra?.result ? { result: extra.result } : {})
  }
}

function createPipelineStub(): IntelligencePipeline {
  return {
    collectSource: vi.fn(async () => ({
      queuedJobs: [INTELLIGENCE_NORMALIZE_RAW_RECORDS_JOB],
      counts: { httpCalls: 1, fetchedBytes: 1024, parsed: 2, appended: 2, duplicates: 0 }
    })),
    normalizeRawRecords: vi.fn(async () => ({
      processedCount: 1,
      queuedJobs: [INTELLIGENCE_ASSESS_CHANGED_ITEMS_JOB, INTELLIGENCE_REFRESH_SENTIMENT_AGGREGATES_JOB],
      newItemIds: ['item-1']
    })),
    assessChangedItems: vi.fn(async () => ({ assessmentCount: 1, failedCount: 0 })),
    retryItemAssessment: vi.fn(async () => ({ assessmentCount: 1, failedCount: 0 })),
    refreshSentimentAggregates: vi.fn(async () => ({ aggregateCount: 1 })),
    getHealth: vi.fn(),
    listItems: vi.fn(() => []),
    listClusters: vi.fn(() => []),
    listAssessments: vi.fn(() => []),
    listSentimentAggregates: vi.fn(() => []),
    listRevisions: vi.fn(() => []),
    listRawRecordSummaries: vi.fn(() => []),
    listMetricEvents: vi.fn(() => []),
    listImpacts: vi.fn(() => []),
    listRuntimeStates: vi.fn(() => []),
    listRuntimeStatesAsOf: vi.fn(() => []),
    reportConnectivityProbe: vi.fn()
  }
}
