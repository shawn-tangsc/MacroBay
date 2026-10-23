import { describe, expect, it } from 'vitest'

import {
  buildEtfCurrentStateWindow,
  etfCurrentStateWindowPolicy,
  isValidEtfCurrentStateWindow,
  type EtfDailyFlow
} from './etfCurrentStateWindow'

const asOf = '2026-08-31T00:00:00.000Z'

describe('ETF current-state window', () => {
  it('keeps only the bounded common complete BTC and ETH rows with a common five-day conclusion', () => {
    const result = buildEtfCurrentStateWindow(inputFor(flows('BTC', 6), flows('ETH', 6)))

    expect(result).toMatchObject({
      state: 'available',
      windowEnd: '2026-08-30',
      capitalConclusionDates: ['2026-08-26', '2026-08-27', '2026-08-28', '2026-08-29', '2026-08-30']
    })
    expect(result.state === 'available' && result.window.btc).toHaveLength(6)
  })

  it.each([
    ['missing field', { ...flows('BTC', 5)[0], netFlowUsd: undefined }],
    ['invalid field', { ...flows('BTC', 5)[0], netFlowUsd: Number.NaN }],
    ['future date', { ...flows('BTC', 5)[4], tradingDate: '2026-09-01' }],
    ['invalid calendar date', { ...flows('BTC', 5)[4], tradingDate: '2026-02-30' }],
    ['extra field', { ...flows('BTC', 5)[4], providerAlias: 'unexpected' }]
  ])('rejects a %s row without a partial window', (_label, invalid) => {
    const btc = [...flows('BTC', 5)]
    btc[btc.length - 1] = invalid as EtfDailyFlow

    expect(buildEtfCurrentStateWindow(inputFor(btc, flows('ETH', 5))))
      .toEqual({ state: 'unavailable' })
  })

  it('rejects duplicate, missing and non-common dates instead of zero filling either asset', () => {
    const duplicate = [...flows('BTC', 5), { ...flows('BTC', 5)[4], netFlowUsd: 999 }]
    const missing = flows('ETH', 5).slice(0, -1)

    expect(buildEtfCurrentStateWindow(inputFor(duplicate, flows('ETH', 5))))
      .toEqual({ state: 'unavailable' })
    expect(buildEtfCurrentStateWindow(inputFor(flows('BTC', 5), missing)))
      .toEqual({ state: 'unavailable' })
  })

  it('rejects a date gap and any complete-through date after the as-of day', () => {
    const gappedBtc = flows('BTC', 6).filter((flow) => flow.tradingDate !== '2026-08-27')
    const gappedEth = flows('ETH', 6).filter((flow) => flow.tradingDate !== '2026-08-27')

    expect(buildEtfCurrentStateWindow(inputFor(gappedBtc, gappedEth, flows('BTC', 6).map((flow) => flow.tradingDate))))
      .toEqual({ state: 'unavailable' })
    expect(buildEtfCurrentStateWindow({ ...inputFor(flows('BTC', 5), flows('ETH', 5)), completeThrough: '2026-09-01', completeDates: [...flows('BTC', 4).map((flow) => flow.tradingDate), '2026-09-01'] }))
      .toEqual({ state: 'unavailable' })
  })

  it('rejects more than the product-owned row capacity', () => {
    expect(buildEtfCurrentStateWindow(inputFor(
      flows('BTC', etfCurrentStateWindowPolicy.maximumRowsPerAsset + 1),
      flows('ETH', etfCurrentStateWindowPolicy.maximumRowsPerAsset + 1)
    ))).toEqual({ state: 'unavailable' })
  })

  it('rejects a persisted window whose end does not equal both asset tails', () => {
    const result = buildEtfCurrentStateWindow(inputFor(flows('BTC', 5), flows('ETH', 5)))
    if (result.state !== 'available') throw new Error('test window must be available')

    expect(isValidEtfCurrentStateWindow({ ...result.window, windowEnd: '2026-08-31' })).toBe(false)
  })
})

function inputFor(btc: readonly EtfDailyFlow[], eth: readonly EtfDailyFlow[], completeDates = btc.map((flow) => flow.tradingDate)) {
  return { asOf, completeThrough: completeDates.at(-1)!, completeDates, btc, eth }
}

function flows(asset: 'BTC' | 'ETH', count: number): readonly EtfDailyFlow[] {
  const firstDay = Date.parse('2026-08-25T00:00:00.000Z')
  return Array.from({ length: count }, (_, index) => ({
    asset,
    tradingDate: new Date(firstDay + index * 24 * 60 * 60 * 1_000).toISOString().slice(0, 10),
    netFlowUsd: asset === 'BTC' ? index + 1 : -(index + 1),
    observedAt: '2026-08-31T00:00:00.000Z',
    fetchedAt: '2026-08-31T00:00:00.000Z',
    source: '0xrouter'
  }))
}
