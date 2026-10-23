import { readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { createIntelligencePipeline } from './intelligencePipeline'
import { createIntelligenceSourcesService } from './intelligenceSourcesService'
import { createInMemoryProfileStorage, createSourceProfileStore } from './sourceProfileStore'
import { createIntelligenceWorkspaceQueries } from './intelligenceWorkspaceQueries'
import { createEmptyWatchlistScope, EMPTY_EXPOSURE_SNAPSHOT, buildMonitoringScope } from './monitoringScope'
import type { WorkspaceMatchContext } from './intelligenceWorkspaceQueries'

describe('intelligence real data loop', () => {
  it('replays fear and greed fixture through impacts and workspace status', async () => {
    const { pipeline, queries, matchContext } = createHarness()
    await collectNormalizeAssess(pipeline, 'alternative-fear-greed', 'fear-greed-sample.json')
    await pipeline.refreshSentimentAggregates({ horizon: '1h' })

    const state = await queries.getWorkspaceStateAsync({ filters: { timeRange: 'all', horizon: '1h' }, matchContext })
    expect(state.overview.status.fearGreed?.score).toBe(22)
    expect(state.overview.status.fearGreed?.classification).toBe('Extreme Fear')
    expect(pipeline.listImpacts().some((impact) => impact.ruleId === 'industry.fear.extreme.v1')).toBe(true)
  })

  it('replays binance spot negative move into bearish symbol impact', async () => {
    const { pipeline } = createHarness()
    await collectNormalizeAssess(pipeline, 'binance-spot-market', 'binance-btc-ticker-negative.json')
    expect(pipeline.listImpacts().some((impact) => impact.ruleId === 'micro.spot.weakness.v1')).toBe(true)
  })

  it('replays binance spot positive move into bullish symbol impact', async () => {
    const { pipeline } = createHarness()
    await collectNormalizeAssess(pipeline, 'binance-spot-market', 'binance-btc-ticker-positive.json')
    expect(pipeline.listImpacts().some((impact) => impact.ruleId === 'micro.oi.rising-momentum.v1')).toBe(true)
  })

  it('replays binance crowded funding fixture', async () => {
    const { pipeline } = createHarness()
    await collectNormalizeAssess(pipeline, 'binance-futures-positioning', 'binance-eth-funding-sample.json')
    expect(pipeline.listImpacts().some((impact) => impact.ruleId === 'micro.funding.crowded-long.v1')).toBe(true)
  })

  it('replays binance negative funding fixture', async () => {
    const { pipeline } = createHarness()
    await collectNormalizeAssess(pipeline, 'binance-futures-positioning', 'binance-eth-funding-negative.json')
    expect(pipeline.listImpacts().some((impact) => impact.ruleId === 'micro.funding.short-crowded.v1')).toBe(true)
  })

  it('replays binance listing announcement fixture', async () => {
    const { pipeline } = createHarness()
    await collectNormalizeAssess(pipeline, 'binance-announcements', 'binance-articles.json')
    expect(pipeline.listImpacts().some((impact) => impact.ruleId === 'micro.binance.listing.v1')).toBe(true)
  })

  it('replays binance delisting announcement fixture', async () => {
    const { pipeline } = createHarness()
    await collectNormalizeAssess(pipeline, 'binance-announcements', 'binance-delisting-articles.json')
    expect(pipeline.listItems().some((item) => /delist/i.test(item.title))).toBe(true)
    expect(pipeline.listImpacts().some((impact) => impact.ruleId === 'micro.binance.delisting.v1')).toBe(true)
  })

  it('replays fed hawkish RSS fixture', async () => {
    const { pipeline } = createHarness()
    await collectNormalizeAssess(pipeline, 'federal-reserve-rss', 'fed-hawkish-rss.xml')
    expect(pipeline.listImpacts().some((impact) => impact.ruleId === 'macro.fed.hawkish.v1')).toBe(true)
  })

  it('replays fed dovish RSS fixture', async () => {
    const { pipeline } = createHarness()
    await collectNormalizeAssess(pipeline, 'federal-reserve-rss', 'fed-dovish-rss.xml')
    expect(pipeline.listImpacts().some((impact) => impact.ruleId === 'macro.fed.dovish.v1')).toBe(true)
  })

  it('replays sec enforcement RSS fixture', async () => {
    const { pipeline } = createHarness()
    await collectNormalizeAssess(pipeline, 'sec-rss', 'sec-enforcement-rss.xml')
    expect(pipeline.listImpacts().some((impact) => impact.ruleId === 'macro.regulation.negative.v1')).toBe(true)
  })

  it('replays cftc enforcement RSS fixture', async () => {
    const { pipeline } = createHarness()
    await collectNormalizeAssess(pipeline, 'cftc-rss', 'cftc-enforcement-rss.xml')
    expect(pipeline.listImpacts().some((impact) => impact.ruleId === 'macro.regulation.negative.v1')).toBe(true)
  })

  it('exposes supporting evidence in sentiment detail', async () => {
    const { pipeline, queries } = createHarness()
    await collectNormalizeAssess(pipeline, 'bls-economic-series', 'bls-cpi-hot-sample.json')
    await pipeline.refreshSentimentAggregates({ horizon: '1h' })
    const aggregate = pipeline.listSentimentAggregates().find((entry) => entry.signalCount > 0)
    expect(aggregate).toBeTruthy()

    const detail = await queries.getDetail({ aggregateId: aggregate?.aggregateId })
    expect(detail?.sentiment?.supportingItems.length).toBeGreaterThan(0)
    expect(detail?.sentiment?.supportingItems[0]?.impactRuleIds.length).toBeGreaterThan(0)
  })

  it('replays BEA hot PCE fixture into inflation impacts', async () => {
    const { pipeline } = createHarness()
    await collectNormalizeAssess(pipeline, 'bea-economic-series', 'bea-pce-hot-sample.json')
    expect(pipeline.listImpacts().some((impact) => impact.ruleId === 'macro.inflation.hot.v1')).toBe(true)
  })

  it('replays FRED rising yields fixture into bearish macro impacts', async () => {
    const { pipeline } = createHarness()
    await collectNormalizeAssess(pipeline, 'fred-rates-liquidity', 'fred-yields-rising-sample.json')
    expect(pipeline.listImpacts().some((impact) => impact.ruleId === 'macro.yields.up.v1')).toBe(true)
  })

  it('replays Treasury rising TGA fixture into fiscal liquidity proxy impacts', async () => {
    const { pipeline } = createHarness()
    await collectNormalizeAssess(pipeline, 'treasury-fiscal-data', 'treasury-tga-rising-sample.json')
    expect(pipeline.listImpacts().some((impact) => impact.ruleId === 'macro.treasury.liquidity-drain.v1')).toBe(true)
  })

  it('replays BLS cooling CPI fixture into bullish inflation impacts', async () => {
    const { pipeline } = createHarness()
    await collectNormalizeAssess(pipeline, 'bls-economic-series', 'bls-cpi-cooling-sample.json')
    expect(pipeline.listImpacts().some((impact) => impact.ruleId === 'macro.inflation.cooling.v1')).toBe(true)
  })

  it('replays BEA cooling PCE fixture into bullish inflation impacts', async () => {
    const { pipeline } = createHarness()
    await collectNormalizeAssess(pipeline, 'bea-economic-series', 'bea-pce-cooling-sample.json')
    expect(pipeline.listImpacts().some((impact) => impact.ruleId === 'macro.inflation.cooling.v1')).toBe(true)
  })

  it('replays BEA weak GDP fixture into mixed growth impacts', async () => {
    const { pipeline } = createHarness()
    await collectNormalizeAssess(pipeline, 'bea-economic-series', 'bea-gdp-weak-sample.json')
    expect(pipeline.listImpacts().some((impact) => impact.ruleId === 'macro.growth.weak.v1')).toBe(true)
  })

  it('replays FRED falling yields fixture into bullish macro impacts', async () => {
    const { pipeline } = createHarness()
    await collectNormalizeAssess(pipeline, 'fred-rates-liquidity', 'fred-yields-falling-sample.json')
    expect(pipeline.listImpacts().some((impact) => impact.ruleId === 'macro.yields.down.v1')).toBe(true)
  })

  it('replays Treasury falling TGA fixture into liquidity-add impacts', async () => {
    const { pipeline } = createHarness()
    await collectNormalizeAssess(pipeline, 'treasury-fiscal-data', 'treasury-tga-falling-sample.json')
    expect(pipeline.listImpacts().some((impact) => impact.ruleId === 'macro.treasury.liquidity-add.v1')).toBe(true)
  })

  it('replays the synthetic OKX announcements response without any credential', async () => {
    const { pipeline } = createHarness()
    await collectNormalizeAssess(pipeline, 'okx-latest-announcements', 'okx-announcements-latest-sample.json')

    const items = pipeline.listItems()
    // 20 synthetic announcements are stored as raw records; the exchange classifier keeps the 18
    // market notices and ignores the two voucher campaigns as `exchange-marketing` noise.
    expect(items.length).toBe(18)
    expect(items.every((item) => item.url?.startsWith('https://www.okx.com/help/'))).toBe(true)
    expect(items.every((item) => item.publishedAt && Number.isNaN(Date.parse(item.publishedAt)) === false)).toBe(true)
    expect(items.some((item) => /token pair groups adjustment/i.test(item.title))).toBe(true)
    expect(items.some((item) => /voucher campaign/i.test(item.title))).toBe(false)
  })

  it('replays the synthetic OKX API-announcement response without any credential', async () => {
    const { pipeline } = createHarness()
    await collectNormalizeAssess(pipeline, 'okx-api-announcements', 'okx-announcements-api-sample.json')
    expect(pipeline.listItems().length).toBe(11)
  })

  it('replays the synthetic GitHub releases response without any credential', async () => {
    const { pipeline } = createHarness()
    await collectNormalizeAssess(pipeline, 'github-releases', 'github-releases-goethereum-sample.json')

    const items = pipeline.listItems()
    expect(items.map((item) => item.title)).toEqual([
      'Example release v9.0.0',
      'Example release v8.0.0',
      'Example release v7.0.0'
    ])
    expect(items[0]?.publishedAt).toBe('2026-10-08T12:00:00.000Z')
  })

  it('replays the captured CoinGecko global snapshot without any credential', async () => {
    const { pipeline } = createHarness()
    await collectNormalizeAssess(pipeline, 'coingecko-market', 'coingecko-global-sample.json')

    const metricKeys = pipeline.listMetricEvents().map((event) => event.metricKey)
    expect(metricKeys).toEqual(
      expect.arrayContaining(['CRYPTO_TOTAL_MARKET_CAP', 'CRYPTO_MARKET_CAP_CHANGE_24H', 'CRYPTO_BTC_DOMINANCE'])
    )
    // An aggregator level, classified conservatively: the reading is context, not a trigger.
    expect(pipeline.listImpacts()).toEqual([])
  })
})

function createHarness() {
  const profileStore = createSourceProfileStore(createInMemoryProfileStorage())
  const pipeline = createIntelligencePipeline({ profileStore })
  const sourcesService = createIntelligenceSourcesService({
    profileStore,
    pipeline,
    jobRuntime: { setSchedule: () => {}, removeSchedule: () => {}, enqueueDefinition: async () => ({}) } as never
  })
  const queries = createIntelligenceWorkspaceQueries({ pipeline, sourcesService })
  const matchContext = createMatchContext()
  return { pipeline, queries, matchContext }
}

/**
 * Every case below replays a checked-in fixture of a real response through the production parsers.
 * Nothing here performs network I/O: `fixtureText` takes the adapter's own transport out of the path,
 * which is what keeps the whole suite deterministic.
 */
async function collectNormalizeAssess(
  pipeline: ReturnType<typeof createIntelligencePipeline>,
  sourceId: string,
  fixtureName: string,
  runId = 'run-1'
) {
  await pipeline.collectSource({ sourceId, runId, fixtureText: loadFixture(fixtureName) })
  const normalizeResult = await pipeline.normalizeRawRecords({ sourceId })
  await pipeline.assessChangedItems({ itemIds: normalizeResult.newItemIds })
}

function createMatchContext(): WorkspaceMatchContext {
  const watchlistScope = createEmptyWatchlistScope()
  const portfolio = EMPTY_EXPOSURE_SNAPSHOT
  return {
    monitoringScope: buildMonitoringScope(portfolio, watchlistScope),
    matchPolicy: { positionAndWatchlistOnly: false, criticalMarketEventFallback: true },
    alerts: []
  }
}

function loadFixture(name: string): string {
  return readFileSync(path.join(__dirname, '../adapters/fixtures', name), 'utf8')
}
