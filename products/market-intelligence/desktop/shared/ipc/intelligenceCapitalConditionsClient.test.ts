// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'

import { INTELLIGENCE_PUBLIC_QUERY_METHODS } from '../../../contracts/intelligencePublicQueryMethods'
import { intelligenceCapitalConditionsClient } from './intelligenceCapitalConditionsClient'

const asOf = '2026-08-18T12:00:00.000Z'
const result = {
  state: 'available' as const, asOf, etf: { state: 'unavailable' as const },
  coreStablecoins: {
    observedAt: '2026-08-18T10:00:00.000Z', verifiedAt: '2026-08-18T10:00:00.000Z', currentUsd: 310,
    change1dUsd: 10, change1dPercent: 3, change7dUsd: 10, change7dPercent: 3, change30dUsd: 30, change30dPercent: 10
  }, conclusion: 'partial' as const
}
const etf = {
  state: 'available' as const, schemaVersion: 1, sourceId: '0xrouter', windowEnd: '2026-08-18',
  btc: { asset: 'BTC' as const, rows: ['2026-08-14', '2026-08-15', '2026-08-16', '2026-08-17', '2026-08-18'].map((tradingDate, index) => ({ tradingDate, netFlowUsd: index + 1, observedAt: '2026-08-18T10:00:00.000Z' })) },
  eth: { asset: 'ETH' as const, rows: ['2026-08-14', '2026-08-15', '2026-08-16', '2026-08-17', '2026-08-18'].map((tradingDate, index) => ({ tradingDate, netFlowUsd: -(index + 1), observedAt: '2026-08-18T10:00:00.000Z' })) },
  verifiedAt: '2026-08-18T10:00:00.000Z'
}

afterEach(() => vi.unstubAllGlobals())

describe('intelligenceCapitalConditionsClient', () => {
  it('reconstructs only the exact safe result', async () => {
    const invoke = vi.fn(async () => result)
    vi.stubGlobal('window', { platform: { products: { invoke } } })

    await expect(intelligenceCapitalConditionsClient.querySnapshot({ asOf })).resolves.toEqual(result)
    expect(invoke).toHaveBeenCalledWith('market-intelligence', INTELLIGENCE_PUBLIC_QUERY_METHODS.queryCapitalConditionsSnapshot, { asOf })
  })

  it('retains the optional finite USD stablecoin background without accepting extensions', async () => {
    const invoke = vi.fn(async () => ({ ...result, usdStablecoinSupplyUsd: 315 }))
    vi.stubGlobal('window', { platform: { products: { invoke } } })

    await expect(intelligenceCapitalConditionsClient.querySnapshot({ asOf })).resolves.toEqual({
      ...result, usdStablecoinSupplyUsd: 315
    })
  })

  it('reconstructs only compact daily stablecoin flows', async () => {
    const dailyFlows = ['2026-08-13', '2026-08-14', '2026-08-15', '2026-08-16', '2026-08-17'].map((tradingDate, index) => ({ tradingDate, netFlowUsd: index + 1 }))
    const invoke = vi.fn(async () => ({ ...result, coreStablecoins: { ...result.coreStablecoins, dailyFlows } }))
    vi.stubGlobal('window', { platform: { products: { invoke } } })
    await expect(intelligenceCapitalConditionsClient.querySnapshot({ asOf })).resolves.toEqual({ ...result, coreStablecoins: { ...result.coreStablecoins, dailyFlows } })
  })

  it('rejects a daily stablecoin window containing the as-of current day', async () => {
    const dailyFlows = ['2026-08-14', '2026-08-15', '2026-08-16', '2026-08-17', '2026-08-18'].map((tradingDate, index) => ({ tradingDate, netFlowUsd: index + 1 }))
    const invoke = vi.fn(async () => ({ ...result, coreStablecoins: { ...result.coreStablecoins, dailyFlows } }))
    vi.stubGlobal('window', { platform: { products: { invoke } } })

    await expect(intelligenceCapitalConditionsClient.querySnapshot({ asOf })).resolves.toEqual({ state: 'unavailable', failureCode: 'capital-conditions-query-unavailable' })
  })

  it('reconstructs a versioned ETF DTO while rejecting provider metadata', async () => {
    const invoke = vi.fn(async () => ({ ...result, etf }))
    vi.stubGlobal('window', { platform: { products: { invoke } } })
    await expect(intelligenceCapitalConditionsClient.querySnapshot({ asOf })).resolves.toMatchObject({ etf })

    const poisoned = vi.fn(async () => ({ ...result, etf: { ...etf, providerPayload: 'secret' } }))
    vi.stubGlobal('window', { platform: { products: { invoke: poisoned } } })
    await expect(intelligenceCapitalConditionsClient.querySnapshot({ asOf })).resolves.toEqual({ state: 'unavailable', failureCode: 'capital-conditions-query-unavailable' })
  })

  it('passes a complete legal 30-row BTC/ETH ETF DTO through the renderer client within the named response budget', async () => {
    const invoke = vi.fn(async () => ({ ...result, etf: fullEtf() }))
    vi.stubGlobal('window', { platform: { products: { invoke } } })

    await expect(intelligenceCapitalConditionsClient.querySnapshot({ asOf })).resolves.toMatchObject({ state: 'available', etf: { state: 'available' } })
  })

  it.each([
    [{ asOf: '2026-08-18T12:00:00Z' }],
    [{ asOf, [Symbol('secret')]: true }],
    [Object.defineProperty({}, 'asOf', { enumerable: true, get: () => asOf })]
  ])('rejects poisoned input before bridge invocation', async (input) => {
    const invoke = vi.fn()
    vi.stubGlobal('window', { platform: { products: { invoke } } })

    await expect(intelligenceCapitalConditionsClient.querySnapshot(input as never)).resolves.toEqual({ state: 'unavailable', failureCode: 'capital-conditions-query-unavailable' })
    expect(invoke).not.toHaveBeenCalled()
  })
})

function fullEtf() {
  const dates = Array.from({ length: 30 }, (_, index) => new Date(Date.parse('2026-07-20T00:00:00.000Z') + index * 24 * 60 * 60 * 1_000).toISOString().slice(0, 10))
  return {
    state: 'available' as const, schemaVersion: 1, sourceId: '0xrouter', windowEnd: dates.at(-1)!, verifiedAt: '2026-08-18T10:00:00.000Z',
    btc: { asset: 'BTC' as const, rows: dates.map((tradingDate, index) => ({ tradingDate, netFlowUsd: index + 1, observedAt: '2026-08-18T10:00:00.000Z' })) },
    eth: { asset: 'ETH' as const, rows: dates.map((tradingDate, index) => ({ tradingDate, netFlowUsd: -(index + 1), observedAt: '2026-08-18T10:00:00.000Z' })) }
  }
}
