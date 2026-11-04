import { describe, expect, it } from 'vitest'

import { parseCrossAssetSnapshot, type CrossAssetRejection } from './crossAssetObservationContracts'

/**
 * The parser names the check that refused a snapshot, from the contract's closed vocabulary.
 *
 * Before this, every refusal was the same `undefined`: a consumer could only say "cross-asset domain
 * missing", which is a failed read reported as missing data. Each case below asserts the most
 * specific name — the asset and the window have to appear, because "curves" alone is half a reason.
 */
const reject = (value: unknown): string | undefined => {
  const rejection: CrossAssetRejection = {}
  expect(parseCrossAssetSnapshot(value, rejection)).toBeUndefined()
  return rejection.field
}

const base = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  schemaVersion: 1,
  mode: 'historical',
  servedAt: '2026-11-03T23:00:00.000Z',
  asOf: '2026-11-03T23:00:00.000Z',
  analysisEnd: '2026-11-03T23:00:00.000Z',
  windowStart: '2026-11-02T23:00:00.000Z',
  range: '24h',
  historyCoverage: {},
  curves: {},
  closedReturns: {},
  correlations: {},
  relativeReturns: {},
  indexSource: 'unavailable',
  ...overrides
})

describe('cross-asset rejections are named', () => {
  it('says when the shape itself is wrong', () => {
    expect(reject(null)).toBe('shape')
    expect(reject(base({ mode: 'nonsense' }))).toBe('shape')
  })

  it('names the schema version and the range separately', () => {
    expect(reject(base({ schemaVersion: 2 }))).toBe('schemaVersion')
    expect(reject(base({ range: '3d' }))).toBe('range')
  })

  it('names the grid when the window is off the policy grid', () => {
    expect(reject(base({ analysisEnd: '2026-11-03T23:07:00.000Z' }))).toBe('grid')
  })

  it('names the index source', () => {
    expect(reject(base({ indexSource: 'made-up' }))).toBe('indexSource')
  })

  it('names the asset and the check when a curve is the wrong length', () => {
    // Coverage passes, so the refusal that follows must name the curve and the asset it belongs to.
    const coverage = { count: 289, expectedCount: 289, complete: true }
    const metric = { state: 'available', value: 1 }
    const returns = { '5m': metric, '15m': metric, '1h': metric, '4h': metric, '24h': metric, '7d': metric }
    const value = base({
      historyCoverage: { btc: coverage, eth: coverage, index: coverage },
      curves: { btc: [], eth: [], index: [] },
      closedReturns: { btc: returns, eth: returns, index: returns },
      correlations: { indexBtc: metric, indexEth: metric },
      relativeReturns: { btcMinusIndex: metric, ethMinusBtc: metric }
    })
    // `policy.assets` order puts the index first, so that is the curve the contract refuses first.
    expect(reject(value)).toBe('curves.index.length')
  })

})
