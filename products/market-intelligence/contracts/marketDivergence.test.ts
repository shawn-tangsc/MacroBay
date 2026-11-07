import { describe, expect, it } from 'vitest'

import {
  detectDivergences,
  divergencePairBounds,
  divergencePolicy,
  isCanonicalDivergenceTime,
  isMarketDivergenceResult,
  type DivergenceInputs
} from './marketDivergence'

const asOf = '2026-10-30T12:00:00.000Z'
const at = (hoursAgo: number) => new Date(Date.parse(asOf) - hoursAgo * 3_600_000).toISOString()
const session = (daysAgo: number) => new Date(Date.parse(asOf) - daysAgo * 86_400_000).toISOString().slice(0, 10)

/** All three pairs hold; each test spoils one leg. */
function inputs(overrides: Partial<DivergenceInputs> = {}): DivergenceInputs {
  return {
    asOf,
    stablecoin: { change7dPercent: -1.2, observedAt: at(2) },
    etf: { rows: [{ tradingDate: session(1), netFlowUsd: -60e6 }, { tradingDate: session(2), netFlowUsd: -50e6 }, { tradingDate: session(3), netFlowUsd: -40e6 }] },
    openInterest: { change24hPct: 3.4, observedAt: at(1) },
    funding: { ratePercent: -0.0032, observedAt: at(1) },
    price: { return24hPercent: 0.2, observedAt: at(1) },
    sentiment: { bearishSharePercent: 72, scoredCount: 11, observedAt: at(1) },
    ...overrides
  }
}

describe('divergence pairs', () => {
  it('names the three configured pairs and refuses anything else', () => {
    expect([...divergencePolicy.pairs]).toEqual(['liquidity-leverage', 'flows-price', 'narrative-price'])
  })

  it('reports money leaving while open interest rises and shorts pay', () => {
    const result = detectDivergences(inputs())
    expect(result.state).toBe('available')
    if (result.state !== 'available') return
    const row = result.rows.find(entry => entry.pairId === 'liquidity-leverage')!
    expect(row.direction).toBe('bearish')
    expect(row.legs.map(leg => leg.id)).toEqual(['stablecoin', 'open-interest', 'funding'])
    expect(row.direction).toBe('bearish')
  })

  it('stays quiet when the legs agree — agreement is the default state, not a row', () => {
    const result = detectDivergences(inputs({
      stablecoin: { change7dPercent: -1.2, observedAt: at(2) },
      openInterest: { change24hPct: -4, observedAt: at(1) },
      price: { return24hPercent: -2, observedAt: at(1) },
      sentiment: { bearishSharePercent: 20, scoredCount: 9, observedAt: at(1) }
    }))
    expect(result.state).toBe('empty')
    if (result.state !== 'empty') return
    // empty 变体不带 rows：断言字段本身不存在，比断言「空数组」更准
    expect(result).not.toHaveProperty('rows')
    expect(result.withheld).toHaveLength(0)
  })

  it('reads spot absorbing a sell-off as the bullish case', () => {
    const result = detectDivergences(inputs({ openInterest: { change24hPct: -3.5, observedAt: at(1) } }))
    if (result.state !== 'available') throw new Error('expected rows')
    const row = result.rows.find(entry => entry.pairId === 'flows-price')!
    expect(row.direction).toBe('bullish')
    expect(row.legs.find(leg => leg.id === 'etf')!.value).toBe(-150e6)
  })

  it('marks bad news that changed nothing as unpriced', () => {
    const result = detectDivergences(inputs({ openInterest: { change24hPct: 0.2, observedAt: at(1) } }))
    if (result.state !== 'available') throw new Error('expected rows')
    const row = result.rows.find(entry => entry.pairId === 'narrative-price')!
    expect(row.direction).toBe('unpriced')
    expect(row.legs.find(leg => leg.id === 'sentiment')!.value).toBe(72)
  })
})

