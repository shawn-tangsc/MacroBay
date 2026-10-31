import { afterEach, describe, expect, it, vi } from 'vitest'

import { INTELLIGENCE_PUBLIC_QUERY_METHODS } from '../../../contracts/intelligencePublicQueryMethods'
import { marketDivergenceClient } from './marketDivergenceClient'

const asOf = '2026-10-30T12:00:00.000Z'
const at = (hoursAgo: number) => new Date(Date.parse(asOf) - hoursAgo * 3_600_000).toISOString()
const available = {
  state: 'available', asOf,
  rows: [{
    pairId: 'liquidity-leverage', direction: 'bearish', judgedBy: 'ai', mechanism: '弹药减少而空头加仓。', invalidation: '稳定币转正。',
    legs: [
      { id: 'stablecoin', value: -1.2, unit: 'percent', observedAt: at(2) },
      { id: 'open-interest', value: 3.4, unit: 'percent', observedAt: at(1) },
      { id: 'funding', value: -0.0032, unit: 'percent-per-8h', observedAt: at(1) }
    ],
  }],
  withheld: []
}

function bridge(value: unknown) {
  const products = { invoke: vi.fn(async () => value) }
  vi.stubGlobal('window', { platform: { products } })
  return products
}

afterEach(() => vi.unstubAllGlobals())

describe('divergence renderer client', () => {
  it('calls the one IPC method and returns the answered DTO', async () => {
    const products = bridge(available)
    await expect(marketDivergenceClient.query({ asOf })).resolves.toEqual(available)
    expect(products.invoke).toHaveBeenCalledWith('market-intelligence', INTELLIGENCE_PUBLIC_QUERY_METHODS.queryMarketDivergence, { asOf })
  })

  it('passes an empty answer through with its withheld list', async () => {
    const empty = { state: 'empty', asOf, withheld: [{ pairId: 'flows-price', reason: 'window-mismatch', leg: 'etf' }], judgedBy: 'rules' }
    bridge(empty)
    await expect(marketDivergenceClient.query({ asOf })).resolves.toEqual(empty)
  })

  it.each([
    ['a foreign pair', { ...available, rows: [{ ...available.rows[0], pairId: 'made-up' }] }],
    ['a missing direction', { ...available, rows: [{ ...available.rows[0], direction: undefined }] }],
    ['a leg without an instant', { ...available, rows: [{ ...available.rows[0], legs: [{ id: 'stablecoin', value: 1, unit: 'percent' }] }] }],
    ['an unknown unit', { ...available, rows: [{ ...available.rows[0], legs: [{ ...available.rows[0].legs[0], unit: 'blocks' }] }] }],
    ['a mismatched asOf', { ...available, asOf: '2026-10-30T13:00:00.000Z' }]
  ])('refuses %s', async (_name, value) => {
    bridge(value)
    await expect(marketDivergenceClient.query({ asOf })).resolves.toEqual({ state: 'unavailable', failureCode: 'market-divergence-query-unavailable', reason: 'query-failed', missing: [] })
  })

  it('refuses a non-canonical instant without calling the bridge', async () => {
    const products = bridge(available)
    await expect(marketDivergenceClient.query({ asOf: '2026-10-30 12:00' })).resolves.toMatchObject({ state: 'unavailable' })
    expect(products.invoke).not.toHaveBeenCalled()
  })
})
