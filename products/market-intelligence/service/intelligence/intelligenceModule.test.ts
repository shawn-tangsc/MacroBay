import { createHash } from 'node:crypto'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const testUserData = join(tmpdir(), 'market-intelligence-module-test')

function moduleHistoryPayload() {
  return ['2026-08-12', '2026-08-13', '2026-08-14', '2026-08-15', '2026-08-16', '2026-08-17', '2026-08-18'].map((tradingDate, index) => ({
    date: String(Date.parse(`${tradingDate}T00:00:00.000Z`) / 1_000),
    totalCirculating: { peggedUSD: 100 + index },
    totalCirculatingUSD: { peggedUSD: 100 + index }
  }))
}

vi.mock('electron', () => ({
  app: { getPath: () => testUserData },
  net: { fetch: vi.fn(async () => new Response('{}', { status: 200 })) }
}))

import { createJobRuntime } from '@platform/jobs'

import { getIntelligenceModule, resetIntelligenceModuleForTests } from './intelligenceModule'
import { intelligenceCollectJobId } from './application/sourceRuntimeOrchestrator'
import { INTELLIGENCE_NORMALIZE_RAW_RECORDS_JOB } from './jobs/intelligenceJobIds'
import { RECOVER_MARKET_ANALYSIS_RUNS_JOB, GROUP_MARKET_ANALYSIS_CHANGE_JOB, FREEZE_MARKET_ANALYSIS_SNAPSHOT_JOB, RUN_MARKET_ANALYSIS_JOB, VERIFY_MARKET_ANALYSIS_PREDICTIONS_JOB } from './jobs/marketAnalysisJobIds'
import { access } from 'node:fs/promises'