describe('window alignment', () => {
  it('refuses a pair whose daily leg describes an older day', () => {
    // Friday's ETF session on a Monday morning: the market was shut in between.
    const result = detectDivergences(inputs({ asOf: '2026-11-02T12:00:00.000Z', stablecoin: { change7dPercent: -1.2, observedAt: '2026-11-02T06:00:00.000Z' }, openInterest: { change24hPct: 3.4, observedAt: '2026-11-02T11:00:00.000Z' }, funding: { ratePercent: -0.0032, observedAt: '2026-11-02T11:00:00.000Z' }, price: { return24hPercent: 0.2, observedAt: '2026-11-02T11:00:00.000Z' } }))
    if (result.state === 'unavailable') throw new Error('unexpected')
    expect(result.withheld).toContainEqual(expect.objectContaining({ pairId: 'flows-price', reason: 'window-mismatch', leg: 'etf' }))
    const rows = result.state === 'available' ? result.rows : []
    expect(rows.some(row => row.pairId === 'flows-price')).toBe(false)
  })

  it('refuses instead of showing a half pair when a leg is missing', () => {
    const result = detectDivergences(inputs({ funding: undefined }))
    if (result.state === 'unavailable') throw new Error('unexpected')
    expect(result.withheld).toContainEqual({ pairId: 'liquidity-leverage', reason: 'leg-missing', leg: 'funding' })
    const rows = result.state === 'available' ? result.rows : []
    expect(rows.some(row => row.pairId === 'liquidity-leverage')).toBe(false)
  })

  it('names the stale leg rather than using an old reading', () => {
    const result = detectDivergences(inputs({ openInterest: { change24hPct: 3.4, observedAt: at(20) } }))
    if (result.state === 'unavailable') throw new Error('unexpected')
    expect(result.withheld).toContainEqual({ pairId: 'liquidity-leverage', reason: 'leg-stale', leg: 'open-interest' })
  })

  it('judges funding on its own settlement cycle: seven hours old is the freshest reading there is', () => {
    const result = detectDivergences(inputs({ funding: { ratePercent: -0.0032, observedAt: at(7) } }))
    if (result.state === 'unavailable') throw new Error('unexpected')
    expect(result.withheld.some(entry => entry.leg === 'funding')).toBe(false)
    expect(result.state === 'available' && result.rows.some(row => row.pairId === 'liquidity-leverage')).toBe(true)
  })

  it('still calls funding stale past one settlement cycle plus a poll of slack', () => {
    const result = detectDivergences(inputs({ funding: { ratePercent: -0.0032, observedAt: at(10) } }))
    if (result.state === 'unavailable') throw new Error('unexpected')
    expect(result.withheld).toContainEqual({ pairId: 'liquidity-leverage', reason: 'leg-stale', leg: 'funding' })
  })

  it('separates a leg that could not be read from one the market never sent', () => {
    const unreadable = detectDivergences(inputs({ price: undefined, faulted: ['price'] }))
    const absent = detectDivergences(inputs({ price: undefined }))
    if (unreadable.state === 'unavailable' || absent.state === 'unavailable') throw new Error('unexpected')
    expect(unreadable.withheld).toContainEqual({ pairId: 'flows-price', reason: 'leg-unavailable', leg: 'price' })
    expect(absent.withheld).toContainEqual({ pairId: 'flows-price', reason: 'leg-missing', leg: 'price' })
  })

  it('needs three finished sessions before it will sum ETF flows', () => {
    const result = detectDivergences(inputs({ etf: { rows: [{ tradingDate: session(1), netFlowUsd: -60e6 }] } }))
    if (result.state === 'unavailable') throw new Error('unexpected')
    expect(result.withheld).toContainEqual({ pairId: 'flows-price', reason: 'leg-stale', leg: 'etf' })
  })

  it('returns empty, not unavailable, when every pair is withheld', () => {
    const result = detectDivergences(inputs({ stablecoin: undefined, etf: undefined, sentiment: undefined }))
    expect(result.state).toBe('empty')
    if (result.state !== 'empty') return
    expect(result.withheld).toHaveLength(3)
  })

  it('refuses a clock that is not canonical UTC', () => {
    expect(detectDivergences({ ...inputs(), asOf: '2026-10-30 12:00' }).state).toBe('unavailable')
    expect(isCanonicalDivergenceTime('2026-10-30T12:00:00.000Z')).toBe(true)
    expect(isCanonicalDivergenceTime('2026-10-30T12:00:00Z')).toBe(false)
  })
})

