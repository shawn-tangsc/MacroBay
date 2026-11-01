import { describe, expect, it, vi } from 'vitest'

import type { BriefingPulseRow, BriefingMarketRow, DailyBriefingDocument } from '../../../contracts/dailyBriefing'
import type { DailyBriefBackfillFact, DailyBriefBackfillResult } from '../public-query/dailyBriefBackfill'
import type { DailyBriefingFactPacket } from './dailyBriefingFactPacket'
import { buildDailyBriefingDocument } from './dailyBriefingDocument'
import {
  createDailyBriefFactEnsure,
  dailyBriefCoreFactEnsurePolicy,
  type DailyBriefCoreFactMetric
} from './dailyBriefFactEnsure'
import { createInMemoryDailyBriefFactEnsureCache } from './dailyBriefFactEnsureCache'

const asOf = '2026-10-30T00:00:00.000Z'
const now = '2026-10-30T00:30:00.000Z'

const coreIds = ['stablecoin', 'etf-btc', 'etf-eth', 'dxy', 'gold', 'us10y', 'us10y-real'] as const

function packet(overrides: Partial<DailyBriefingFactPacket> = {}): DailyBriefingFactPacket {
  return {
    asOf,
    windowStart: '2026-10-29T00:00:00.000Z',
    windowEnd: asOf,
    windowHours: 24,
    locale: 'zh-CN',
    timeZone: 'Asia/Shanghai',
    conclusion: null,
    news: { state: 'empty', items: [] },
    calendar: { state: 'source-disabled', events: [] },
    readings: {
      fearGreed: { state: 'empty', asOf },
      funding: { state: 'empty', asOf },
      capital: { state: 'empty', asOf }
    },
    market: {},
    enabled: { fearGreed: false, funding: false, stablecoin: true, etf: true, calendar: false },
    ...overrides
  }
}

function document(overrides: Partial<DailyBriefingFactPacket> = {}, date = '2026-10-30'): DailyBriefingDocument {
  return buildDailyBriefingDocument({ packet: packet(overrides), date })
}

function available<T extends BriefingMarketRow | BriefingPulseRow>(row: T, state: 'available' | 'stale' = 'available'): T {
  const { reason: _reason, ...rest } = row
  return {
    ...rest,
    state,
    value: { number: 1, format: row.value?.format ?? 'level' },
    change: null,
    observedAt: asOf
  } as T
}

/** Leaves the named rows as the document built them; the rest are readable so only one gap remains. */
function onlyGaps(document: DailyBriefingDocument, gapIds: readonly string[]): DailyBriefingDocument {
  const availableIds = new Set(coreIds.filter((id) => !gapIds.includes(id)))
  return {
    ...document,
    data: {
      ...document.data,
      market: document.data.market.map((row) => availableIds.has(row.id) ? available(row) : row),
      funds: document.data.funds.map((row) => availableIds.has(row.id) ? available(row) : row)
    }
  }
}

function fact(metric: DailyBriefCoreFactMetric, value: number, unit: DailyBriefBackfillFact['unit']): DailyBriefBackfillFact {
  const source = metric === 'core-stablecoin-supply-usd'
    ? 'stablecoin'
    : metric.startsWith('etf-')
      ? 'etf'
      : metric === 'dxy-level'
        ? 'dxy'
        : metric === 'gold-level-usd'
          ? 'gold'
          : 'treasury'
  return {
    state: 'available',
    source: source as DailyBriefBackfillFact['source'],
    metric,
    asOf,
    value,
    unit,
    observedAt: '2026-10-29T00:00:00.000Z',
    sourceUrl: 'https://example.test/series',
    method: 'historical-api'
  }
}

const facts: Readonly<Record<DailyBriefCoreFactMetric, DailyBriefBackfillFact>> = {
  'core-stablecoin-supply-usd': fact('core-stablecoin-supply-usd', 253_000_000_000, 'usd'),
  'etf-net-flow-btc': fact('etf-net-flow-btc', 250_000_000, 'flow-usd'),
  'etf-net-flow-eth': fact('etf-net-flow-eth', -30_000_000, 'flow-usd'),
  'dxy-level': fact('dxy-level', 99.2, 'level'),
  'gold-level-usd': fact('gold-level-usd', 2400, 'level'),
  'us10y-yield-percent': fact('us10y-yield-percent', 4.2, 'percent'),
  'us10y-real-yield-percent': fact('us10y-real-yield-percent', 1.8, 'percent')
}

function fakeExecutor(results: Partial<Record<string, DailyBriefBackfillResult>> = {}) {
  return vi.fn(async (request: { source: string; metric: string; asOf: string }): Promise<DailyBriefBackfillResult> => {
    const configured = results[request.metric as DailyBriefCoreFactMetric]
    if (configured) return configured
    const built = facts[request.metric as DailyBriefCoreFactMetric]
    return built
      ? { ...built, asOf: request.asOf }
      : {
        state: 'unavailable',
        source: request.source,
        metric: request.metric,
        asOf: request.asOf,
        gapCode: 'historical-api-unavailable',
        detail: 'no fixture for this metric.'
      }
  })
}

