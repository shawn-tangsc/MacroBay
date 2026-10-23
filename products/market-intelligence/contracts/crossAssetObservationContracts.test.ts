import { describe, expect, it, vi } from 'vitest'
import { crossAssetMethods, parseCrossAssetInput, parseCrossAssetSnapshot } from './crossAssetObservationContracts'

const now = Date.parse('2026-09-14T12:00:00.000Z')
const snapshot = () => {
  const metric = { state: 'unavailable', reason: 'missing' }
  const perAsset = (build: () => unknown) => ({ index: build(), btc: build(), eth: build() })
  return { schemaVersion: 1, mode: 'historical', servedAt: new Date(now).toISOString(), asOf: new Date(now).toISOString(), range: '1h',
    analysisEnd: new Date(now).toISOString(), windowStart: new Date(now - 3_600_000).toISOString(),
    historyCoverage: perAsset(() => ({ count: 0, expectedCount: 13, complete: false })),
    curves: perAsset(() => Array.from({ length: 13 }, (_, i) => ({ at: new Date(now - (12 - i) * 300_000).toISOString(), returnPercent: null }))),
    closedReturns: perAsset(() => ({ '5m': metric, '15m': metric, '1h': metric, '4h': metric, '24h': metric, '7d': metric })),
    correlations: { indexBtc: { ...metric, sampleCount: 0, expectedCount: 288 }, indexEth: { ...metric, sampleCount: 0, expectedCount: 288 } },
    relativeReturns: { btcMinusIndex: metric, ethMinusBtc: metric }, observationKey: { indexBtc: 'unavailable', ethBtc: 'unavailable' },
    indexSource: 'unavailable' }
}

const reading = () => ({
  state: 'judged', window: '24h', scenario: 'risk-off',
  legs: [
    { leg: 'dxy', direction: 'up', returnPercent: 0.42 }, { leg: 'gold', direction: 'up', returnPercent: 0.86 },
    { leg: 'index', direction: 'down', returnPercent: -1.12 }, { leg: 'btc', direction: 'down', returnPercent: -1.84 }
  ],
  refuted: [{ scenario: 'discount-rate', leg: 'gold' }],
  correlation: { state: 'available', value: 0.68, sampleCount: 288, expectedCount: 288, window: '24h', interval: '5m' },
  relativeReturns: { btcMinusIndex: -0.72, ethMinusBtc: -0.47 }, notices: ['index-proxy']
})


/** 24 小时窗口的合法快照：判读只在 24H 成立，已判定的用例必须建在它上面。 */
const snapshot24h = () => {
  const metric = { state: 'unavailable', reason: 'missing' }
  const perAsset = (build: () => unknown) => ({ index: build(), btc: build(), eth: build() })
  const start = now - 288 * 300_000
  return { schemaVersion: 1, mode: 'historical', servedAt: new Date(now).toISOString(), asOf: new Date(now).toISOString(), range: '24h',
    analysisEnd: new Date(now).toISOString(), windowStart: new Date(start).toISOString(),
    historyCoverage: perAsset(() => ({ count: 289, expectedCount: 289, complete: true })),
    curves: perAsset(() => Array.from({ length: 289 }, (_, index) => ({ at: new Date(start + index * 300_000).toISOString(), returnPercent: null }))),
    closedReturns: perAsset(() => ({ '5m': metric, '15m': metric, '1h': metric, '4h': metric, '24h': metric, '7d': metric })),
    correlations: { indexBtc: { ...metric, sampleCount: 0, expectedCount: 288 }, indexEth: { ...metric, sampleCount: 0, expectedCount: 288 } },
    relativeReturns: { btcMinusIndex: metric, ethMinusBtc: metric },
    observationKey: { indexBtc: 'unavailable', ethBtc: 'unavailable' }, indexSource: 'unavailable' }
}

