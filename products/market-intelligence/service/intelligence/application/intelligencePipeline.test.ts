import { readFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path, { join } from 'node:path'

import { describe, expect, it, vi } from 'vitest'

import { createJobRuntime } from '@platform/jobs'
import { createEventBusJsonStorage, createEventBusRuntime } from '@platform/message-bus'
import { createEventBusStore } from '@platform/message-bus/store/eventBusStore'

import { createIntelligencePipeline, EMPTY_SOURCE_COLLECTION_COUNTS } from './intelligencePipeline'
import { createRawRecordStore } from './rawRecordStore'
import { getIntelligenceSourceDefinition } from './sourceCatalog'
import { createDefaultSourceProfile, resolveAndValidateRuntimeConfig } from './sourceRuntimeConfig'
import { createInMemoryProfileStorage, createSourceProfileStore } from './sourceProfileStore'
import { registerIntelligenceJobs } from '../jobs/registerIntelligenceJobs'
import { createMarketIntelligencePublicQueryService } from '../public-query/publicQueryService'
import { INTELLIGENCE_EVENT_TOPICS } from '../schema/intelligenceEvents'
import { createIntelligenceEventPublisher } from './intelligenceEventPublisher'

describe('intelligencePipeline', () => {
  it('does not expose macro-calendar records through generic summary and replay inputs', () => {
    const rawRecordStore = createRawRecordStore()
    const macro = rawRecordStore.appendRawRecord({
      sourceId: 'macro-calendar-bls', runId: 'macro-run', sourceDedupeKey: 'macro-1', payloadFormat: 'json',
      payloadRefType: 'inline', payloadBody: 'macro-payload', payloadHash: 'macro-hash', parserVersion: 'fixture-v1', processingOwner: 'macro-calendar'
    })!
    const pipeline = createIntelligencePipeline({ rawRecordStore })

    expect(pipeline.listRawRecordSummaries()).not.toEqual(expect.arrayContaining([expect.objectContaining({ rawRecordId: macro.rawRecordId })]))
  })

  it("hands a parsed metric payload's whole window to the product history sink", async () => {
    const rawRecordStore = createRawRecordStore()
    const windows: { sourceId: string; payloadBody?: string; payloadMetaJson?: string }[] = []
    const pipeline = createIntelligencePipeline({
      rawRecordStore,
      onMetricWindow: (input) => { windows.push(input) }
    })
    const payloadBody = JSON.stringify({
      observations: [{ date: '2026-11-10', value: '4.73' }, { date: '2026-11-09', value: '4.56' }]
    })
    const payloadMetaJson = JSON.stringify({ seriesId: 'DGS2', metricKey: 'US_2Y_YIELD' })
    rawRecordStore.appendRawRecord({
      sourceId: 'fred-rates-liquidity', runId: 'run-fred', sourceDedupeKey: 'fred-window-1', payloadFormat: 'json',
      payloadRefType: 'inline', payloadBody, payloadHash: 'fred-window-hash', parserVersion: 'metric-rest-api-v1',
      payloadMetaJson
    })

    await pipeline.normalizeRawRecords({ sourceId: 'fred-rates-liquidity' })

    // The window is handed over once, verbatim: the sink parses the provider's bytes, not a shape the
    // pipeline flattened to the newest observation.
    expect(windows).toHaveLength(1)
    expect(windows[0]).toEqual({ sourceId: 'fred-rates-liquidity', payloadBody, payloadMetaJson })
  })

  it('rejects retired DeFiLlama stablecoins before generic raw or health side effects', async () => {
    const rawRecordStore = createRawRecordStore()
    const pipeline = createIntelligencePipeline({ rawRecordStore })

    await expect(pipeline.collectSource({
      sourceId: 'defillama-stablecoins',
      runId: 'retired-source-run',
      fixtureText: '{"peggedAssets":[]}'
    })).resolves.toEqual({ queuedJobs: [], counts: EMPTY_SOURCE_COLLECTION_COUNTS })

    expect(rawRecordStore.inspectSnapshot().recordCount).toBe(0)
    expect(pipeline.getHealth('defillama-stablecoins')).toBeUndefined()
  })

  it('does not hydrate or expose retired DeFiLlama stablecoin runtime state through generic health views', () => {
    const legacy = runtimeState({
      resourceId: 'defillama-stablecoins',
      status: 'failed',
      consecutiveFailures: 2,
      updatedAt: '2026-08-18T09:00:00.000Z',
      lastFailureAt: '2026-08-18T09:00:00.000Z'
    })
    const neighbor = runtimeState({
      resourceId: 'coindesk-rss',
      updatedAt: '2026-08-18T09:01:00.000Z',
      lastSuccessAt: '2026-08-18T09:01:00.000Z'
    })
    const pipeline = createIntelligencePipeline({
      runtimeStateSnapshot: [legacy, neighbor],
      runtimeStateHistorySnapshot: [legacy, neighbor]
    })

    expect(pipeline.getHealth('defillama-stablecoins')).toBeUndefined()
    expect(pipeline.getHealth('coindesk-rss')?.lastSuccessAt).toBe(neighbor.lastSuccessAt)
    expect(pipeline.listRuntimeStates().map((state) => state.resourceId)).toEqual(['coindesk-rss'])
    expect(pipeline.listRuntimeStatesAsOf('2026-08-18T10:00:00.000Z').map((state) => state.resourceId)).toEqual([
      'coindesk-rss'
    ])
  })

  it('does not let a direct retired stablecoin connectivity probe write generic runtime health', async () => {
    const snapshotWrites: import('@platform/jobs').RuntimeStateRecord[][] = []
    const historyWrites: import('@platform/jobs').RuntimeStateRecord[][] = []
    const pipeline = createIntelligencePipeline({
      runtimeStateStorage: { readAll: async () => [], writeAll: async (records) => { snapshotWrites.push(records) } },
      runtimeStateHistoryStorage: { readAll: async () => [], writeAll: async (records) => { historyWrites.push(records) } }
    })

    pipeline.reportConnectivityProbe('defillama-stablecoins', { ok: false, message: 'legacy probe' })
    await Promise.resolve()

    expect(pipeline.getHealth('defillama-stablecoins')).toBeUndefined()
    expect(pipeline.listRuntimeStates()).toEqual([])
    expect(pipeline.listRuntimeStatesAsOf('2026-08-18T10:00:00.000Z')).toEqual([])
    expect(snapshotWrites).toEqual([])
    expect(historyWrites).toEqual([])
  })

  it('retains hydrated retired stablecoin runtime records inertly when a neighboring source persists health', async () => {
    const legacy = runtimeState({
      resourceId: 'defillama-stablecoins',
      status: 'failed',
      consecutiveFailures: 2,
      updatedAt: '2026-08-18T09:00:00.000Z',
      lastFailureAt: '2026-08-18T09:00:00.000Z'
    })
    const neighbor = runtimeState({
      resourceId: 'coindesk-rss',
      updatedAt: '2026-08-18T09:01:00.000Z',
      lastSuccessAt: '2026-08-18T09:01:00.000Z'
    })
    const snapshotWrites: import('@platform/jobs').RuntimeStateRecord[][] = []
    const historyWrites: import('@platform/jobs').RuntimeStateRecord[][] = []
    const pipeline = createIntelligencePipeline({
      runtimeStateSnapshot: [legacy, neighbor],
      runtimeStateHistorySnapshot: [legacy, neighbor],
      runtimeStateStorage: { readAll: async () => [], writeAll: async (records) => { snapshotWrites.push(records) } },
      runtimeStateHistoryStorage: { readAll: async () => [], writeAll: async (records) => { historyWrites.push(records) } }
    })

    pipeline.reportConnectivityProbe('coindesk-rss', { ok: true, message: 'neighbor probe' })
    await waitForRuntimeWrite(snapshotWrites)

    expect(snapshotWrites).toHaveLength(1)
    expect(historyWrites).toHaveLength(1)
    expect(snapshotWrites[0]).toEqual(expect.arrayContaining([legacy, expect.objectContaining({ resourceId: 'coindesk-rss' })]))
    expect(historyWrites[0]).toEqual(expect.arrayContaining([legacy, expect.objectContaining({ resourceId: 'coindesk-rss' })]))
    expect(pipeline.getHealth('defillama-stablecoins')).toBeUndefined()
    expect(pipeline.listRuntimeStates().map((state) => state.resourceId)).toEqual(['coindesk-rss'])
    expect(pipeline.getHealth('coindesk-rss')?.lastRunSummary).toBe('neighbor probe')
  })

  it('filters retired DeFiLlama stablecoin raw records before applying the generic normalization limit', async () => {
    const rawRecordStore = createRawRecordStore()
    rawRecordStore.appendRawRecord({
      sourceId: 'defillama-stablecoins',
      runId: 'legacy-run',
      sourceDedupeKey: 'retired-first',
      payloadFormat: 'json',
      payloadRefType: 'inline',
      payloadBody: '{"peggedAssets":[]}',
      payloadHash: 'retired-hash',
      parserVersion: 'metric-rest-api-v1'
    })
    rawRecordStore.appendRawRecord({
      sourceId: 'alternative-fear-greed',
      runId: 'neighbor-run',
      sourceDedupeKey: 'neighbor-second',
      payloadFormat: 'json',
      payloadRefType: 'inline',
      payloadBody: loadFixture('fear-greed-sample.json'),
      payloadHash: 'neighbor-hash',
      parserVersion: 'metric-rest-api-v1'
    })
    const pipeline = createIntelligencePipeline({ rawRecordStore })

    const result = await pipeline.normalizeRawRecords({ limit: 1 })

    expect(result.processedCount).toBe(1)
    expect(pipeline.listItems()).toHaveLength(1)
    expect(rawRecordStore.getRawRecord('raw-1')?.processingState).toBe('received')
  })

  it('does not project retired stablecoin legacy outputs or aggregates supported by them', () => {
    const pipeline = createIntelligencePipeline({
      snapshot: {
        items: [
          { itemId: 'retired-item', sourceId: 'defillama-stablecoins' },
          { itemId: 'neighbor-item', sourceId: 'alternative-fear-greed' }
        ],
        clusters: [],
        revisions: [{ itemId: 'retired-item' }, { itemId: 'neighbor-item' }],
        assessments: [{ itemId: 'retired-item' }, { itemId: 'neighbor-item' }],
        sentimentSignals: [
          { itemId: 'retired-item', impactId: 'retired-impact' },
          { itemId: 'neighbor-item', impactId: 'neighbor-impact' }
        ],
        sentimentAggregates: [
          { aggregateId: 'retired-support', supportingItemIdsJson: '["retired-item","neighbor-item"]', supportingImpactIdsJson: '["retired-impact"]' },
          { aggregateId: 'neighbor-only', supportingItemIdsJson: '["neighbor-item"]', supportingImpactIdsJson: '["neighbor-impact"]' }
        ],
        metricEvents: [{ itemId: 'retired-item' }, { itemId: 'neighbor-item' }],
        impacts: [{ impactId: 'retired-impact', itemId: 'retired-item' }, { impactId: 'neighbor-impact', itemId: 'neighbor-item' }],
        updatedAt: '2026-08-18T00:00:00.000Z'
      } as never
    })

    expect(pipeline.listItems().map((item) => item.itemId)).toEqual(['neighbor-item'])
    expect(pipeline.listRevisions().map((revision) => revision.itemId)).toEqual(['neighbor-item'])
    expect(pipeline.listAssessments().map((assessment) => assessment.itemId)).toEqual(['neighbor-item'])
    expect(pipeline.listMetricEvents().map((metric) => metric.itemId)).toEqual(['neighbor-item'])
    expect(pipeline.listImpacts().map((impact) => impact.itemId)).toEqual(['neighbor-item'])
    expect(pipeline.listSentimentAggregates().map((aggregate) => aggregate.aggregateId)).toEqual(['neighbor-only'])
  })

  it('keeps normalizing after one record throws, so a bad record cannot starve the queue', async () => {
    /* 2026-11-21 事故：`defillama-tvl` 每半小时抛一次 `missing TVL total`，而待办是按追加顺序取的，
       它一直排在最前面——后面的新闻记录永远轮不到归一化，enrich/score 从 11-19 起再没触发过，
       而每个采集任务都显示「成功」。一条坏记录只准记日志、留在待办里重试，不许挡住整队。 */
    const rawRecordStore = createRawRecordStore()
    const pipeline = createIntelligencePipeline({
      profileStore: createSourceProfileStore(createInMemoryProfileStorage()),
      rawRecordStore
    })
    const badRecord = rawRecordStore.appendRawRecord({
      sourceId: 'defillama-tvl', runId: 'run-bad', sourceDedupeKey: 'tvl-bad', payloadFormat: 'json',
      payloadRefType: 'inline', payloadBody: '[]', payloadHash: 'hash-bad', parserVersion: 'fixture-v1'
    })
    await pipeline.collectSource({ sourceId: 'coindesk-rss', runId: 'run-news', fixtureText: loadFixture('rss-sample.xml') })

    const result = await pipeline.normalizeRawRecords({})

    expect(result.failedCount).toBe(1)
    expect(result.processedCount).toBe(2)
    expect(result.queuedJobs).toContain('market-intelligence.enrichNewsDocuments')
    // 坏的记录转 `failed` 离开待办，原因码留在记录上：只隔离不挪队头的话，一轮 100 条全失败时
    // 下一轮捞回来的还是这 100 条，第 101 条永远轮不到。
    expect(rawRecordStore.listUnprocessed()).toHaveLength(0)
    const failedRecord = rawRecordStore.getRawRecord(badRecord!.rawRecordId)
    expect(failedRecord?.processingState).toBe('failed')
    expect(failedRecord?.errorMessage).toBe('MI_NORMALIZE_RECORD_FAILED')
  })

  it('persists a source normalize failure streak across rounds and collection successes', async () => {
    /* `normalize-failing` 判据读的是同源连续失败。采集成功会整份换 checkpoint；如果这里不把
       streak 带过去，每 30 分钟一次成功就把它清零，判据永远不可能成立。 */
    const rawRecordStore = createRawRecordStore({ readPayload: () => ({ state: 'missing' as const }) })
    const pipeline = createIntelligencePipeline({
      profileStore: createSourceProfileStore(createInMemoryProfileStorage()),
      rawRecordStore,
      runtimeStateSnapshot: [runtimeState({ resourceId: 'sec-rss' })]
    })
    for (let round = 0; round < 3; round += 1) {
      // 每轮一条新的坏记录：失败的记录已经离开待办（见上一条用例），生产里也是每 30 分钟新来一条。
      rawRecordStore.appendRawRecord({
        sourceId: 'sec-rss', runId: `run-gone-${round}`, sourceDedupeKey: `sec-gone-${round}`, payloadFormat: 'rss-item',
        payloadRefType: 'file', payloadFileRef: 'gone.bin', payloadHash: 'gone-hash', parserVersion: 'rss-v1'
      })
      await pipeline.normalizeRawRecords({ sourceId: 'sec-rss' })
    }

    const checkpointOf = () =>
      pipeline.listRuntimeStates().find((state) => state.resourceId === 'sec-rss')?.checkpoint as
        | Record<string, unknown>
        | undefined
    expect(checkpointOf()?.normalizeFailureStreak).toBe(3)
    expect(checkpointOf()?.firstNormalizeFailureAt).toEqual(expect.any(String))
    const firstFailureAt = checkpointOf()?.firstNormalizeFailureAt

    await pipeline.collectSource({ sourceId: 'sec-rss', runId: 'run-ok', fixtureText: loadFixture('rss-sample.xml') })

    expect(checkpointOf()?.normalizeFailureStreak).toBe(3)
    expect(checkpointOf()?.firstNormalizeFailureAt).toBe(firstFailureAt)
    // 新 checkpoint 确实写进去了（不是保留旧整份），只是归一化字段被带过来。
    expect(checkpointOf()?.parserVersion).toEqual(expect.any(String))
  })

  it('reads externalized payloads back before parsing, so file-ref records normalize (2026-11-21)', async () => {
    /* 原文外置后正文只在内容寻址文件里。读路径以前把 `payloadBody`（undefined）直接交给适配器，
       三个源以「解析失败」收场：`No RSS items found` / `HTML parser not implemented` /
       `missing TVL total`。夹具是当时库里的真实响应正文，不是按解析器口味拼的结构。 */
    const bodies: Record<string, string> = {
      'sec.bin': loadFixture('sec-rss-item-sample.json'),
      'binance.bin': loadFixture('binance-announcement-item-sample.json'),
      'defillama.bin': loadFixture('defillama-chains-sample.json')
    }
    const readPayload = vi.fn(({ fileRef }: { fileRef: string }) => ({ state: 'found' as const, body: bodies[fileRef]! }))
    const rawRecordStore = createRawRecordStore({ readPayload })
    const pipeline = createIntelligencePipeline({
      profileStore: createSourceProfileStore(createInMemoryProfileStorage()),
      rawRecordStore
    })
    const append = (sourceId: string, key: string, fileRef: string, payloadFormat: 'rss-item' | 'json', parserVersion: string) =>
      rawRecordStore.appendRawRecord({
        sourceId, runId: `run-${key}`, sourceDedupeKey: key, payloadFormat,
        payloadRefType: 'file', payloadFileRef: fileRef, payloadHash: `${key}-hash`, parserVersion
      })

    append('sec-rss', 'sec-1', 'sec.bin', 'rss-item', 'rss-v1')
    append('binance-announcements', 'binance-1', 'binance.bin', 'json', 'binance-announcements-v1')
    append('defillama-tvl', 'defillama-1', 'defillama.bin', 'json', 'metric-rest-api-v1')

    const result = await pipeline.normalizeRawRecords({})

    expect(result.failedCount).toBe(0)
    // 三个源都不再以解析失败收场；DefiLlama 是指标线（产出 metric event），新闻两条各成条目。
    expect(result.processedCount).toBeGreaterThanOrEqual(2)
    // 三条都过了解析：新闻条目带真实标题，DefiLlama 的 TVL 总和不再为 0。
    const titles = pipeline.listItems().map(item => item.title)
    // 解析这一步三条都过了；SEC 那条随后按产品规则被判 ignore（不进情报条目），不是解析失败。
    expect(titles).toEqual(expect.arrayContaining([
      expect.stringContaining('Binance Alpha Trading Competition'),
      'Chain TVL Total'
    ]))
    expect(rawRecordStore.listUnprocessed()).toHaveLength(0)
    expect(pipeline.listMetricEvents().some(event => event.sourceId === 'defillama-tvl')).toBe(true)
  })

  it('drains the queue after a whole round fails, so round two reaches the record behind it', async () => {
    /* 只把记录标成 failed 不够，要证「下一轮能捞到第 101 条」：一百条坏记录 + 一条排在最旧的好记录，
       第一轮把这 100 条按失败移出待办，第二轮就该轮到那条好记录。 */
    const rawRecordStore = createRawRecordStore({ readPayload: () => ({ state: 'missing' as const }) })
    const pipeline = createIntelligencePipeline({
      profileStore: createSourceProfileStore(createInMemoryProfileStorage()),
      rawRecordStore
    })
    // 五个源各 20 条，正好填满一轮（每源每轮上限 20 见 `normalizationBatchSelection`）。
    const badSources = ['binance-spot-market', 'alternative-fear-greed', 'defillama-tvl', 'fred-rates-liquidity', 'okx-api-announcements']
    for (const [sourceIndex, sourceId] of badSources.entries()) {
      for (let index = 0; index < 20; index += 1) {
        rawRecordStore.appendRawRecord({
          sourceId, runId: `run-bad-${sourceId}-${index}`, sourceDedupeKey: `bad-${sourceIndex}-${index}`,
          payloadFormat: 'json', payloadRefType: 'file', payloadFileRef: 'gone.bin', payloadHash: 'gone-hash',
          parserVersion: 'metric-rest-api-v1',
          detectedAt: `2026-11-21T07:${String(sourceIndex * 10 + index).padStart(2, '0')}:00.000Z`
        })
      }
    }
    rawRecordStore.appendRawRecord({
      sourceId: 'sec-rss', runId: 'run-good', sourceDedupeKey: 'sec-good', payloadFormat: 'rss-item',
      payloadRefType: 'inline', payloadBody: loadFixture('sec-rss-item-sample.json'), payloadHash: 'good-hash',
      parserVersion: 'rss-v1', detectedAt: '2026-11-19T20:14:59.000Z'
    })

    const firstRound = await pipeline.normalizeRawRecords({})
    expect(firstRound.failedCount).toBe(100)
    expect(rawRecordStore.listUnprocessed()).toHaveLength(1)

    const secondRound = await pipeline.normalizeRawRecords({})
    expect(secondRound.failedCount).toBe(0)
    expect(rawRecordStore.listUnprocessed()).toHaveLength(0)
  })

  it('counts an unreadable externalized payload as failed and never parses an empty body', async () => {
    const rawRecordStore = createRawRecordStore({ readPayload: () => ({ state: 'missing' as const }) })
    const pipeline = createIntelligencePipeline({
      profileStore: createSourceProfileStore(createInMemoryProfileStorage()),
      rawRecordStore
    })
    const goneRecord = rawRecordStore.appendRawRecord({
      sourceId: 'sec-rss', runId: 'run-gone', sourceDedupeKey: 'sec-gone', payloadFormat: 'rss-item',
      payloadRefType: 'file', payloadFileRef: 'gone.bin', payloadHash: 'gone-hash', parserVersion: 'rss-v1'
    })

    const result = await pipeline.normalizeRawRecords({})

    expect(result.failedCount).toBe(1)
    expect(result.processedCount).toBe(0)
    // 不把「读不到原文」当成「解析成功但 0 条」：记录转 failed 并带上原因码，不再占待办名额。
    expect(rawRecordStore.listUnprocessed()).toHaveLength(0)
    expect(rawRecordStore.getRawRecord(goneRecord!.rawRecordId)?.errorMessage).toBe('MI_NORMALIZE_PAYLOAD_UNREADABLE')
  })

  it('writes raw records before parsing and avoids duplicate items', async () => {
    const pipeline = createPipeline()
    const fixture = loadFixture('rss-sample.xml')

    await pipeline.collectSource({ sourceId: 'coindesk-rss', runId: 'run-1', fixtureText: fixture })
    const firstNormalize = await pipeline.normalizeRawRecords({ sourceId: 'coindesk-rss' })
    const secondNormalize = await pipeline.normalizeRawRecords({ sourceId: 'coindesk-rss' })

    expect(firstNormalize.processedCount).toBe(2)
    expect(secondNormalize.processedCount).toBe(0)
    expect(pipeline.listItems()).toHaveLength(2)
  })

  it('keeps concurrent Alternative and Binance collection normalize queues independent through public projection', async () => {
    const alternative = getIntelligenceSourceDefinition('alternative-fear-greed')!
    const spot = getIntelligenceSourceDefinition('binance-spot-market')!
    const profileStore = createSourceProfileStore(createInMemoryProfileStorage([
      { ...createDefaultSourceProfile(alternative), enabled: true },
      { ...createDefaultSourceProfile(spot), enabled: true }
    ]))
    const alternativePersistenceEntered = deferred<void>()
    const releaseAlternativePersistence = deferred<void>()
    const binanceFetchEntered = deferred<void>()
    const releaseBinanceFetch = deferred<void>()
    const pipeline = createIntelligencePipeline({
      profileStore,
      runtimeStateStorage: {
        readAll: async () => [],
        writeAll: async (records) => {
          if (records.some((record) => record.resourceId === alternative.sourceId)) {
            alternativePersistenceEntered.resolve()
            await releaseAlternativePersistence.promise
          }
        }
      },
      runtimeStateHistoryStorage: { readAll: async () => [], writeAll: async () => undefined },
      fetchText: async (url, sourceId) => {
        if (sourceId === alternative.sourceId) {
          return '{"name":"Fear and Greed Index","data":[{"value":"73","value_classification":"Greed","timestamp":"1787529600"}]}'
        }
        if (sourceId !== spot.sourceId) throw new Error('Unexpected text source.')
        binanceFetchEntered.resolve()
        await releaseBinanceFetch.promise
        const symbol = new URL(url).searchParams.get('symbol')
        return JSON.stringify({
          symbol,
          priceChangePercent: symbol === 'BTCUSDT' ? '1.5' : '-2.5',
          lastPrice: '100',
          closeTime: 1787529600000
        })
      }
    })
    const jobRuntime = createJobRuntime()
    registerIntelligenceJobs(jobRuntime, { pipeline })

    const alternativeRun = await jobRuntime.enqueueDefinition(collectDefinition(alternative.sourceId))
    await alternativePersistenceEntered.promise
    const binanceRun = await jobRuntime.enqueueDefinition(collectDefinition(spot.sourceId))
    await binanceFetchEntered.promise
    releaseAlternativePersistence.resolve()
    await vi.waitFor(() => expect(jobRuntime.getRun(alternativeRun.id)?.status).toBe('completed'))
    releaseBinanceFetch.resolve()

    await vi.waitFor(() => {
      expect(jobRuntime.getRun(binanceRun.id)?.status).toBe('completed')
      expect(jobRuntime.listRuns({ handlerId: 'market-intelligence.normalizeRawRecords' })).toHaveLength(2)
      expect(pipeline.listRawRecordSummaries()).toHaveLength(3)
      expect(pipeline.listRawRecordSummaries().every((record) => record.processingState === 'normalized')).toBe(true)
    })
    const publicQuery = createMarketIntelligencePublicQueryService({ pipeline })
    const asOf = new Date(Date.now() + 1_000).toISOString()
    await expect(publicQuery.queryFearGreedSnapshot({ asOf })).resolves.toMatchObject({
      state: 'available', score: 73, observedAt: '2026-08-24T00:00:00.000Z'
    })
  })

  it('finishes persisted Alternative and Binance normalization while a persistent event-bus backfill consumer is slow', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'intelligence-event-bus-backfill-'))
    const storage = createEventBusJsonStorage(join(directory, 'event-bus.json'))
    const persistedBus = createEventBusStore()
    // 回填事件必须落在总线**保留窗口内**（30 天 / 5,000 条，`280596e`）：写死的旧日期会在
    // 任何消费者看到它之前被裁掉，于是消费者永远进不来——那是夹具过期，不是被测行为慢。
    const backfilledAt = new Date(Date.now() - 60 * 60 * 1000).toISOString()
    persistedBus.appendEvent({
      topic: INTELLIGENCE_EVENT_TOPICS.itemCreated,
      producer: { owner: 'product', productId: 'market-intelligence' },
      schemaVersion: 1,
      payload: { itemId: 'historical-item' }
    }, backfilledAt)
    await storage.write(persistedBus.getState())
    let consumerEntered = false
    const releaseConsumer = deferred<void>()
    const eventBus = createEventBusRuntime({ storage })
    eventBus.registerConsumer({
      consumerId: 'chart-projection.consumer',
      owner: 'product',
      productId: 'sample-product',
      topics: [INTELLIGENCE_EVENT_TOPICS.itemCreated]
    }, async () => {
      consumerEntered = true
      await releaseConsumer.promise
    })
    // 等**条件**（消费者真的进来），不是等一个没人 resolve 的 promise 到 5 秒超时：
    // 条件不成立时这里给出一句能读的失败，而不是「测试超时」。
    await vi.waitFor(() => {
      expect(consumerEntered).toBe(true)
    }, { timeout: 2_000, interval: 10 })

    try {
      const alternative = getIntelligenceSourceDefinition('alternative-fear-greed')!
      const spot = getIntelligenceSourceDefinition('binance-spot-market')!
      const profileStore = createSourceProfileStore(createInMemoryProfileStorage([
        { ...createDefaultSourceProfile(alternative), enabled: true },
        { ...createDefaultSourceProfile(spot), enabled: true }
      ]))
      const pipeline = createIntelligencePipeline({
        profileStore,
        eventPublisher: createIntelligenceEventPublisher(eventBus),
        fetchText: async (url, sourceId) => {
          if (sourceId === alternative.sourceId) {
            return '{"name":"Fear and Greed Index","data":[{"value":"73","value_classification":"Greed","timestamp":"1787529600"}]}'
          }
          if (sourceId !== spot.sourceId) throw new Error('Unexpected text source.')
          const symbol = new URL(url).searchParams.get('symbol')
          return JSON.stringify({
            symbol,
            priceChangePercent: symbol === 'BTCUSDT' ? '1.5' : '-2.5',
            lastPrice: '100',
            closeTime: 1787529600000
          })
        }
      })
      const jobRuntime = createJobRuntime()
      registerIntelligenceJobs(jobRuntime, { pipeline })

      const alternativeRun = await jobRuntime.enqueueDefinition(collectDefinition(alternative.sourceId))
      const binanceRun = await jobRuntime.enqueueDefinition(collectDefinition(spot.sourceId))

      await vi.waitFor(() => {
        expect(jobRuntime.getRun(alternativeRun.id)?.status).toBe('completed')
        expect(jobRuntime.getRun(binanceRun.id)?.status).toBe('completed')
        expect(jobRuntime.listRuns({ handlerId: 'market-intelligence.normalizeRawRecords' })).toHaveLength(2)
        expect(jobRuntime.listRuns({ handlerId: 'market-intelligence.normalizeRawRecords' })
          .every((run) => run.status === 'completed')).toBe(true)
      })
      expect(pipeline.listRawRecordSummaries()).toHaveLength(3)
      expect(pipeline.listRawRecordSummaries().every((record) => record.processingState === 'normalized')).toBe(true)
      const publicQuery = createMarketIntelligencePublicQueryService({ pipeline })
      const asOf = new Date(Date.now() + 1_000).toISOString()
      await expect(publicQuery.queryFearGreedSnapshot({ asOf })).resolves.toMatchObject({
        state: 'available', score: 73, observedAt: '2026-08-24T00:00:00.000Z'
      })
    } finally {
      releaseConsumer.resolve()
      await vi.waitFor(async () => {
        // 事件总线存储的读带完整性结论（闸门第二笔）：文件读得懂才谈「投递都完成了」。
        const outcome = await storage.read()
        if (outcome.integrity === 'corrupt' || outcome.integrity === 'future-version') {
          throw new Error(`event bus store blocked: ${outcome.integrity}`)
        }
        expect(outcome.state.deliveries.every((delivery) => delivery.status === 'completed')).toBe(true)
      })
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('counts what it fetched, parsed and appended, so "nothing new" is not a blank run', async () => {
    // 用户 2026-11-07：采集「完成」时 result 是空的，「今天真的没新文章」与「抓到了没写进去」
    // 在运行记录里长得一模一样。这条钉住四个数：抓 / 解析 / 新增 / 重复。
    const pipeline = createPipeline()
    const fixture = loadFixture('rss-sample.xml')

    const first = await pipeline.collectSource({ sourceId: 'coindesk-rss', runId: 'run-1', fixtureText: fixture })
    expect(first.counts).toEqual({ httpCalls: 0, fetchedBytes: 0, parsed: 2, appended: 2, duplicates: 0 })
    expect(first.reasonCode).toBeUndefined()

    // 同一份 RSS 再采一次：全被判重复，但这是一次**成功**的采集，不是失败。
    const second = await pipeline.collectSource({ sourceId: 'coindesk-rss', runId: 'run-2', fixtureText: fixture })
    expect(second.counts).toEqual({ httpCalls: 0, fetchedBytes: 0, parsed: 2, appended: 0, duplicates: 2 })
    expect(second.reasonCode).toBeUndefined()
    expect(second.queuedJobs).toEqual([])
  })

  it('holds the counting identity even when the three numbers differ', async () => {
    // 三个数各不相同才有意义：parsed=3 / appended=2 / duplicates=1（两条同 guid）。
    // 现有夹具都是「2 = 2 + 0」或「2 = 0 + 2」，等式任一边写歪都不会红——这条专门防那个。
    const threeWithOneRepeat = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<rss version="2.0"><channel><title>CoinDesk</title>',
      '<item><guid>guid-1</guid><link>https://example.test/a</link><title>First</title><pubDate>Mon, 05 Jul 2026 10:00:00 GMT</pubDate></item>',
      '<item><guid>guid-2</guid><link>https://example.test/b</link><title>Second</title><pubDate>Mon, 05 Jul 2026 11:00:00 GMT</pubDate></item>',
      '<item><guid>guid-1</guid><link>https://example.test/a</link><title>First again</title><pubDate>Mon, 05 Jul 2026 12:00:00 GMT</pubDate></item>',
      '</channel></rss>'
    ].join('\n')
    const pipeline = createPipeline()

    const result = await pipeline.collectSource({ sourceId: 'coindesk-rss', runId: 'run-identity', fixtureText: threeWithOneRepeat })

    expect(result.counts).toMatchObject({ parsed: 3, appended: 2, duplicates: 1 })
    // The identity itself, on its own line: parsed = appended + duplicates（跳过/失败都不许混进来）。
    expect(result.counts.parsed).toBe(result.counts.appended + result.counts.duplicates)
  })

  it('hands the notifier the last new item, not the last successful fetch', async () => {
    // 接线这一层单测：`lastPublishedAt` 必须真的从检查点传到来源事件里。
    // 少了这一步，`decideSourceIssue` 改对了也不会生效（它有回落到 lastSuccessAt 的分支，会静默走老路）。
    const seen: Array<{ lastNewItemAt?: string; lastSuccessAt?: string }> = []
    const profileStore = createSourceProfileStore(createInMemoryProfileStorage())
    const pipeline = createIntelligencePipeline({
      profileStore,
      sourceIssueNotifier: async (input) => { seen.push(input) }
    })

    await pipeline.collectSource({ sourceId: 'coindesk-rss', runId: 'run-1', fixtureText: loadFixture('rss-sample.xml') })
    const health = pipeline.getHealth('coindesk-rss')
    expect(health?.lastPublishedAt).toBeTruthy()
    // 事件里带的是「最后一次新条目」，来源判陈旧用它；`lastSuccessAt` 是「刚才」，靠它会永远判不出陈旧。
    expect(seen.at(-1)?.lastNewItemAt).toBe(health?.lastPublishedAt)
  })

  it('marks a failed fetch as a different shape from a successful empty collection', async () => {
    // 判据：抓取失败必须能一眼区分出来——带原因码、四个计数归零，而不是又一个「完成、没数字」。
    const profileStore = createSourceProfileStore(createInMemoryProfileStorage())
    const pipeline = createIntelligencePipeline({
      profileStore,
      fetchText: async () => { throw new Error('feed unreachable') }
    })

    const failed = await pipeline.collectSource({ sourceId: 'coindesk-rss', runId: 'run-fail' })
    expect(failed.reasonCode).toBe('collect-failed')
    expect(failed.reason).toContain('feed unreachable')
    expect(failed.counts).toEqual({ httpCalls: 0, fetchedBytes: 0, parsed: 0, appended: 0, duplicates: 0 })
    expect(failed.queuedJobs).toEqual([])
  })

  it('counts fetched bytes as UTF-8 bytes, not string length', async () => {
    // 2026-11-21 排查被带偏两轮：日志写 `30562 byte(s)`，实际数的是 `body.length`（字符）。
    // 同一条正文里有多字节字符时，字节数必须大于字符数。
    const xml = '<?xml version="1.0"?><rss><channel><item><guid>g-utf8</guid><link>https://example.test/a</link>'
      + '<title>中文标题</title><pubDate>Sat, 21 Nov 2026 06:16:42 +0000</pubDate></item></channel></rss>'
    const profileStore = createSourceProfileStore(createInMemoryProfileStorage())
    const pipeline = createIntelligencePipeline({ profileStore, fetchText: async () => xml })

    const result = await pipeline.collectSource({ sourceId: 'coindesk-rss', runId: 'run-bytes' })

    expect(result.counts.fetchedBytes).toBe(Buffer.byteLength(xml, 'utf8'))
    expect(result.counts.fetchedBytes).toBeGreaterThan(xml.length)
  })

  it('creates clusters and revisions while queueing downstream work', async () => {
    const pipeline = createPipeline()
    const fixture = loadFixture('rss-sample.xml')

    const collectResult = await pipeline.collectSource({
      sourceId: 'coindesk-rss',
      runId: 'run-1',
      fixtureText: fixture
    })
    await pipeline.normalizeRawRecords({ sourceId: 'coindesk-rss' })

    expect(collectResult.queuedJobs).toContain('market-intelligence.normalizeRawRecords')
    expect(pipeline.listClusters().length).toBeGreaterThan(0)
  })

  it('queues assessment and sentiment work after normalization', async () => {
    const pipeline = createPipeline()
    await pipeline.collectSource({
      sourceId: 'coindesk-rss',
      runId: 'run-1',
      fixtureText: loadFixture('rss-sample.xml')
    })
    const normalizeResult = await pipeline.normalizeRawRecords({ sourceId: 'coindesk-rss' })
    const assessmentResult = await pipeline.assessChangedItems({ itemIds: normalizeResult.newItemIds })
    const duplicateAssessment = await pipeline.assessChangedItems({ itemIds: normalizeResult.newItemIds })
    const sentimentResult = await pipeline.refreshSentimentAggregates({ itemIds: normalizeResult.newItemIds })

    expect(normalizeResult.queuedJobs).toContain('market-intelligence.assessChangedItems')
    expect(normalizeResult.queuedJobs).toContain('market-intelligence.refreshSentimentAggregates')
    expect(assessmentResult.assessmentCount).toBeGreaterThan(0)
    expect(duplicateAssessment.assessmentCount).toBe(0)
    expect(sentimentResult.aggregateCount).toBe(0)
  })

  it('preserves existing sentiment signals when refreshing a subset of items', async () => {
    const pipeline = createPipeline()
    const normalizeResult = await seedBlsSentimentPipeline(pipeline)
    await pipeline.refreshSentimentAggregates({ itemIds: normalizeResult.newItemIds })

    const aggregateBefore = pipeline.listSentimentAggregates()[0]
    const supportingBefore = JSON.parse(aggregateBefore?.supportingItemIdsJson ?? '[]') as string[]
    expect(supportingBefore.length).toBeGreaterThan(0)

    const subsetItemId = normalizeResult.newItemIds[0]
    expect(subsetItemId).toBeTruthy()
    await pipeline.refreshSentimentAggregates({ itemIds: subsetItemId ? [subsetItemId] : [] })

    const aggregateAfter = pipeline.listSentimentAggregates()[0]
    const supportingAfter = JSON.parse(aggregateAfter?.supportingItemIdsJson ?? '[]') as string[]
    expect(supportingAfter.length).toBe(supportingBefore.length)
  })

  it('persists source checkpoint metadata after collection', async () => {
    const pipeline = createPipeline()
    await pipeline.collectSource({
      sourceId: 'coindesk-rss',
      runId: 'run-1',
      fixtureText: loadFixture('rss-sample.xml')
    })

    const health = pipeline.getHealth('coindesk-rss')
    expect(health?.parserVersion).toBeTruthy()
    expect(health?.checkpointPreview).toContain('appended=')
  })

  it('keeps full sentiment aggregate when refreshing with incremental itemIds', async () => {
    const pipeline = createPipeline()
    await seedBlsSentimentPipeline(pipeline)

    const fullAggregate = await pipeline.refreshSentimentAggregates({ scopeKey: 'global', horizon: '1h' })
    expect(fullAggregate.aggregateCount).toBeGreaterThan(0)
    const aggregateBefore = pipeline.listSentimentAggregates()[0]
    const supportingBefore = JSON.parse(aggregateBefore?.supportingItemIdsJson ?? '[]') as string[]
    expect(supportingBefore.length).toBeGreaterThan(0)

    await pipeline.refreshSentimentAggregates({
      scopeKey: 'global',
      horizon: '1h',
      itemIds: [supportingBefore[0]!]
    })

    const aggregateAfter = pipeline.listSentimentAggregates()[0]
    const supportingAfter = JSON.parse(aggregateAfter?.supportingItemIdsJson ?? '[]') as string[]
    expect(supportingAfter.length).toBe(supportingBefore.length)
  })

  it('updates source health on failure without creating timeline items', async () => {
    const definition = getIntelligenceSourceDefinition('bea-economic-series')!
    const profileStore = createSourceProfileStore(
      createInMemoryProfileStorage([
        {
          ...createDefaultSourceProfile(definition),
          enabled: true
        }
      ])
    )
    const pipeline = createIntelligencePipeline({ profileStore })

    await pipeline.collectSource({ sourceId: 'bea-economic-series', runId: 'run-1', fixtureText: '{}' })
    const health = pipeline.getHealth('bea-economic-series')

    expect(health?.runtimeStatus).toBe('failed')
    expect(pipeline.listItems()).toHaveLength(0)
  })

  it('creates metric events and bearish impacts for hot CPI fixture', async () => {
    const pipeline = createPipeline()
    await pipeline.collectSource({
      sourceId: 'bls-economic-series',
      runId: 'run-macro-hot',
      fixtureText: loadFixture('bls-cpi-hot-sample.json')
    })
    const normalizeResult = await pipeline.normalizeRawRecords({ sourceId: 'bls-economic-series' })
    await pipeline.assessChangedItems({ itemIds: normalizeResult.newItemIds })

    expect(pipeline.listMetricEvents().length).toBeGreaterThan(0)
    const impacts = pipeline.listImpacts()
    expect(impacts.some((impact) => impact.direction === 'bearish')).toBe(true)
    expect(impacts.some((impact) => impact.scopeType === 'crypto-market')).toBe(true)
  })

  it('creates ETH symbol metric event from Binance spot fixture', async () => {
    const pipeline = createPipeline()
    await pipeline.collectSource({
      sourceId: 'binance-spot-market',
      runId: 'run-eth',
      fixtureText: loadFixture('binance-eth-ticker-sample.json')
    })
    const normalizeResult = await pipeline.normalizeRawRecords({ sourceId: 'binance-spot-market' })

    expect(normalizeResult.processedCount).toBe(1)
    const metric = pipeline.listMetricEvents()[0]
    expect(metric?.metricKey).toBe('ETHUSDT_24H_TICKER')
    const item = pipeline.listItems()[0]
    expect(JSON.parse(item?.symbolsJson ?? '[]')).toContain('ETH')
  })

  it('stores old fear-greed days as backfill: created, pending, and out of the queues', async () => {
    const pipeline = createPipeline()
    await pipeline.collectSource({
      sourceId: 'alternative-fear-greed',
      runId: 'fg-window',
      fixtureText: JSON.stringify({ data: [
        { value: '24', timestamp: '1795046400' },
        { value: '40', timestamp: '1790899200' },
        { value: '38', timestamp: '1790812800' }
      ] })
    })

    const result = await pipeline.normalizeRawRecords({ sourceId: 'alternative-fear-greed' })

    expect(result.newItemIds).toHaveLength(3)
    expect(result.backfillItemIds).toHaveLength(2)
    const labelsByDay = new Map(pipeline.listItems().map((item) => [item.publishedAt?.slice(0, 10), JSON.parse(item.processingLabelsJson ?? '{}')]))
    expect(labelsByDay.get('2026-11-19')?.assessmentStatus).toBe('queued')
    expect(labelsByDay.get('2026-10-02')?.assessmentStatus).toBe('pending')
    expect(labelsByDay.get('2026-10-01')?.assessmentStatus).toBe('pending')
    expect(labelsByDay.get('2026-10-02')?.isBackfill).toBe(true)
  })

  it('keeps one fear-greed point per day and lets the latest same-day pull win without rolling back', async () => {
    const pipeline = createPipeline()
    const pull = (days: Array<{ value: string; timestamp: string }>): string => JSON.stringify({ data: days })

    await pipeline.collectSource({
      sourceId: 'alternative-fear-greed',
      runId: 'fg-1',
      fixtureText: pull([
        { value: '22', timestamp: '1795046400' },
        { value: '31', timestamp: '1794960000' }
      ])
    })
    await pipeline.normalizeRawRecords({ sourceId: 'alternative-fear-greed' })
    expect(pipeline.listMetricEvents().map((event) => event.period)).toEqual(['2026-11-19', '2026-11-18'])
    expect(pipeline.listRevisions()).toHaveLength(2)

    // The source revises the 19th (22 -> 24) with a later release that same day: the point is
    // replaced, not duplicated.
    await pipeline.collectSource({
      sourceId: 'alternative-fear-greed',
      runId: 'fg-2',
      fixtureText: pull([
        { value: '24', timestamp: '1795089600' },
        { value: '31', timestamp: '1794960000' }
      ])
    })
    await pipeline.normalizeRawRecords({ sourceId: 'alternative-fear-greed' })
    const revised = pipeline.listMetricEvents()
    expect(revised.filter((event) => event.period === '2026-11-19')).toHaveLength(1)
    expect(revised.find((event) => event.period === '2026-11-19')?.actual).toBe(24)
    // Only the revised day earns a new revision: the untouched day's own hash decides, not the payload's.
    expect(pipeline.listRevisions()).toHaveLength(3)

    // A late payload carrying the earlier release of the same day must not undo the revision.
    await pipeline.collectSource({
      sourceId: 'alternative-fear-greed',
      runId: 'fg-3',
      fixtureText: pull([{ value: '22', timestamp: '1795046400' }])
    })
    await pipeline.normalizeRawRecords({ sourceId: 'alternative-fear-greed' })
    expect(pipeline.listMetricEvents().find((event) => event.period === '2026-11-19')?.actual).toBe(24)
  })

  it('stores layer breakdown on sentiment aggregates after impact assessment', async () => {
    const pipeline = createPipeline()
    await pipeline.collectSource({
      sourceId: 'bls-economic-series',
      runId: 'run-layer',
      fixtureText: loadFixture('bls-cpi-hot-sample.json')
    })
    const normalizeResult = await pipeline.normalizeRawRecords({ sourceId: 'bls-economic-series' })
    await pipeline.assessChangedItems({ itemIds: normalizeResult.newItemIds })
    await pipeline.refreshSentimentAggregates({ horizon: '1h' })

    const aggregate = pipeline.listSentimentAggregates().find((entry) => entry.scopeType === 'crypto-market')
    expect(aggregate?.layerBreakdownJson).toBeTruthy()
    expect(aggregate?.supportingImpactIdsJson).toBeTruthy()
  })
  it('replays binance announcement list fixtures into assessable items', async () => {
    const definition = getIntelligenceSourceDefinition('binance-announcements')!
    const { issues } = resolveAndValidateRuntimeConfig({
      definition,
      profile: createDefaultSourceProfile(definition)
    })
    expect(issues).toEqual([])

    const pipeline = createPipeline()
    const collectResult = await pipeline.collectSource({
      sourceId: 'binance-announcements',
      runId: 'run-1',
      fixtureText: loadFixture('binance-articles.json')
    })

    expect(pipeline.getHealth('binance-announcements')?.checkpointPreview).toContain('appended=3')
    expect(collectResult.queuedJobs).toContain('market-intelligence.normalizeRawRecords')
    const normalizeResult = await pipeline.normalizeRawRecords({ sourceId: 'binance-announcements' })
    expect(normalizeResult.processedCount).toBeGreaterThan(0)
    expect(pipeline.listItems().some((item) => /will list/i.test(item.title))).toBe(true)

    const assessmentResult = await pipeline.assessChangedItems({ itemIds: normalizeResult.newItemIds })
    expect(assessmentResult.assessmentCount).toBeGreaterThan(0)
    expect(pipeline.listImpacts().some((impact) => impact.ruleId === 'micro.binance.listing.v1')).toBe(true)
  })

  it('replays binance delisting fixtures into delisting impacts', async () => {
    const pipeline = createPipeline()
    await pipeline.collectSource({
      sourceId: 'binance-announcements',
      runId: 'run-1',
      fixtureText: loadFixture('binance-delisting-articles.json')
    })
    const normalizeResult = await pipeline.normalizeRawRecords({ sourceId: 'binance-announcements' })
    const assessmentResult = await pipeline.assessChangedItems({ itemIds: normalizeResult.newItemIds })

    expect(normalizeResult.newItemIds.length).toBeGreaterThan(0)
    expect(assessmentResult.assessmentCount).toBeGreaterThan(0)
    expect(pipeline.listImpacts().some((impact) => impact.ruleId === 'micro.binance.delisting.v1')).toBe(true)
  })
})

