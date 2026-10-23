import { describe, expect, it, vi } from 'vitest'
import { performance } from 'node:perf_hooks'

import { createCapitalConditionsCurrentStateStore, createInMemoryCapitalConditionsStateStorage } from './stablecoinCapitalCurrentStateStore'
import { capitalConditionsSafeQueryPolicy, createCapitalConditionsSnapshotQueryService } from './capitalConditionsSnapshotQuery'
import { buildEtfCurrentStateWindow, type EtfDailyFlow } from '../etf/etfCurrentStateWindow'
import { createEtfCurrentStateRefreshService } from '../etf/etfCurrentStateRefreshService'
import { createEtfCurrentStateStore, createInMemoryEtfCurrentStateStorage } from '../store/etfCurrentStateStore'

const verifiedAt = '2026-08-17T00:00:00.000Z'
const snapshot = {
  coreCurrentUsd: 310,
  change1dUsd: 10,
  change1dPercent: 10 / 300 * 100,
  change7dUsd: 10,
  change7dPercent: 10 / 300 * 100,
  change30dUsd: 30,
  change30dPercent: 30 / 280 * 100,
  usdStablecoinSupplyUsd: 315
} as const

describe('capital conditions snapshot query', () => {
  it('projects a freshly refreshed BTC/ETH ETF window through the safe public query only', async () => {
    const stablecoinStore = createCapitalConditionsCurrentStateStore({ storage: createInMemoryCapitalConditionsStateStorage() })
    await stablecoinStore.recordSuccess({ snapshot, verifiedAt })
    const etfStore = createEtfCurrentStateStore({ storage: createInMemoryEtfCurrentStateStorage() })
    const refresh = createEtfCurrentStateRefreshService({
      isEnabled: async () => true,
      hasCredential: async () => true,
      requestWindow: async () => ({ state: 'available' as const, btc: flowRows('BTC'), eth: flowRows('ETH') }),
      store: etfStore,
      now: () => '2026-08-17T01:00:00.000Z'
    })
    const service = createCapitalConditionsSnapshotQueryService({ store: stablecoinStore, etfStore })

    await expect(refresh.refresh()).resolves.toEqual({ state: 'updated' })
    await expect(service.query({ asOf: '2026-08-17T01:00:00.000Z' })).resolves.toMatchObject({
      state: 'available',
      etf: {
        state: 'available', windowEnd: '2026-08-16',
        btc: { asset: 'BTC', rows: expect.arrayContaining([expect.objectContaining({ netFlowUsd: 1 })]) },
        eth: { asset: 'ETH', rows: expect.arrayContaining([expect.objectContaining({ netFlowUsd: -1 })]) }
      }
    })
  })

  it('projects a verified ETF window into a versioned safe DTO without provider metadata', async () => {
    const stablecoinStore = createCapitalConditionsCurrentStateStore({ storage: createInMemoryCapitalConditionsStateStorage() })
    await stablecoinStore.recordSuccess({ snapshot, verifiedAt })
    const etfStore = createEtfCurrentStateStore({ storage: createInMemoryEtfCurrentStateStorage() })
    const window = etfWindow()
    await etfStore.replace({ window, verifiedAt })
    const service = createCapitalConditionsSnapshotQueryService({ store: stablecoinStore, etfStore })

    await expect(service.query({ asOf: '2026-08-17T01:00:00.000Z' })).resolves.toMatchObject({
      state: 'available',
      etf: {
        state: 'available', schemaVersion: 1, sourceId: '0xrouter', verifiedAt,
        windowEnd: '2026-08-16',
        btc: { asset: 'BTC', rows: expect.arrayContaining([{ tradingDate: '2026-08-12', netFlowUsd: 1, observedAt: verifiedAt }]) },
        eth: { asset: 'ETH' }
      }
    })
    const result = await service.query({ asOf: '2026-08-17T01:00:00.000Z' })
    expect(JSON.stringify(result)).not.toMatch(/fetchedAt|sourceRevision|provider|url|key|queue|raw/i)
  })

  it('keeps ETF unavailable when the verified snapshot is strictly older than 48 hours', async () => {
    const stablecoinStore = createCapitalConditionsCurrentStateStore({ storage: createInMemoryCapitalConditionsStateStorage() })
    await stablecoinStore.recordSuccess({ snapshot, verifiedAt })
    const etfStore = createEtfCurrentStateStore({ storage: createInMemoryEtfCurrentStateStorage() })
    await etfStore.replace({ window: etfWindow('2026-08-15T00:59:59.999Z'), verifiedAt: '2026-08-15T00:59:59.999Z' })
    const service = createCapitalConditionsSnapshotQueryService({ store: stablecoinStore, etfStore })

    await expect(service.query({ asOf: '2026-08-17T01:00:00.000Z' })).resolves.toMatchObject({ etf: { state: 'unavailable' } })
  })

  it('keeps ETF visible exactly at the product-owned 48-hour boundary', async () => {
    const stablecoinStore = createCapitalConditionsCurrentStateStore({ storage: createInMemoryCapitalConditionsStateStorage() })
    await stablecoinStore.recordSuccess({ snapshot, verifiedAt: '2026-08-17T00:00:00.000Z' })
    const etfStore = createEtfCurrentStateStore({ storage: createInMemoryEtfCurrentStateStorage() })
    await etfStore.replace({ window: etfWindow('2026-08-15T01:00:00.000Z'), verifiedAt: '2026-08-15T01:00:00.000Z' })
    const service = createCapitalConditionsSnapshotQueryService({ store: stablecoinStore, etfStore })
    await expect(service.query({ asOf: '2026-08-17T01:00:00.000Z' })).resolves.toMatchObject({ etf: { state: 'available' } })
  })

  it('keeps the complete legal 30-row BTC/ETH ETF DTO within the named response budget', async () => {
    const stablecoinStore = createCapitalConditionsCurrentStateStore({ storage: createInMemoryCapitalConditionsStateStorage() })
    await stablecoinStore.recordSuccess({ snapshot: { ...snapshot, usdStablecoinSupplyUsd: 1 }, verifiedAt })
    const etfStore = createEtfCurrentStateStore({ storage: createInMemoryEtfCurrentStateStorage() })
    await etfStore.replace({ window: etfWindow(verifiedAt, 30), verifiedAt })
    const service = createCapitalConditionsSnapshotQueryService({ store: stablecoinStore, etfStore })

    await expect(service.query({ asOf: '2026-08-17T01:00:00.000Z' })).resolves.toMatchObject({ state: 'available', etf: { state: 'available' } })
  })
  it('returns a frozen, redacted current snapshot only at a canonical visible time', async () => {
    const store = createCapitalConditionsCurrentStateStore({ storage: createInMemoryCapitalConditionsStateStorage() })
    await store.recordSuccess({ snapshot, verifiedAt })
    const service = createCapitalConditionsSnapshotQueryService({ store })

    const result = await service.query({ asOf: '2026-08-17T01:00:00.000Z' })

    expect(result).toEqual({
      state: 'available',
      asOf: '2026-08-17T01:00:00.000Z',
      etf: { state: 'unavailable' },
      coreStablecoins: {
        observedAt: verifiedAt,
        verifiedAt,
        currentUsd: 310,
        change1dUsd: 10,
        change1dPercent: 10 / 300 * 100,
        change7dUsd: 10,
        change7dPercent: 10 / 300 * 100,
        change30dUsd: 30,
        change30dPercent: 30 / 280 * 100
      },
      usdStablecoinSupplyUsd: 315,
      conclusion: 'partial'
    })
    expect(Object.isFrozen(result)).toBe(true)
    expect(JSON.stringify(result)).not.toMatch(/url|payload|hash|raw|http|proxy|error|path/i)
  })

  it('returns empty before a current snapshot was verified instead of presenting it as historical state', async () => {
    const store = createCapitalConditionsCurrentStateStore({ storage: createInMemoryCapitalConditionsStateStorage() })
    await store.recordSuccess({ snapshot, verifiedAt })
    const service = createCapitalConditionsSnapshotQueryService({ store })

    await expect(service.query({ asOf: '2026-08-16T23:59:59.999Z' })).resolves.toEqual({
      state: 'empty',
      asOf: '2026-08-16T23:59:59.999Z'
    })
  })

  it('passes the persisted daily stablecoin history through the safe query DTO', async () => {
    const store = createCapitalConditionsCurrentStateStore({ storage: createInMemoryCapitalConditionsStateStorage() })
    await store.recordSuccess({ snapshot: { ...snapshot, dailyFlows: ['2026-08-12', '2026-08-13', '2026-08-14', '2026-08-15', '2026-08-16'].map((tradingDate, index) => ({ tradingDate, netFlowUsd: index === 4 ? -1 : 2 })) }, verifiedAt })
    const service = createCapitalConditionsSnapshotQueryService({ store })
    await expect(service.query({ asOf: '2026-08-17T01:00:00.000Z' })).resolves.toMatchObject({
      state: 'available',
      coreStablecoins: { dailyFlows: expect.arrayContaining([
        { tradingDate: '2026-08-15', netFlowUsd: 2 },
        { tradingDate: '2026-08-16', netFlowUsd: -1 }
      ]) }
    })
  })

  it('returns empty rather than inventing daily history before the persisted window', async () => {
    const store = createCapitalConditionsCurrentStateStore({ storage: createInMemoryCapitalConditionsStateStorage() })
    await store.recordSuccess({ snapshot: { ...snapshot, dailyFlows: ['2026-08-12', '2026-08-13', '2026-08-14', '2026-08-15', '2026-08-16'].map((tradingDate, index) => ({ tradingDate, netFlowUsd: index + 1 })) }, verifiedAt: '2026-08-10T00:00:00.000Z' })
    const service = createCapitalConditionsSnapshotQueryService({ store })
    await expect(service.query({ asOf: '2026-08-11T00:00:00.000Z' })).resolves.toEqual({ state: 'empty', asOf: '2026-08-11T00:00:00.000Z' })
  })

  it('fails closed exactly beyond the six-hour freshness boundary and on unsafe input', async () => {
    const store = createCapitalConditionsCurrentStateStore({ storage: createInMemoryCapitalConditionsStateStorage() })
    await store.recordSuccess({ snapshot, verifiedAt })
    const service = createCapitalConditionsSnapshotQueryService({ store })

    await expect(service.query({ asOf: '2026-08-17T06:00:00.000Z' })).resolves.toMatchObject({ state: 'available' })
    await expect(service.query({ asOf: '2026-08-17T06:00:00.001Z' })).resolves.toEqual({
      state: 'unavailable',
      failureCode: 'capital-conditions-query-unavailable'
    })
    await expect(service.query({ asOf: '2026-08-17T01:00:00Z' } as never)).resolves.toEqual({
      state: 'unavailable',
      failureCode: 'capital-conditions-query-unavailable'
    })
  })

  it('returns unavailable before reading current state when the source profile is disabled', async () => {
    const store = {
      read: vi.fn()
    } as never
    const service = createCapitalConditionsSnapshotQueryService({
      store,
      isEnabled: async () => false
    })

    await expect(service.query({ asOf: '2026-08-17T01:00:00.000Z' })).resolves.toEqual({
      state: 'unavailable',
      failureCode: 'capital-conditions-query-unavailable'
    })
    expect(store.read).not.toHaveBeenCalled()
  })

  it('fails closed instead of projecting a future or inconsistent current snapshot', async () => {
    const store = {
      read: async () => ({
        schemaVersion: 1,
        snapshot: { ...snapshot, observedAt: '2026-08-17T02:00:00.000Z', verifiedAt },
        health: { status: 'healthy', lastAttemptAt: verifiedAt, lastSuccessAt: verifiedAt, consecutiveFailures: 0, snapshotReplaceCount: 1, snapshotNoWriteCount: 0, rejectionCount: 0, responseBodyTooLargeCount: 0 }
      })
    } as never
    const service = createCapitalConditionsSnapshotQueryService({ store })

    await expect(service.query({ asOf: '2026-08-17T03:00:00.000Z' })).resolves.toEqual({
      state: 'unavailable', failureCode: 'capital-conditions-query-unavailable'
    })
  })

  it('measures the bounded safe DTO and query p95 within their resource budgets', async () => {
    const store = createCapitalConditionsCurrentStateStore({ storage: createInMemoryCapitalConditionsStateStorage() })
    await store.recordSuccess({ snapshot, verifiedAt })
    const service = createCapitalConditionsSnapshotQueryService({ store })
    const samples: number[] = []
    let result: Awaited<ReturnType<typeof service.query>> | undefined

    for (let index = 0; index < 25; index += 1) {
      const startedAt = performance.now()
      result = await service.query({ asOf: '2026-08-17T01:00:00.000Z' })
      samples.push(performance.now() - startedAt)
    }

    expect(Buffer.byteLength(JSON.stringify(result), 'utf8')).toBeLessThanOrEqual(capitalConditionsSafeQueryPolicy.maximumDtoBytes)
    expect(p95(samples)).toBeLessThanOrEqual(10)
  })
})