describe('the cross-market reading on the wire (design 142)', () => {
  it('accepts a reading, and keeps accepting a snapshot from a main process that has none', () => {
    // `reading` is optional exactly like `macroCurves`: an older main process must not invalidate the block.
    expect(parseCrossAssetSnapshot(snapshot())).toBeDefined()
    const withReading = { ...snapshot24h(), reading: reading() }
    expect(parseCrossAssetSnapshot(withReading)).toEqual(withReading)
    expect(parseCrossAssetSnapshot({ ...snapshot(), reading: { state: 'undetermined', reason: 'no-match', refuted: [] } })).toBeDefined()
    expect(parseCrossAssetSnapshot({ ...snapshot(), reading: { state: 'undetermined', reason: 'legs-missing', leg: 'gold', refuted: [] } })).toBeDefined()
  })

  it('refuses a judged reading whose window disagrees with the snapshot it rides on', () => {
    // 判读是 24 小时的陈述：挂在 1H 快照上就又是一次混周期（设计 142 §3.3/H1）。
    expect(parseCrossAssetSnapshot({ ...snapshot(), reading: reading() })).toBeUndefined()
  })

  it('carries the four legs only where they explain a "no scenario fits", never for a missing leg', () => {
    const legs = [
      { leg: 'dxy', direction: 'flat', returnPercent: -0.01 }, { leg: 'gold', direction: 'flat', returnPercent: 0.27 },
      { leg: 'index', direction: 'up', returnPercent: 0.52 }, { leg: 'btc', direction: 'flat', returnPercent: 0.54 }
    ]
    const noMatch = { state: 'undetermined', reason: 'no-match', refuted: [], legs }
    expect(parseCrossAssetSnapshot({ ...snapshot(), reading: noMatch })).toBeDefined()
    // 缺腿/停更时不存在完整腿集：带 legs 的载荷是伪造或 bug。
    expect(parseCrossAssetSnapshot({ ...snapshot(), reading: { ...noMatch, reason: 'legs-missing', leg: 'gold' } })).toBeUndefined()
    // 形状本身也要合法：少一条、顺序错、方向非法、数值非有限，各拒一次。
    for (const broken of [legs.slice(0, 3), [legs[1], legs[0], legs[2], legs[3]],
      legs.map((leg, index) => index === 0 ? { ...leg, direction: 'sideways' } : leg),
      legs.map((leg, index) => index === 0 ? { ...leg, returnPercent: Number.NaN } : leg)])
      expect(parseCrossAssetSnapshot({ ...snapshot(), reading: { ...noMatch, legs: broken } })).toBeUndefined()
  })

  it('refuses a reading that contradicts itself', () => {
    // 被判定的剧本不能同时出现在"不像"里，同一条腿也不能重复列出——此前这些都会被接受（评审 ④）。
    const contradictory = { ...reading(), refuted: [{ scenario: 'risk-off', leg: 'dxy' }] }
    expect(parseCrossAssetSnapshot({ ...snapshot24h(), reading: contradictory })).toBeUndefined()
    const duplicated = { ...reading(), refuted: [{ scenario: 'discount-rate', leg: 'gold' }, { scenario: 'discount-rate', leg: 'gold' }] }
    expect(parseCrossAssetSnapshot({ ...snapshot24h(), reading: duplicated })).toBeUndefined()
  })

  it('rejects a reading whose ids, numbers or length are outside the policy', () => {
    const cases = [
      { ...reading(), scenario: 'melt-up' },
      { ...reading(), window: '1h' },
      { ...reading(), legs: reading().legs.map((leg, index) => index === 0 ? { ...leg, direction: 'sideways' } : leg) },
      { ...reading(), legs: reading().legs.map((leg, index) => index === 0 ? { ...leg, returnPercent: Number.NaN } : leg) },
      { ...reading(), refuted: Array.from({ length: 4 }, () => ({ scenario: 'risk-on', leg: 'dxy' })) },
      { ...reading(), correlation: { ...reading().correlation, interval: '15m' } },
      { ...reading(), correlation: { state: 'available', value: 0.5, sampleCount: 12, expectedCount: 288, window: '24h', interval: '5m' } },
      { ...reading(), notices: ['moon-phase'] },
      { ...reading(), relativeReturns: { btcMinusIndex: Number.POSITIVE_INFINITY, ethMinusBtc: null } },
      { state: 'undetermined', reason: 'probably' }
    ]
    for (const value of cases) expect(parseCrossAssetSnapshot({ ...snapshot(), reading: value })).toBeUndefined()
  })
})