function build(executor = fakeExecutor(), enabled: (sourceId: string) => boolean | undefined = () => true) {
  const cache = createInMemoryDailyBriefFactEnsureCache()
  const events: Readonly<Record<string, unknown>>[] = []
  const service = createDailyBriefFactEnsure({
    backfillFor: () => executor,
    cache,
    isSourceEnabled: async (sourceId) => enabled(sourceId),
    now: () => now,
    onEvent: (event) => { events.push(event) }
  })
  return { service, cache, executor, events }
}

describe('daily brief core fact ensure', () => {
  it('does not call a reader when the core rows are already available', async () => {
    const { service, executor } = build()
    const result = await service.ensure({ document: onlyGaps(document(), []), cutoff: asOf })

    expect(executor).not.toHaveBeenCalled()
    expect(result.changed).toBe(false)
    expect(result.document).toEqual(onlyGaps(document(), []))
  })

  it('calls the executor once for a gap, patches the row and caches the fact', async () => {
    const { service, cache, executor } = build()
    const before = onlyGaps(document(), ['stablecoin'])
    const result = await service.ensure({ document: before, cutoff: asOf })

    expect(executor).toHaveBeenCalledTimes(1)
    expect(executor).toHaveBeenCalledWith({ source: 'stablecoin', metric: 'core-stablecoin-supply-usd', asOf })
    expect(result.changed).toBe(true)
    expect(result.filled).toEqual(['core-stablecoin-supply-usd'])
    const row = result.document.data.funds.find((candidate) => candidate.id === 'stablecoin')
    expect(row).toMatchObject({ state: 'available', value: { number: 253_000_000_000, format: 'usd' }, window: 'latest' })
    expect(row?.reason).toBeUndefined()
    expect(row?.observedAt).toBe('2026-10-29T00:00:00.000Z')
    expect(await cache.entries()).toEqual([
      expect.objectContaining({
        metric: 'core-stablecoin-supply-usd',
        state: 'available',
        lastSuccessAt: now,
        method: 'historical-api',
        source: 'stablecoin'
      })
    ])
  })

  it('does not call the executor again for the same edition, metric and asOf', async () => {
    const { service, executor } = build()
    const before = onlyGaps(document(), ['stablecoin'])
    await service.ensure({ document: before, cutoff: asOf })
    const second = await service.ensure({ document: before, cutoff: asOf })

    expect(executor).toHaveBeenCalledTimes(1)
    // The second call reuses the cached fact and still patches the fresh copy of the document.
    expect(second.filled).toEqual(['core-stablecoin-supply-usd'])
  })

  it('checks a new cutoff again', async () => {
    let currentNow = now
    const executor = fakeExecutor()
    const cache = createInMemoryDailyBriefFactEnsureCache()
    const service = createDailyBriefFactEnsure({
      backfillFor: () => executor,
      cache,
      isSourceEnabled: async () => true,
      now: () => currentNow
    })
    await service.ensure({ document: onlyGaps(document(), ['stablecoin']), cutoff: asOf })

    currentNow = '2026-10-31T00:30:00.000Z'
    const nextAsOf = '2026-10-31T00:00:00.000Z'
    const nextDocument = buildDailyBriefingDocument({
      packet: packet({ asOf: nextAsOf, windowEnd: nextAsOf, windowStart: '2026-10-30T00:00:00.000Z' }),
      date: '2026-10-31'
    })
    await service.ensure({ document: onlyGaps(nextDocument, ['stablecoin']), cutoff: nextAsOf })

    expect(executor).toHaveBeenCalledTimes(2)
    expect(executor.mock.calls.map(([request]) => request.asOf)).toEqual([asOf, nextAsOf])
  })

  it('records the named gap, does not patch, and resolves when the executor fails', async () => {
    const executor = fakeExecutor({
      'core-stablecoin-supply-usd': {
        state: 'unavailable',
        source: 'stablecoin',
        metric: 'core-stablecoin-supply-usd',
        asOf,
        gapCode: 'historical-api-unavailable',
        detail: 'the provider refused the request.'
      }
    })
    let currentNow = now
    const cache = createInMemoryDailyBriefFactEnsureCache()
    const service = createDailyBriefFactEnsure({
      backfillFor: () => executor,
      cache,
      isSourceEnabled: async () => true,
      now: () => currentNow
    })
    const before = onlyGaps(document(), ['stablecoin'])
    const first = await service.ensure({ document: before, cutoff: asOf })

    expect(first.changed).toBe(false)
    expect(first.document).toEqual(before)
    expect(first.statuses).toEqual([
      expect.objectContaining({ gapCode: 'historical-api-unavailable', attempts: 1, lastAttemptAt: now })
    ])

    // Inside the retry window the failure is reused, not retried.
    await service.ensure({ document: before, cutoff: asOf })
    expect(executor).toHaveBeenCalledTimes(1)

    currentNow = '2026-10-30T01:01:00.000Z'
    await service.ensure({ document: before, cutoff: asOf })
    expect(executor).toHaveBeenCalledTimes(2)

    currentNow = '2026-10-30T02:02:00.000Z'
    await service.ensure({ document: before, cutoff: asOf })
    expect(executor).toHaveBeenCalledTimes(3)

    // Three attempts spent: the gap is stated from the cache and the key is not asked again.
    currentNow = '2026-10-30T03:03:00.000Z'
    const exhausted = await service.ensure({ document: before, cutoff: asOf })
    expect(executor).toHaveBeenCalledTimes(3)
    expect(exhausted.statuses[0]).toMatchObject({ attempts: 3, gapCode: 'historical-api-unavailable' })
  })

  it('records a gap instead of throwing when the executor throws', async () => {
    const executor = vi.fn(async (): Promise<DailyBriefBackfillResult> => { throw new Error('network down') })
    const service = createDailyBriefFactEnsure({
      backfillFor: () => executor,
      cache: createInMemoryDailyBriefFactEnsureCache(),
      isSourceEnabled: async () => true,
      now: () => now
    })
    const before = onlyGaps(document(), ['stablecoin'])
    const result = await service.ensure({ document: before, cutoff: asOf })

    expect(result.changed).toBe(false)
    expect(result.statuses[0]).toMatchObject({ gapCode: 'query-unavailable', attempts: 1 })
  })

  it('skips a disabled source without calling the executor', async () => {
    const { service, executor } = build(fakeExecutor(), (sourceId) => sourceId !== 'defillama-stablecoins')
    const before = onlyGaps(document(), ['stablecoin'])
    const result = await service.ensure({ document: before, cutoff: asOf })

    expect(executor).not.toHaveBeenCalled()
    expect(result.changed).toBe(false)
    expect(result.statuses[0]).toMatchObject({ gapCode: 'source-disabled', metric: 'core-stablecoin-supply-usd' })
  })

  it('refuses an asOf after now without calling the executor', async () => {
    const { service, executor } = build()
    const future = buildDailyBriefingDocument({
      packet: packet({ asOf: '2026-10-31T00:00:00.000Z', windowEnd: '2026-10-31T00:00:00.000Z', windowStart: '2026-10-30T00:00:00.000Z' }),
      date: '2026-10-31'
    })
    const result = await service.ensure({ document: onlyGaps(future, ['stablecoin']), cutoff: '2026-10-31T00:00:00.000Z' })

    expect(executor).not.toHaveBeenCalled()
    expect(result.statuses[0]).toMatchObject({ gapCode: 'future-as-of' })
  })

  it('never requests a funding or open-interest gap', async () => {
    const { service, executor } = build()
    const result = await service.ensure({ document: onlyGaps(document(), []), cutoff: asOf })

    expect(executor).not.toHaveBeenCalled()
    expect(result.filled).toEqual([])
  })

  it('never changes an official calendar actual', async () => {
    const calendarDocument = document({
      calendar: {
        state: 'available',
        events: [{
          eventKey: 'US.TEST',
          title: 'test-release',
          scheduledAt: '2026-10-29T12:00:00.000Z',
          importance: 'high',
          lifecycleState: 'released',
          category: 'economic-indicator',
          actual: '3.4%',
          previous: '3.2%',
          consensus: '3.2%',
          surprise: { direction: 'beat', value: 0.2, unit: 'pp' }
        }]
      }
    })
    const before = calendarDocument.news.macro[0]?.actual
    const { service } = build()
    const result = await service.ensure({ document: onlyGaps(calendarDocument, ['stablecoin']), cutoff: asOf })

    expect(result.changed).toBe(true)
    expect(result.document.news.macro[0]?.actual).toBe(before)
    expect(before).toBe('3.4%')
  })

  it('recomputes the capital reading when funds rows are filled', async () => {
    const { service } = build()
    const before = onlyGaps(document(), ['stablecoin', 'etf-btc', 'etf-eth'])
    expect(before.status.readings.find((entry) => entry.id === 'capital')?.state).not.toBe('available')
    const result = await service.ensure({ document: before, cutoff: asOf })

    expect(result.document.status.readings.find((entry) => entry.id === 'capital')?.state).toBe('available')
    expect(result.document.status.readingsAvailable).toBe(1)
  })

  it('leaves a stale row untouched', async () => {
    const base = onlyGaps(document(), ['stablecoin'])
    const stale = {
      ...base,
      data: {
        ...base.data,
        funds: base.data.funds.map((row) => row.id === 'stablecoin' ? available(row, 'stale') : row)
      }
    }
    const { service, executor } = build()
    const result = await service.ensure({ document: stale, cutoff: asOf })

    expect(executor).not.toHaveBeenCalled()
    expect(result.document.data.funds.find((row) => row.id === 'stablecoin')?.state).toBe('stale')
  })

  it('keeps the policy core metric list stable', () => {
    expect(dailyBriefCoreFactEnsurePolicy.metrics).toHaveLength(7)
  })
})