describe('the bound a pair was judged on', () => {
  /** 上界一侧（持仓 ≥ +3%）：钱在撤、空头在加。 */
  const upperBoundCase = () => inputs()
  /** 下界一侧（持仓 ≤ −3%）：资金撤出、价格没跌。 */
  const lowerBoundCase = () => inputs({
    stablecoin: { change7dPercent: 0.4, observedAt: at(2) },
    openInterest: { change24hPct: -3.4, observedAt: at(1) },
    price: { return24hPercent: 0.2, observedAt: at(1) },
    sentiment: { bearishSharePercent: 20, scoredCount: 4, observedAt: at(1) }
  })

  it('writes the bound the verdict turned on, for both an upper and a lower bound', () => {
    const upper = detectDivergences(upperBoundCase())
    if (upper.state !== 'available') throw new Error('unexpected')
    const upperRow = upper.rows.find(row => row.pairId === 'liquidity-leverage')!
    expect(upperRow.bound).toEqual({
      leg: 'open-interest', comparator: 'atLeast', threshold: divergencePolicy.thresholds.openInterest24hUpPercent
    })

    const lower = detectDivergences(lowerBoundCase())
    if (lower.state !== 'available') throw new Error('unexpected')
    const lowerRow = lower.rows.find(row => row.pairId === 'flows-price')!
    expect(lowerRow.bound).toEqual({
      leg: 'open-interest', comparator: 'atMost', threshold: divergencePolicy.thresholds.openInterest24hDownPercent
    })
  })

  it('never puts a bound on a pair that could not be judged', () => {
    // 判不了不是「差一点」：给它显示阈值会被读成快到界了。
    const result = detectDivergences(inputs({ sentiment: undefined }))
    if (result.state === 'unavailable') throw new Error('unexpected')
    expect(result.withheld).toContainEqual({ pairId: 'narrative-price', reason: 'leg-missing', leg: 'sentiment' })
    for (const entry of result.withheld) expect('bound' in entry).toBe(false)
    // 命中的那几行则必须有，值就是那一刻用的界。
    for (const row of result.state === 'available' ? result.rows : []) {
      expect(row.bound).toEqual(divergencePairBounds[row.pairId])
    }
  })

  it('keeps the static table and the verdict on the same numbers', () => {
    // 这条是「规则改了、文案没改」的钉子：两边的界逐对相等，否则红。
    expect(divergencePairBounds).toEqual({
      'liquidity-leverage': {
        leg: 'open-interest', comparator: 'atLeast', threshold: divergencePolicy.thresholds.openInterest24hUpPercent
      },
      'flows-price': {
        leg: 'open-interest', comparator: 'atMost', threshold: divergencePolicy.thresholds.openInterest24hDownPercent
      },
      'narrative-price': {
        leg: 'open-interest', comparator: 'atMost', threshold: divergencePolicy.thresholds.openInterestFlatPercent
      }
    })
    const result = detectDivergences(upperBoundCase())
    if (result.state !== 'available') throw new Error('unexpected')
    for (const row of result.rows) expect(row.bound).toEqual(divergencePairBounds[row.pairId])
  })

  it('still accepts a row without a bound, and refuses a malformed one', () => {
    // 老格式（没有 `bound`）仍要通过：这是 IPC 边界上的兼容。一旦落库或进冻结快照，就得 bump。
    const available = detectDivergences(upperBoundCase())
    if (available.state !== 'available') throw new Error('unexpected')
    const withoutBound = {
      ...available,
      rows: available.rows.map(row => {
        const { bound: _bound, ...rest } = row
        return rest
      })
    }
    expect(isMarketDivergenceResult(withoutBound, asOf)).toBe(true)
    expect(isMarketDivergenceResult(available, asOf)).toBe(true)
    const malformed = {
      ...available,
      rows: [{ ...available.rows[0]!, bound: { leg: 'open-interest', comparator: 'below', threshold: 3 } }],
      withheld: []
    }
    expect(isMarketDivergenceResult(malformed, asOf)).toBe(false)
  })
})