function createPipeline() {
  const profileStore = createSourceProfileStore(createInMemoryProfileStorage())
  return createIntelligencePipeline({ profileStore })
}

function collectDefinition(sourceId: string) {
  return {
    id: `market-intelligence.collect:${sourceId}`,
    owner: 'product' as const,
    productId: 'market-intelligence',
    handlerId: 'market-intelligence.collectSource',
    title: `Collect ${sourceId}`,
    trigger: { kind: 'manual' as const },
    payload: { sourceId },
    concurrencyKey: `market-intelligence:${sourceId}`
  }
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve
  })
  return { promise, resolve }
}

function runtimeState(overrides: Partial<import('@platform/jobs').RuntimeStateRecord> = {}) {
  return {
    owner: 'product' as const,
    productId: 'market-intelligence',
    resourceId: 'coindesk-rss',
    status: 'idle' as const,
    consecutiveFailures: 0,
    updatedAt: '2026-08-18T09:00:00.000Z',
    ...overrides
  }
}

async function waitForRuntimeWrite(records: import('@platform/jobs').RuntimeStateRecord[][]): Promise<void> {
  const deadline = Date.now() + 1_000
  while (records.length === 0 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  expect(records).toHaveLength(1)
}

async function seedBlsSentimentPipeline(pipeline: ReturnType<typeof createIntelligencePipeline>) {
  await pipeline.collectSource({
    sourceId: 'bls-economic-series',
    runId: 'run-bls',
    fixtureText: loadFixture('bls-cpi-hot-sample.json')
  })
  const normalizeResult = await pipeline.normalizeRawRecords({ sourceId: 'bls-economic-series' })
  await pipeline.assessChangedItems({ itemIds: normalizeResult.newItemIds })
  return normalizeResult
}

function loadFixture(name: string): string {
  return readFileSync(
    path.join(
      __dirname,
      '../adapters/fixtures',
      name
    ),
    'utf8'
  )
}
