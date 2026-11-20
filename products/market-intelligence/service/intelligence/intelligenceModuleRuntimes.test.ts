import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/intelligence-module-runtimes-test' },
  net: { fetch: vi.fn(async () => new Response('{}', { status: 200 })) }
}))

import { createJobRuntime } from '@platform/jobs'
import { net } from 'electron'

import { createIntelligenceStores } from './intelligenceModuleStores'
import { createIntelligenceMarketData } from './intelligenceModuleMarketData'
import { createIntelligenceNewsSentiment } from './intelligenceModuleNewsSentiment'
import { createIntelligenceRuntimes } from './intelligenceModuleRuntimes'

/**
 * M5 抽出来的这一段自己的用例（2026-11-15 拆分 `intelligenceModule.ts`）。
 *
 * 这一段搬的是「装配完跑起来」那半，其中**唯一会静默坏掉的是读者重建舆情库那条闭包**：
 * 它要同时做四件事——清库或换库、把四件服务接回出口、换掉作业依赖、重新接公共查询。
 * 少做最后两件不会报错，只是重建之后分析读到的还是旧库、作业还打旧服务。
 *
 * 判据因此不是「函数在」，而是**重建之后出口仍然是可用的、且能连续重建**（幂等）：
 * - 组装完就**不再是** H 段那个「存储不可用」占位（说明闭包真的接上了）；
 * - 健康库时重建返回 `{}`，两次结果一致；
 * - 重建后 `query` 仍可用——「接回所有出口」这一句的可见事实。
 */
const directories: string[] = []

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'mi-runtimes-'))
  directories.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of directories) rmSync(dir, { recursive: true, force: true })
  directories.length = 0
})

function assemble(dataDir: string) {
  const stores = createIntelligenceStores({
    dataDir,
    getAppLanguage: async () => 'zh-CN' as const,
    timeZone: () => 'UTC'
  })
  const marketData = createIntelligenceMarketData({
    jobRuntime: createJobRuntime(),
    dataDir,
    profileStore: stores.profileStore,
    credentialStore: stores.credentialStore,
    pipeline: stores.pipeline,
    macroMarketStore: stores.macroMarketStore,
    macroCalendarEvidenceArchive: stores.macroCalendarEvidenceArchive,
    platformFetch: net.fetch as never,
    timeZone: () => 'UTC'
  })
  const newsSentiment = createIntelligenceNewsSentiment({
    dataDir,
    pipeline: stores.pipeline,
    translationService: {} as never,
    translationStorage: stores.translationStorage,
    structuredModelInvocation: { invoke: async () => ({}) } as never,
    getAppLanguage: async () => 'zh-CN' as const,
    profileStore: stores.profileStore,
    hooks: { platformFetch: net.fetch, getTimeZone: () => 'UTC' } as never
  })
  const jobRuntime = createJobRuntime()
  const runtimes = createIntelligenceRuntimes({
    jobRuntime,
    dataDir,
    timeZone: () => 'UTC',
    getAppLanguage: async () => 'zh-CN' as const,
    pipeline: stores.pipeline,
    rawRecordStore: stores.rawRecordStore,
    translationService: {} as never,
    capitalConditions: marketData.capitalConditions,
    capitalConditionsQuery: marketData.capitalConditionsQuery,
    fundingRateHistoryStore: marketData.fundingRateHistoryStore,
    perpetualPositioningStore: marketData.perpetualPositioningStore,
    etfCurrentStateRefresh: marketData.etfCurrentStateRefresh,
    fundingRateHistoryRefresh: marketData.fundingRateHistoryRefresh,
    openInterestWithSignals: marketData.openInterestWithSignals,
    newsSentiment,
    profileStore: stores.profileStore,
    workerRuntime: { listWorkers: () => [] } as never,
    credentialStore: stores.credentialStore,
    requestGovernanceQueue: marketData.requestGovernanceQueue,
    structuredModelInvocation: { invoke: async () => ({}) } as never,
    hooks: { platformFetch: net.fetch, getTimeZone: () => 'UTC' } as never
  })
  return { runtimes, newsSentiment }
}

describe('intelligenceModule 运行时段', () => {
  it('组装后重建入口真的接上了：不再抛「存储不可用」，健康库返回 {}，两次一致', async () => {
    const { runtimes, newsSentiment } = assemble(tempDir())
    expect(runtimes.publicQueryService).toBeTruthy()
    expect(runtimes.marketAnalysisRuntime).toBeTruthy()
    expect(runtimes.sourcesService).toBeTruthy()
    expect(runtimes.archiveService).toBeTruthy()
    expect(runtimes.replayService).toBeTruthy()

    // H 段里它是占位：`throw news-sentiment-storage-unavailable`。M5 接上之后就**不该**再抛。
    expect(() => newsSentiment.newsSentimentExposure.rebuildStorage()).not.toThrow()
    expect(newsSentiment.newsSentimentExposure.rebuildStorage()).toEqual({})
    // 幂等：连着重建两次结果一致（库在时走「清空重抓」那一支）。
    expect(newsSentiment.newsSentimentExposure.rebuildStorage()).toEqual({})
    // 「把四件服务接回出口」的可见事实：重建后查询仍然可用。
    expect(newsSentiment.newsSentimentExposure.query).toBeTruthy()
    expect(typeof newsSentiment.newsSentimentExposure.query!.query).toBe('function')
  })
})