beforeEach(async () => {
  resetIntelligenceModuleForTests()
  // Scheduled work from the previous test can still be finishing; retry the directory removal
  // instead of failing the next test with a transient ENOTEMPTY/ENOENT.
  await rm(testUserData, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
})

afterEach(async () => {
  resetIntelligenceModuleForTests()
  await rm(testUserData, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
})

describe('intelligence module calendar evidence composition', () => {
  // 全量并发跑时这个用例会超过 vitest 默认的 5s（它要初始化整个模块并读真实文件），
  // 单独跑却是毫秒级；给足时间，避免把 CI 变成随机红。
  it('arms the market-analysis runtime and its startup work only once the capability is enabled', { timeout: 20_000 }, async () => {
    const jobRuntime = createJobRuntime()
    const module = getIntelligenceModule(jobRuntime)

    // Off by default: nothing is scheduled and no startup job is queued, so an install that never
    // turned the capability on cannot spend a model call.
    await vi.waitFor(() => expect(jobRuntime.listSchedules().some(definition => definition.id === RECOVER_MARKET_ANALYSIS_RUNS_JOB)).toBe(false))
    expect(jobRuntime.listRuns({ handlerId: RECOVER_MARKET_ANALYSIS_RUNS_JOB })).toHaveLength(0)

    await module.marketAnalysisRuntime.updateSettings({ enabled: true, providerId: 'provider-1', modelId: 'model-1' })

    // The full suite runs many job/SQLite workers; the default 1s wait is too tight under load.
    await vi.waitFor(() => {
      expect(jobRuntime.listRuns({ handlerId: RECOVER_MARKET_ANALYSIS_RUNS_JOB })).toHaveLength(1)
    }, { timeout: 5_000, interval: 50 })
    expect(jobRuntime.listSchedules().map(definition => definition.id)).toEqual(expect.arrayContaining([
      RECOVER_MARKET_ANALYSIS_RUNS_JOB, VERIFY_MARKET_ANALYSIS_PREDICTIONS_JOB
    ]))
    expect(jobRuntime.listRuns({ handlerId: GROUP_MARKET_ANALYSIS_CHANGE_JOB })).toHaveLength(0)
    expect(jobRuntime.listRuns({ handlerId: FREEZE_MARKET_ANALYSIS_SNAPSHOT_JOB })).toHaveLength(0)
    expect(jobRuntime.listRuns({ handlerId: RUN_MARKET_ANALYSIS_JOB })).toHaveLength(0)
    expect(jobRuntime.listRuns({ handlerId: VERIFY_MARKET_ANALYSIS_PREDICTIONS_JOB })).toHaveLength(1)
  })

  it('exposes the main-process-only 0xRouter calendar evidence admission service without registering a calendar job', () => {
    const jobRuntime = createJobRuntime()
    const module = getIntelligenceModule(jobRuntime)

    expect(module.zeroXRouterCalendarEvidenceAdmission.listDescriptors().map((item) => item.descriptorId)).toEqual([
      'macro-calendar-0xrouter-economic-data',
      'macro-calendar-0xrouter-financial-events',
      'macro-calendar-0xrouter-central-bank-activities'
    ])
    expect(jobRuntime.listRuns().filter((run) => run.handlerId.includes('calendar'))).toEqual([])
  })

  it('uses the product-owned ETF SQLite state path', async () => {
    const dataDir = join(testUserData, 'products', 'market-intelligence')
    await mkdir(dataDir, { recursive: true })
    await writeFile(join(dataDir, 'intelligence-source-profiles.json'), JSON.stringify([{
      profileId: '0xrouter-profile', sourceId: '0xrouter-aggregate-provider', enabled: true,
      credentialRef: '0xrouter-aggregate-provider-credentials', collectionPreset: 'balanced', includeInSentiment: false,
      scopePolicy: 'all', rawArchiveEnabled: false, retentionMode: 'balanced', autoReplayAfterParserUpgrade: false,
      updatedAt: '2026-08-31T00:00:00.000Z'
    }]), 'utf8')
    const module = getIntelligenceModule(createJobRuntime())
    expect(module).toBeDefined()
    await expect(access(join(dataDir, 'etf-current-state.sqlite'))).resolves.toBeUndefined()
  })

  it('recovers a persisted generic fear-greed raw record through the registered product normalize job', async () => {
    const dataDir = await writePersistedFearGreedRawRecord({ processingState: 'received' })
    await writeFile(join(dataDir, 'intelligence-pipeline-state.json'), JSON.stringify({
      items: [], clusters: [], revisions: [], assessments: [], sentimentSignals: [], sentimentAggregates: [], metricEvents: [], impacts: [], updatedAt: '2026-08-19T00:00:00.000Z'
    }), 'utf8')
    const jobRuntime = createJobRuntime()
    const module = getIntelligenceModule(jobRuntime)

    expect(module.pipeline.listMetricEvents()).toHaveLength(0)
    await vi.waitFor(() => {
      expect(module.rawRecordStore.getRawRecord('raw-1')?.processingState).toBe('normalized')
      expect(module.pipeline.listMetricEvents()).toHaveLength(1)
    })
    const recoveryRuns = jobRuntime.listRuns({ handlerId: INTELLIGENCE_NORMALIZE_RAW_RECORDS_JOB })
    // 默认开启的源会让 source runtime 在启动时也排一轮 normalize，它可能还在排队/运行中，所以
    // 既不能锁死「恰好一条」，也不能依赖某一时刻的 run 状态。要守的是：启动恢复那一轮确实被排过
    // （owner/productId/payload 都对得上），并且同一条记录没有被处理两次（下面只断言一条指标）。
    expect(recoveryRuns).toEqual(expect.arrayContaining([
      expect.objectContaining({ owner: 'product', productId: 'market-intelligence', payload: {} })
    ]))
    await expect(module.publicQueryService.queryFearGreedSnapshot({ asOf: '2024-06-29T12:00:00.000Z' })).resolves.toMatchObject({
      state: 'available', score: 22
    })
  })

  it('recovers generic parsed records but does not replay normalized records', async () => {
    await writePersistedFearGreedRawRecords([
      persistedFearGreedRawRecord('raw-1', 'parsed'),
      persistedFearGreedRawRecord('raw-2', 'normalized')
    ])
    const module = getIntelligenceModule(createJobRuntime())

    await vi.waitFor(() => {
      expect(module.rawRecordStore.getRawRecord('raw-1')?.processingState).toBe('normalized')
      expect(module.pipeline.listMetricEvents()).toHaveLength(1)
    })
    expect(module.rawRecordStore.getRawRecord('raw-2')?.processingState).toBe('normalized')
  })

  it('completes pending raw recovery before scheduling initial source collection', async () => {
    await writePersistedFearGreedRawRecord({ processingState: 'received' })
    const dataDir = join(testUserData, 'products', 'market-intelligence')
    await writeFile(join(dataDir, 'intelligence-source-profiles.json'), JSON.stringify([{
      profileId: 'alternative-profile', sourceId: 'alternative-fear-greed', enabled: true,
      collectionPreset: 'balanced', includeInSentiment: false, scopePolicy: 'all', rawArchiveEnabled: false,
      retentionMode: 'balanced', autoReplayAfterParserUpgrade: false, updatedAt: '2026-08-24T03:20:00.000Z'
    }]), 'utf8')
    const jobRuntime = createJobRuntime()
    const releaseNormalize = deferred<void>()
    const normalizeEntered = deferred<void>()
    const registerHandler = jobRuntime.registerHandler.bind(jobRuntime)
    vi.spyOn(jobRuntime, 'registerHandler').mockImplementation((handlerId, handler) => {
      registerHandler(handlerId, handlerId === INTELLIGENCE_NORMALIZE_RAW_RECORDS_JOB
        ? async (payload, context) => {
            normalizeEntered.resolve()
            await releaseNormalize.promise
            await handler(payload, context)
          }
        : handler)
    })

    const module = getIntelligenceModule(jobRuntime)

    await normalizeEntered.promise
    expect(jobRuntime.listRuns({ definitionId: intelligenceCollectJobId('alternative-fear-greed') })).toHaveLength(0)

    releaseNormalize.resolve()
    await vi.waitFor(() => {
      expect(module.rawRecordStore.getRawRecord('raw-1')?.processingState).toBe('normalized')
      expect(jobRuntime.listRuns({ definitionId: intelligenceCollectJobId('alternative-fear-greed') })).toHaveLength(1)
    })
    const sourceRun = jobRuntime.listRuns({ definitionId: intelligenceCollectJobId('alternative-fear-greed') })[0]
    await vi.waitFor(() => {
      expect(jobRuntime.getRun(sourceRun!.id)?.status).toMatch(/completed|failed|cancelled/)
    })
  })

  it('continues source startup after bounded pending raw recovery observation expires', async () => {
    await writePersistedFearGreedRawRecord({ processingState: 'received' })
    const dataDir = join(testUserData, 'products', 'market-intelligence')
    await writeFile(join(dataDir, 'intelligence-source-profiles.json'), JSON.stringify([{
      profileId: 'alternative-profile', sourceId: 'alternative-fear-greed', enabled: true,
      collectionPreset: 'balanced', includeInSentiment: false, scopePolicy: 'all', rawArchiveEnabled: false,
      retentionMode: 'balanced', autoReplayAfterParserUpgrade: false, updatedAt: '2026-08-24T03:20:00.000Z'
    }]), 'utf8')
    vi.useFakeTimers()
    try {
      const jobRuntime = createJobRuntime()
      const normalizeEntered = deferred<void>()
      const registerHandler = jobRuntime.registerHandler.bind(jobRuntime)
      vi.spyOn(jobRuntime, 'registerHandler').mockImplementation((handlerId, handler) => {
        registerHandler(handlerId, handlerId === INTELLIGENCE_NORMALIZE_RAW_RECORDS_JOB
          ? async () => {
              normalizeEntered.resolve()
              await new Promise<void>(() => undefined)
            }
          : handler)
      })

      const module = getIntelligenceModule(jobRuntime)

      await normalizeEntered.promise
      await vi.advanceTimersByTimeAsync(60_000)

      await vi.waitFor(() => {
        expect(jobRuntime.listRuns({ definitionId: intelligenceCollectJobId('alternative-fear-greed') })).toHaveLength(1)
      })
      expect(module.rawRecordStore.getRawRecord('raw-1')?.processingState).toBe('received')
      jobRuntime.stopAll()
    } finally {
      vi.useRealTimers()
    }
  })

  it('continues source startup when pending raw recovery fails without changing the raw record state', async () => {
    await writePersistedFearGreedRawRecord({ processingState: 'received' })
    const dataDir = join(testUserData, 'products', 'market-intelligence')
    await writeFile(join(dataDir, 'intelligence-source-profiles.json'), JSON.stringify([{
      profileId: 'alternative-profile', sourceId: 'alternative-fear-greed', enabled: true,
      collectionPreset: 'balanced', includeInSentiment: false, scopePolicy: 'all', rawArchiveEnabled: false,
      retentionMode: 'balanced', autoReplayAfterParserUpgrade: false, updatedAt: '2026-08-24T03:20:00.000Z'
    }]), 'utf8')
    const jobRuntime = createJobRuntime()
    const registerHandler = jobRuntime.registerHandler.bind(jobRuntime)
    vi.spyOn(jobRuntime, 'registerHandler').mockImplementation((handlerId, handler) => {
      registerHandler(handlerId, handlerId === INTELLIGENCE_NORMALIZE_RAW_RECORDS_JOB
        ? async () => {
            throw new Error('recovery handler failed')
          }
        : handler)
    })

    const module = getIntelligenceModule(jobRuntime)

    await vi.waitFor(() => {
      expect(jobRuntime.listRuns({ definitionId: intelligenceCollectJobId('alternative-fear-greed') })).toHaveLength(1)
      expect(jobRuntime.listRuns({ handlerId: INTELLIGENCE_NORMALIZE_RAW_RECORDS_JOB })[0]?.status).toBe('failed')
    })
    expect(module.rawRecordStore.getRawRecord('raw-1')?.processingState).toBe('received')
  })

  it('does not let recovery enqueue failure block saved source runtime recovery', async () => {
    const dataDir = join(testUserData, 'products', 'market-intelligence')
    await mkdir(dataDir, { recursive: true })
    await writeFile(join(dataDir, 'intelligence-source-profiles.json'), JSON.stringify([{
      profileId: 'alternative-profile', sourceId: 'alternative-fear-greed', enabled: true,
      collectionPreset: 'balanced', includeInSentiment: false, scopePolicy: 'all', rawArchiveEnabled: false,
      retentionMode: 'balanced', autoReplayAfterParserUpgrade: false, updatedAt: '2026-08-19T00:00:00.000Z'
    }]), 'utf8')
    const jobRuntime = createJobRuntime()
    const enqueueDefinition = vi.spyOn(jobRuntime, 'enqueueDefinition')
    enqueueDefinition.mockRejectedValueOnce(new Error('startup enqueue failed'))

    getIntelligenceModule(jobRuntime)

    await vi.waitFor(() => {
      expect(jobRuntime.listRuns({ definitionId: intelligenceCollectJobId('alternative-fear-greed') })).toHaveLength(1)
    })
    expect(enqueueDefinition).toHaveBeenCalledWith(expect.objectContaining({
      owner: 'product', productId: 'market-intelligence', handlerId: INTELLIGENCE_NORMALIZE_RAW_RECORDS_JOB,
      trigger: { kind: 'startup' }, payload: {}
    }))
  })

  it('registers handlers before startup recovery restores a persisted capital schedule', async () => {
    const dataDir = join(testUserData, 'products', 'market-intelligence')
    await mkdir(dataDir, { recursive: true })
    await writeFile(join(dataDir, 'intelligence-source-profiles.json'), JSON.stringify([{
      profileId: 'defillama-stablecoins-profile', sourceId: 'defillama-stablecoins', enabled: true,
      collectionPreset: 'balanced', includeInSentiment: false, scopePolicy: 'all', rawArchiveEnabled: false,
      retentionMode: 'balanced', autoReplayAfterParserUpgrade: false, updatedAt: '2026-08-19T00:00:00.000Z'
    }]), 'utf8')
    const platformFetch = vi.fn(async (endpoint: string) => new Response(JSON.stringify(endpoint.includes('stablecoincharts') ? moduleHistoryPayload() : { peggedAssets: [
      { id: '1', symbol: 'USDT', pegType: 'peggedUSD', pegMechanism: 'fiat-backed', circulating: { peggedUSD: 200 }, circulatingPrevDay: { peggedUSD: 190 }, circulatingPrevWeek: { peggedUSD: 190 }, circulatingPrevMonth: { peggedUSD: 180 } },
      { id: '2', symbol: 'USDC', pegType: 'peggedUSD', pegMechanism: 'fiat-backed', circulating: { peggedUSD: 110 }, circulatingPrevDay: { peggedUSD: 110 }, circulatingPrevWeek: { peggedUSD: 110 }, circulatingPrevMonth: { peggedUSD: 100 } }
    ] }), { status: 200, headers: { 'content-type': 'application/json' } }))
    const jobRuntime = createJobRuntime()

    getIntelligenceModule(jobRuntime, { platformFetch })

    await vi.waitFor(() => {
      expect(jobRuntime.listRuns({ definitionId: intelligenceCollectJobId('defillama-stablecoins') })).toHaveLength(1)
    })
    expect(platformFetch).toHaveBeenCalledTimes(2)
  })

  it('uses the bootstrap-injected platform fetch for the enabled capital collector', async () => {
    const dataDir = join(testUserData, 'products', 'market-intelligence')
    await mkdir(dataDir, { recursive: true })
    await writeFile(join(dataDir, 'intelligence-source-profiles.json'), JSON.stringify([{
      profileId: 'defillama-stablecoins-profile', sourceId: 'defillama-stablecoins', enabled: true,
      collectionPreset: 'manual', includeInSentiment: false, scopePolicy: 'all', rawArchiveEnabled: false,
      retentionMode: 'balanced', autoReplayAfterParserUpgrade: false, updatedAt: '2026-08-18T00:00:00.000Z'
    }]), 'utf8')
    const platformFetch = vi.fn(async (endpoint: string) => new Response(JSON.stringify(endpoint.includes('stablecoincharts') ? moduleHistoryPayload() : { peggedAssets: [
      { id: '1', symbol: 'USDT', pegType: 'peggedUSD', pegMechanism: 'fiat-backed', circulating: { peggedUSD: 200 }, circulatingPrevDay: { peggedUSD: 190 }, circulatingPrevWeek: { peggedUSD: 190 }, circulatingPrevMonth: { peggedUSD: 180 } },
      { id: '2', symbol: 'USDC', pegType: 'peggedUSD', pegMechanism: 'fiat-backed', circulating: { peggedUSD: 110 }, circulatingPrevDay: { peggedUSD: 110 }, circulatingPrevWeek: { peggedUSD: 110 }, circulatingPrevMonth: { peggedUSD: 100 } }
    ] }), {
      status: 200, headers: { 'content-type': 'application/json' }
    }))
    const module = getIntelligenceModule(createJobRuntime(), { platformFetch })

    await expect(module.capitalConditions.refresh()).resolves.toEqual({ state: 'updated' })
    expect(platformFetch).toHaveBeenCalledTimes(2)
  })

  it('migrates legacy inline calendar evidence before exposing the one archive owner', async () => {
    const dataDir = join(testUserData, 'products', 'market-intelligence')
    const body = '<html>official calendar</html>'
    const payloadHash = createHash('sha256').update(body, 'utf8').digest('hex')
    await mkdir(dataDir, { recursive: true })
    await writeFile(join(dataDir, 'intelligence-raw-records.json'), JSON.stringify({
      sequence: 1,
      records: [{
        rawRecordId: 'raw-1', sourceId: 'macro-calendar-fed-schedule', runId: 'run-1',
        sourceUrl: 'https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm',
        detectedAt: '2026-08-12T00:00:00.000Z', payloadFormat: 'html', payloadRefType: 'inline',
        payloadBody: body, payloadSizeBytes: Buffer.byteLength(body), payloadHash,
        sourceDedupeKey: payloadHash, processingOwner: 'macro-calendar', processingState: 'received',
        parserVersion: 'test-v1', storageTier: 'hot', archiveStatus: 'none'
      }]
    }), 'utf8')

    const module = getIntelligenceModule(createJobRuntime())
    const record = module.rawRecordStore.getRawRecord('raw-1')!

    expect(module.macroCalendarEvidenceReady).toBe(true)
    expect(module.macroCalendarEvidenceArchive.readBody(record)).toBe(body)
    expect(record).toMatchObject({ payloadRefType: 'file', payloadBody: undefined, archiveStatus: 'archived' })
    expect(JSON.parse(await readFile(join(dataDir, 'intelligence-raw-records.json'), 'utf8')).records[0]).not.toHaveProperty('payloadBody')
  })

  it('keeps unrelated intelligence available and preserves inline evidence when migration is unavailable', async () => {
    const dataDir = join(testUserData, 'products', 'market-intelligence')
    const body = '<html>only calendar copy</html>'
    await mkdir(dataDir, { recursive: true })
    await writeFile(join(dataDir, 'intelligence-raw-records.json'), JSON.stringify({
      sequence: 1,
      records: [{
        rawRecordId: 'raw-1', sourceId: 'macro-calendar-fed-schedule', runId: 'run-1',
        sourceUrl: 'https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm',
        detectedAt: '2026-08-12T00:00:00.000Z', payloadFormat: 'html', payloadRefType: 'inline',
        payloadBody: body, payloadSizeBytes: Buffer.byteLength(body), payloadHash: 'mismatched-hash',
        sourceDedupeKey: 'mismatched-hash', processingOwner: 'macro-calendar', processingState: 'received',
        parserVersion: 'test-v1', storageTier: 'hot', archiveStatus: 'none'
      }]
    }), 'utf8')

    const module = getIntelligenceModule(createJobRuntime())

    expect(module.macroCalendarEvidenceReady).toBe(false)
    expect(module.rawRecordStore.getRawRecord('raw-1')?.payloadBody).toBe(body)
    expect(module.pipeline).toBeTruthy()
  })
})

async function writePersistedFearGreedRawRecord(input: { processingState: 'received' | 'parsed' | 'normalized' }): Promise<string> {
  return writePersistedFearGreedRawRecords([persistedFearGreedRawRecord('raw-1', input.processingState)])
}

async function writePersistedFearGreedRawRecords(records: object[]): Promise<string> {
  const dataDir = join(testUserData, 'products', 'market-intelligence')
  await mkdir(dataDir, { recursive: true })
  await writeFile(join(dataDir, 'intelligence-raw-records.json'), JSON.stringify({ sequence: records.length, records }), 'utf8')
  return dataDir
}

function persistedFearGreedRawRecord(rawRecordId: string, processingState: 'received' | 'parsed' | 'normalized') {
  return {
    rawRecordId,
    sourceId: 'alternative-fear-greed',
    runId: `interrupted-${rawRecordId}`,
    detectedAt: '2024-06-29T00:00:00.000Z',
    payloadFormat: 'json',
    payloadRefType: 'inline',
    payloadBody: '{"name":"Fear and Greed Index","data":[{"value":"22","value_classification":"Extreme Fear","timestamp":"1719619200"}]}',
    payloadHash: `fixture-hash-${rawRecordId}`,
    sourceDedupeKey: `fixture-dedupe-${rawRecordId}`,
    processingOwner: 'generic-intelligence',
    processingState,
    parserVersion: 'metric-rest-api-v1',
    storageTier: 'hot',
    archiveStatus: 'none'
  }
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve
  })
  return { promise, resolve }
}
