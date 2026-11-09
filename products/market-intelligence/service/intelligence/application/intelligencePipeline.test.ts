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
        expect((await storage.read()).deliveries.every((delivery) => delivery.status === 'completed')).toBe(true)
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