function etfWindow(observedAt = verifiedAt, rowCount = 5) {
  const windowAsOf = verifiedAt
  const dates = Array.from({ length: rowCount }, (_, index) => new Date(Date.parse(rowCount === 5 ? '2026-08-12T00:00:00.000Z' : '2026-07-18T00:00:00.000Z') + index * 24 * 60 * 60 * 1_000).toISOString().slice(0, 10))
  const result = buildEtfCurrentStateWindow({
    asOf: windowAsOf,
    completeThrough: dates.at(-1)!,
    completeDates: dates,
    btc: etfFlows('BTC', observedAt, dates),
    eth: etfFlows('ETH', observedAt, dates)
  })
  if (result.state !== 'available') throw new Error('test ETF window must be available')
  return result.window
}

function etfFlows(asset: 'BTC' | 'ETH', observedAt: string, dates: readonly string[]): readonly EtfDailyFlow[] {
  return dates.map((tradingDate, index) => ({
    asset, tradingDate, netFlowUsd: asset === 'BTC' ? index + 1 : -(index + 1), observedAt, fetchedAt: observedAt, source: '0xrouter'
  }))
}

function flowRows(asset: 'BTC' | 'ETH') {
  return Array.from({ length: 5 }, (_, index) => ({
    date: Date.parse(`2026-08-${String(12 + index).padStart(2, '0')}T00:00:00.000Z`),
    change: index + 1,
    changeUsd: asset === 'BTC' ? index + 1 : -(index + 1),
    list: [{ name: 'example', ticker: asset }]
  }))
}

function p95(samples: readonly number[]): number {
  return [...samples].sort((left, right) => left - right)[Math.ceil(samples.length * 0.95) - 1]!
}
