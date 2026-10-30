import { describe, expect, it } from 'vitest'

import {
  liquidationHintPolicy,
  positioningPolicy,
  positioningStateIds,
  resolvePositioningState,
  detectLiquidationHints,
  type PositioningBar
} from './openInterestPositioning'

const funding = { fundingNowPct: 0.006, fundingAgoPct: 0.01 }

describe('positioning state', () => {
  it('names each of the six states from open interest and funding together', () => {
    expect(resolvePositioningState({ notionalChange24hPct: -8, ...funding })).toBe('deleveraging')
    expect(resolvePositioningState({ notionalChange24hPct: 6, fundingNowPct: -0.001, fundingAgoPct: 0.01 })).toBe('short-crowded')
    expect(resolvePositioningState({ notionalChange24hPct: 6, fundingNowPct: 0.031, fundingAgoPct: 0.02 })).toBe('long-crowded')
    expect(resolvePositioningState({ notionalChange24hPct: 6, fundingNowPct: 0.008, fundingAgoPct: 0.01 })).toBe('refilling')
    expect(resolvePositioningState({ notionalChange24hPct: 1.2, ...funding })).toBe('neutral')
    expect(resolvePositioningState({ notionalChange24hPct: -8, fundingNowPct: 0.02, fundingAgoPct: 0.01 })).toBe('mixed')
  })

  it('treats the thresholds as closed on the significant side and open on the crowded side', () => {
    expect(positioningPolicy.notionalChange24hSignificantPct).toBe(5)
    expect(resolvePositioningState({ notionalChange24hPct: -5, ...funding })).toBe('deleveraging')
    expect(resolvePositioningState({ notionalChange24hPct: -4.99, ...funding })).toBe('neutral')
    // Funding exactly at zero is still "not paying", so it refills rather than crowds shorts.
    expect(resolvePositioningState({ notionalChange24hPct: 5, fundingNowPct: 0, fundingAgoPct: 0.01 })).toBe('refilling')
    // Exactly at the crowded bound is the top of normal, not the start of crowded.
    expect(resolvePositioningState({ notionalChange24hPct: 5, fundingNowPct: 0.03, fundingAgoPct: 0.01 })).toBe('refilling')
    expect(resolvePositioningState({ notionalChange24hPct: 5, fundingNowPct: 0.0301, fundingAgoPct: 0.01 })).toBe('long-crowded')
  })

  it('says nothing when a number is missing rather than calling it neutral', () => {
    expect(resolvePositioningState({ fundingNowPct: 0.006, fundingAgoPct: 0.01 })).toBeUndefined()
    expect(resolvePositioningState({ notionalChange24hPct: -8, fundingAgoPct: 0.01 })).toBeUndefined()
    expect(resolvePositioningState({ notionalChange24hPct: -8, fundingNowPct: 0.006 })).toBeUndefined()
    expect(resolvePositioningState({ notionalChange24hPct: Number.NaN, ...funding })).toBeUndefined()
  })

  it('exposes its ids in a frozen list so vocabularies can be checked against it', () => {
    expect(Object.isFrozen(positioningStateIds)).toBe(true)
    expect([...positioningStateIds]).toHaveLength(6)
  })
})

/** `count` closed buckets, flat open interest, then whatever the caller wants to graft on. */
function bars(count: number, change?: (index: number, bar: PositioningBar) => PositioningBar): PositioningBar[] {
  return Array.from({ length: count }, (_, index) => {
    const base: PositioningBar = {
      observedAt: new Date(Date.UTC(2026, 9, 28, 0, 0) + index * 900_000).toISOString(),
      notionalUsd: 8_000_000_000,
      volumeBase: 1_000,
      closePrice: 80_000
    }
    return change ? change(index, base) : base
  })
}

function withDrop(at: number, dropPct = -2, pricePct = -1.2, multiple = 3): PositioningBar[] {
  return bars(at + 1, (index, bar) => index < at ? bar : {
    ...bar,
    notionalUsd: 8_000_000_000 * (1 + dropPct / 100),
    closePrice: 80_000 * (1 + pricePct / 100),
    volumeBase: 1_000 * multiple
  })
}

describe('liquidation marks', () => {
  it('marks a bucket where open interest, price and volume all moved together', () => {
    const result = detectLiquidationHints({ asset: 'btc', bars: withDrop(120) })
    expect(result.state).toBe('available')
    expect(result.hints).toHaveLength(1)
    expect(result.hints[0]).toMatchObject({ asset: 'btc', dropPct: -2, volumeMultiple: 3 })
  })

  it('needs all three conditions, not two', () => {
    expect(detectLiquidationHints({ asset: 'btc', bars: withDrop(120, -1.4) }).hints).toHaveLength(0)
    expect(detectLiquidationHints({ asset: 'btc', bars: withDrop(120, -2, -0.7) }).hints).toHaveLength(0)
    expect(detectLiquidationHints({ asset: 'btc', bars: withDrop(120, -2, -1.2, 1.9) }).hints).toHaveLength(0)
  })

  it('includes the boundary values themselves', () => {
    const result = detectLiquidationHints({ asset: 'btc', bars: withDrop(120, -1.5, -0.8, 2) })
    expect(result.hints).toHaveLength(1)
  })

  it('reports unavailable when too few closed buckets carry volume, instead of reporting nothing', () => {
    const missing = bars(200, (index, bar) => index < 21 ? { ...bar, volumeBase: null } : bar)
    expect(detectLiquidationHints({ asset: 'btc', bars: missing })).toMatchObject({ state: 'unavailable', hints: [] })
    const tolerant = bars(200, (index, bar) => index < 19 ? { ...bar, volumeBase: null } : bar)
    expect(detectLiquidationHints({ asset: 'btc', bars: tolerant }).state).toBe('available')
  })

  it('cannot judge a bucket without a full window of volume behind it', () => {
    expect(detectLiquidationHints({ asset: 'btc', bars: withDrop(40) }).hints).toHaveLength(0)
    expect(detectLiquidationHints({ asset: 'btc', bars: [] })).toMatchObject({ state: 'available', hints: [] })
  })

  it('keeps the most recent marks and says when it dropped older ones', () => {
    const many = bars(1_400, (index, bar) => index > 100 && index % 120 === 0
      ? { ...bar, notionalUsd: 7_840_000_000, closePrice: 79_000, volumeBase: 3_000 }
      : bar)
    const result = detectLiquidationHints({ asset: 'eth', bars: many })
    expect(result.hints.length).toBe(liquidationHintPolicy.maximumHints)
    expect(result.truncated).toBe(true)
    expect(result.hints.at(-1)!.observedAt > result.hints[0]!.observedAt).toBe(true)
  })

  it('ignores a bucket whose previous close is unknown', () => {
    const broken = bars(130, (index, bar) => index === 119 ? { ...bar, closePrice: null } : index === 120
      ? { ...bar, notionalUsd: 7_840_000_000, closePrice: 79_000, volumeBase: 3_000 }
      : bar)
    expect(detectLiquidationHints({ asset: 'btc', bars: broken }).hints).toHaveLength(0)
  })
})
