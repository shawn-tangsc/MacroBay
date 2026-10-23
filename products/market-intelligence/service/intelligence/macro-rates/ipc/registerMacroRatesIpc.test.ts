import { describe, expect, it } from 'vitest'

import type { ProductIpcRegistrar } from '@platform/desktop/ipc/productIpcRegistry'

import { macroRatesSnapshotPublicPolicy } from '../../../../contracts/macro/macroRatesSnapshotContracts'
import { createMacroRatesSnapshotQuery } from '../macroRatesSnapshotQuery'
import { registerMacroRatesIpc } from './registerMacroRatesIpc'
import type { MetricIntelligenceEvent } from '../../schema/intelligenceMetricEvent'

const now = Date.parse('2026-10-14T12:00:00.000Z')

function event(overrides: Partial<MetricIntelligenceEvent> = {}): MetricIntelligenceEvent {
  return {
    metricEventId: 'metric-1', itemId: 'item-1', sourceId: 'fred-rates-liquidity',
    metricKey: 'US_10Y_YIELD', metricName: 'US 10Y Treasury Yield', metricKind: 'treasury-yield',
    actual: 5.24, previous: 5.22, unit: 'percent', period: '2026-10-09',
    releaseTime: '2026-10-09T00:00:00.000Z', comparisonBasis: 'period-change',
    surpriseDirection: 'up', metricVersion: 'metric-rest-api-v1', ...overrides
  }
}

function handler(metrics: MetricIntelligenceEvent[], clock = () => now) {
  const handlers = new Map<string, (payload: unknown) => unknown>()
  const register: ProductIpcRegistrar = (productId, method, registered) => { handlers.set(`${productId}:${method}`, registered) }
  const query = createMacroRatesSnapshotQuery({ listMetricEvents: () => metrics, now: clock })
  registerMacroRatesIpc(register, { snapshot: query.snapshot })
  return handlers.get(`market-intelligence:${macroRatesSnapshotPublicPolicy.method}`)!
}

describe('macro rates snapshot IPC', () => {
  it('answers the empty request with the sanitised daily readings', async () => {
    const result = await handler([event()])({})

    expect(result).toEqual({
      state: 'available', asOf: '2026-10-14T12:00:00.000Z', caveats: ['official-daily-close'],
      readings: [{ seriesId: 'DGS10', metricKey: 'US_10Y_YIELD', actual: 5.24, previous: 5.22, period: '2026-10-09' }]
    })
  })

  it('answers empty, with the daily caveat, when the store has no FRED observation', async () => {
    expect(await handler([])({})).toEqual({
      state: 'empty', asOf: '2026-10-14T12:00:00.000Z', readings: [], caveats: ['official-daily-close']
    })
  })

  it.each([undefined, null, { asOf: '2026-10-14T12:00:00.000Z' }, { range: '24h' }, [], 'query'])(
    'rejects the non-empty request %o without touching the store', async payload => {
      let reads = 0
      const handlers = new Map<string, (payload: unknown) => unknown>()
      registerMacroRatesIpc(((productId, method, registered) => { handlers.set(`${productId}:${method}`, registered) }) as ProductIpcRegistrar,
        { snapshot: () => { reads += 1; return { state: 'empty', asOf: new Date(now).toISOString(), readings: [], caveats: [] } } })

      expect(await handlers.get(`market-intelligence:${macroRatesSnapshotPublicPolicy.method}`)!(payload)).toEqual({ state: 'unavailable' })
      expect(reads).toBe(0)
    })

  it('collapses a failing query to unavailable rather than inventing a reading', async () => {
    const handlers = new Map<string, (payload: unknown) => unknown>()
    registerMacroRatesIpc(((productId, method, registered) => { handlers.set(`${productId}:${method}`, registered) }) as ProductIpcRegistrar,
      { snapshot: () => { throw new Error('store-unavailable') } })

    expect(await handlers.get(`market-intelligence:${macroRatesSnapshotPublicPolicy.method}`)!({})).toEqual({ state: 'unavailable' })
  })

  it('refuses to publish a reading whose period is not an observation date', async () => {
    const handlers = new Map<string, (payload: unknown) => unknown>()
    registerMacroRatesIpc(((productId, method, registered) => { handlers.set(`${productId}:${method}`, registered) }) as ProductIpcRegistrar, {
      snapshot: () => ({
        state: 'available' as const, asOf: new Date(now).toISOString(), caveats: ['official-daily-close'],
        readings: [{ seriesId: 'DGS10', metricKey: 'US_10Y_YIELD', actual: 5.24, period: 'today' }]
      })
    })

    expect(await handlers.get(`market-intelligence:${macroRatesSnapshotPublicPolicy.method}`)!({})).toEqual({ state: 'unavailable' })
  })
})
