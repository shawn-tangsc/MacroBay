import { describe, expect, it, vi } from 'vitest'

import type { JobHandler, JobRuntime } from '@platform/jobs'

import { INTELLIGENCE_ENRICH_NEWS_DOCUMENTS_JOB, INTELLIGENCE_RECOVER_PENDING_RAW_RECORDS_JOB } from './intelligenceJobIds'
import {
  RAW_RECORD_RECOVERY_INTERVAL_MS,
  rawRecordRecoveryDefinition,
  registerRawRecordRecoveryJob
} from './rawRecordRecoveryJob'

function normalizeResult(overrides: Record<string, unknown> = {}) {
  return {
    processedCount: 0,
    failedCount: 0,
    staleNewsCount: 0,
    staleReceivedCount: 0,
    queuedJobs: [] as string[],
    newItemIds: [] as string[],
    backfillItemIds: [] as string[],
    ...overrides
  }
}

function harness(input: Readonly<{
  pending: number
  normalize?: () => Promise<ReturnType<typeof normalizeResult>>
}>) {
  const handlers = new Map<string, JobHandler>()
  const enqueued: Record<string, unknown>[] = []
  const schedules: Record<string, unknown>[] = []
  const jobRuntime = {
    registerHandler(handlerId: string, handler: JobHandler) { handlers.set(handlerId, handler) },
    setSchedule(definition: Record<string, unknown>) { schedules.push(definition) },
    enqueueDefinition: vi.fn(async (definition: Record<string, unknown>) => {
      enqueued.push(definition)
      return { id: `run-${enqueued.length}` }
    })
  } as unknown as JobRuntime
  const normalizeRawRecords = vi.fn(input.normalize ?? (async () => normalizeResult()))
  registerRawRecordRecoveryJob(jobRuntime, {
    pendingRawRecordCount: () => input.pending,
    normalizeRawRecords
  })
  const run = async (context = { log: vi.fn(async () => undefined) }) => {
    await handlers.get(INTELLIGENCE_RECOVER_PENDING_RAW_RECORDS_JOB)!({}, context as never)
    return context
  }
  return { handlers, run, normalizeRawRecords, enqueued, schedules }
}

describe('rawRecordRecoveryJob', () => {
  it('is a ten-minute interval job with a bilingual title, so the job list never shows an internal name', () => {
    const definition = rawRecordRecoveryDefinition()
    expect(definition.handlerId).toBe(INTELLIGENCE_RECOVER_PENDING_RAW_RECORDS_JOB)
    expect(definition.trigger).toEqual({
      kind: 'interval',
      intervalMs: RAW_RECORD_RECOVERY_INTERVAL_MS,
      anchor: 'lastComplete'
    })
    expect(RAW_RECORD_RECOVERY_INTERVAL_MS).toBe(10 * 60_000)
    expect(definition.title).toMatchObject({ 'zh-CN': expect.any(String), 'en-US': expect.any(String) })
  })

  it('does nothing when the queue is empty — no parse, no body fetch, no model call', async () => {
    const { run, normalizeRawRecords, enqueued } = harness({ pending: 0 })

    await run()

    expect(normalizeRawRecords).not.toHaveBeenCalled()
    expect(enqueued).toHaveLength(0)
  })

  it('drains one batch when records are waiting, and hands the new items downstream', async () => {
    // 0.4.5 #44 的事故：采集全部命中去重时归一化整段不动，读者不重启就看不到积压的新闻。
    const { run, normalizeRawRecords, enqueued } = harness({
      pending: 121,
      normalize: async () => normalizeResult({
        processedCount: 56,
        queuedJobs: [INTELLIGENCE_ENRICH_NEWS_DOCUMENTS_JOB],
        newItemIds: ['item-a', 'item-b']
      })
    })

    const context = await run()

    expect(normalizeRawRecords).toHaveBeenCalledTimes(1)
    // 全局回捞不带 sourceId：这一轮是「把队列往前推」，不是某个源的采集后续。
    expect(normalizeRawRecords).toHaveBeenCalledWith({})
    expect(enqueued).toHaveLength(1)
    expect(enqueued[0]).toMatchObject({
      handlerId: INTELLIGENCE_ENRICH_NEWS_DOCUMENTS_JOB,
      payload: { itemIds: ['item-a', 'item-b'] }
    })
    expect(context.log).toHaveBeenCalledTimes(1)
    expect(JSON.stringify((context.log as unknown as { mock: { calls: unknown[][] } }).mock.calls))
      .toContain('56 processed')
  })

  it('arms its own schedule on registration, so a restart brings the recovery back', () => {
    const { schedules } = harness({ pending: 0 })

    expect(schedules).toHaveLength(1)
    expect(schedules[0]).toMatchObject({ handlerId: INTELLIGENCE_RECOVER_PENDING_RAW_RECORDS_JOB })
  })
})