describe('cross-asset strict snapshot boundary', () => {
  it('rejects an available correlation below the 231 paired-return threshold', () => {
    const input = snapshot()
    input.correlations.indexBtc = { state: 'available', value: .5, sampleCount: 230, expectedCount: 288 } as never
    expect(parseCrossAssetSnapshot(input)).toBeUndefined()
  })

  it('accepts bounded current tails and fixed observation keys but rejects historical live facts', () => {
    const historical = snapshot()
    const current = { ...historical, mode: 'current', servedAt: new Date(now + 1000).toISOString(), asOf: new Date(now + 1000).toISOString(),
      indexSource: 'proxy',
      sourceState: 'live', quotes: { index: { state: 'live', price: '103', tradedAtMs: now + 1000, receivedAtMs: now + 1000 }, btc: { state: 'missing' }, eth: { state: 'missing' } },
      marketState: { index: 'open', btc: 'open', eth: 'open' },
      lastClosed: { index: { at: new Date(now).toISOString(), close: '103' }, btc: { at: new Date(now).toISOString(), close: '1' }, eth: { at: new Date(now).toISOString(), close: '1' } },
      forming: { index: { at: new Date(now + 1000).toISOString(), returnPercent: 1 }, btc: null, eth: null } }
    current.curves.index = (current.curves.index as { at: string; returnPercent: number | null }[]).map(point => ({ ...point, returnPercent: 0 }))
    expect(parseCrossAssetSnapshot(current)).toEqual(current)
    expect(parseCrossAssetSnapshot({ ...current, curves: snapshot().curves })).toBeUndefined()
    expect(parseCrossAssetSnapshot({ ...current, sourceState: 'stale' })).toBeUndefined()
    expect(parseCrossAssetSnapshot({ ...historical, observationKey: { indexBtc: 'up', ethBtc: 'flat' } })).toBeUndefined()
    expect(parseCrossAssetSnapshot({ ...current, forming: { ...current.forming, index: { at: new Date(now + 300_000).toISOString(), returnPercent: 1 } } })).toBeUndefined()
  })

  it('requires the exact UTC grid, complete positional arrays and coherent analysis times', () => {
    const offGrid = snapshot()
    ;(offGrid.curves.index as { at: string }[])[1].at = new Date(now - 3_300_000 + 1).toISOString()
    expect(parseCrossAssetSnapshot(offGrid)).toBeUndefined()
    expect(parseCrossAssetSnapshot({ ...snapshot(), analysisEnd: new Date(now + 300_000).toISOString() })).toBeUndefined()
    const missingPosition = snapshot()
    ;(missingPosition.curves.index as unknown[]).pop()
    expect(parseCrossAssetSnapshot(missingPosition)).toBeUndefined()
  })
  it('accepts a bounded historical projection and returns a detached copy', () => {
    const input = snapshot()
    const result = parseCrossAssetSnapshot(input)
    expect(result).toEqual(input)
    expect(result).not.toBe(input)
  })

  it('rejects unknown nested fields, nonfinite metrics, excess points, and live fields in historical mode', () => {
    const secret = { ...snapshot(), header: 'private' }
    expect(parseCrossAssetSnapshot(secret)).toBeUndefined()
    expect(parseCrossAssetSnapshot({ ...snapshot(), quotes: {} })).toBeUndefined()
    const invalid = snapshot()
    invalid.relativeReturns.btcMinusIndex = { state: 'available', value: Infinity } as never
    expect(parseCrossAssetSnapshot(invalid)).toBeUndefined()
    const extra = snapshot()
    extra.correlations.indexBtc = { ...extra.correlations.indexBtc, rawBody: 'private' } as never
    expect(parseCrossAssetSnapshot(extra)).toBeUndefined()
    const excessive = snapshot()
    excessive.curves = { index: Array(290).fill({ at: new Date(now).toISOString(), returnPercent: 0 }), btc: [], eth: [] }
    expect(parseCrossAssetSnapshot(excessive)).toBeUndefined()
  })
})
describe('cross-asset IPC input boundary', () => {
  it('exposes only the eight product-owned methods and accepts their exact shapes', () => {
    expect(Object.keys(crossAssetMethods)).toEqual(['acquire', 'renew', 'release', 'refresh', 'getSourceConfiguration', 'testInterface', 'cancelInterfaceTest', 'query'])
    for (const key of ['acquire', 'getSourceConfiguration', 'testInterface', 'cancelInterfaceTest'] as const) expect(parseCrossAssetInput(crossAssetMethods[key], {}, now)).toEqual({})
    for (const key of ['renew', 'release', 'refresh'] as const) {
      expect(parseCrossAssetInput(crossAssetMethods[key], { leaseId: 'b5acb2b7-86ca-424b-bb11-084ed0bfa1ee' }, now)).toEqual({ leaseId: 'b5acb2b7-86ca-424b-bb11-084ed0bfa1ee' })
    }
    expect(parseCrossAssetInput('intelligence.crossAsset.setEnabled', { enabled: false }, now)).toBeUndefined()
    expect(parseCrossAssetInput('intelligence.crossAsset.getExchangeConfiguration', {}, now)).toBeUndefined()
    expect(parseCrossAssetInput(crossAssetMethods.query, { range: '24h' }, now)).toEqual({ range: '24h' })
    expect(parseCrossAssetInput(crossAssetMethods.query, { range: '7d', asOf: '2026-09-14T11:00:00.000Z' }, now))
      .toEqual({ range: '7d', asOf: '2026-09-14T11:00:00.000Z' })
  })

  it.each([
    ['query', { range: '1h', url: 'forbidden' }], ['query', { range: '1h', endMs: now }],
    ['query', { range: '1h', symbol: 'BTCUSDT' }], ['query', { range: 'all' }],
    ['query', { range: '1h', asOf: '2026-09-14T12:00:00.001Z' }],
    ['query', { range: '1h', asOf: '2026-02-30T12:00:00.000Z' }],
    ['query', { range: '1h', asOf: '2026-09-14T12:00:00+00:00' }],
    ['acquire', { header: {} }], ['renew', { leaseId: 'x'.repeat(129) }],
    ['refresh', { leaseId: '' }], ['release', { leaseId: 12 }], ['setEnabled', { enabled: 1 }]
  ])('rejects invalid %s input', (method, value) => {
    expect(parseCrossAssetInput(`intelligence.crossAsset.${method}`, value, now)).toBeUndefined()
  })

  it('rejects unknown methods, prototypes, symbols and accessors without running getters', () => {
    const getter = vi.fn(() => '1h')
    expect(parseCrossAssetInput('intelligence.crossAsset.arbitrary', {}, now)).toBeUndefined()
    expect(parseCrossAssetInput(crossAssetMethods.query, { get range() { return getter() } }, now)).toBeUndefined()
    expect(parseCrossAssetInput(crossAssetMethods.query, Object.create({ range: '1h' }), now)).toBeUndefined()
    expect(parseCrossAssetInput(crossAssetMethods.query, { range: '1h', [Symbol('hidden')]: 1 }, now)).toBeUndefined()
    expect(getter).not.toHaveBeenCalled()
  })
})
