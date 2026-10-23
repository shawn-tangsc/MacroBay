import { expect, it } from 'vitest'
import { crossAssetContractPolicy } from '../../../contracts/crossAssetObservationContracts'
import { crossAssetFlatBand } from './crossAssetAnalytics'
import {
  crossAssetLegDirection,
  crossAssetReadingLegs,
  crossAssetReadingPolicy,
  crossAssetReadingScenarios,
  resolveCrossAssetReading,
  type CrossAssetReadingInput
} from './crossAssetReading'

/** 四条腿都可用时的输入；每个用例只改它关心的那一部分。 */
function input(overrides: Partial<CrossAssetReadingInput> = {}): CrossAssetReadingInput {
  return {
    window: '24h',
    legs: {
      dxy: { state: 'available', returnPercent: 0.42 }, gold: { state: 'available', returnPercent: 0.86 },
      index: { state: 'available', returnPercent: -1.12 }, btc: { state: 'available', returnPercent: -1.84 }
    },
    correlation: { state: 'available', value: 0.68, sampleCount: 288, expectedCount: 288 },
    relativeReturns: { btcMinusIndex: -0.72, ethMinusBtc: -0.47 },
    notices: [],
    ...overrides
  }
}
const legs = (values: Readonly<Record<'dxy' | 'gold' | 'index' | 'btc', number>>) => ({
  dxy: { state: 'available' as const, returnPercent: values.dxy }, gold: { state: 'available' as const, returnPercent: values.gold },
  index: { state: 'available' as const, returnPercent: values.index }, btc: { state: 'available' as const, returnPercent: values.btc }
})

it('reads the five scenarios from the four legs', () => {
  // 每个剧本一组腿值；判读必须给出剧本本身，而不是"No"。
  const cases = [
    ['risk-off', { dxy: 0.42, gold: 0.86, index: -1.12, btc: -1.84 }],
    ['discount-rate', { dxy: 0.60, gold: -0.90, index: -1.30, btc: -2.10 }],
    ['risk-on', { dxy: -0.55, gold: 1.10, index: 1.40, btc: 2.60 }],
    ['risk-on-recovery', { dxy: -0.52, gold: -1.05, index: 1.35, btc: 2.40 }],
    ['crypto-specific', { dxy: 0.11, gold: -0.20, index: 0.15, btc: 3.10 }]
  ] as const
  for (const [scenario, values] of cases) {
    const reading = resolveCrossAssetReading(input({ legs: legs(values) }))
    expect(reading.state, scenario).toBe('judged')
    expect(reading.state === 'judged' && reading.scenario, scenario).toBe(scenario)
  }
})

it('keeps the documented arbitration order', () => {
  // 四个方向剧本在（美元, 黄金）上互斥；顺序仍要钉住，因为它决定"同时满足时取哪条"。
  expect(crossAssetReadingScenarios.map(value => value.id))
    .toEqual(['risk-off', 'discount-rate', 'risk-on', 'risk-on-recovery', 'crypto-specific'])
})

it('calls a move exactly on the band flat, the way the observation key does', () => {
  const band = crossAssetFlatBand('btc', '24h')
  expect(crossAssetLegDirection('btc', -band, '24h')).toBe('flat')
  expect(crossAssetLegDirection('btc', band, '24h')).toBe('flat')
  expect(crossAssetLegDirection('btc', -(band + 0.01), '24h')).toBe('down')
  expect(crossAssetLegDirection('btc', band + 0.01, '24h')).toBe('up')
})

it('scales the owned 1h bands by the square root of the window', () => {
  // 24 小时的波动是中位 1 小时的 9–20 倍：拿 1h 档判 24h 会让"没变化"永不触发（设计 142 §3.4）。
  expect(crossAssetFlatBand('dxy', '24h')).toBeCloseTo(0.06 * Math.sqrt(24), 10)
  expect(crossAssetFlatBand('gold', '24h')).toBeCloseTo(0.16 * Math.sqrt(24), 10)
  expect(crossAssetFlatBand('index', '24h')).toBeCloseTo(0.10 * Math.sqrt(24), 10)
  expect(crossAssetFlatBand('btc', '24h')).toBeCloseTo(0.30 * Math.sqrt(24), 10)
  expect(crossAssetFlatBand('btc', '1h')).toBe(0.30)
})

it('names the leg that does not fit, and only when it is the only one', () => {
  const reading = resolveCrossAssetReading(input())
  expect(reading.state).toBe('judged')
  if (reading.state !== 'judged') return
  // 避险成立；钱变贵只差黄金一条腿（黄金涨而非跌）→ 值得说；钱在冒险差美元与黄金两条 → 不列。
  expect(reading.refuted).toContainEqual({ scenario: 'discount-rate', leg: 'gold' })
  expect(reading.refuted.some(value => value.scenario === 'risk-on')).toBe(false)
  expect(reading.refuted.length).toBeLessThanOrEqual(3)
})

it('carries the correlation as backing, and says when there is none', () => {
  const backed = resolveCrossAssetReading(input())
  expect(backed.state === 'judged' && backed.correlation).toMatchObject({ state: 'available', value: 0.68, window: '24h', interval: '5m' })
  const unbacked = resolveCrossAssetReading(input({ correlation: { state: 'unavailable', reason: 'insufficient' } }))
  expect(unbacked.state).toBe('judged')
  expect(unbacked.state === 'judged' && unbacked.correlation).toEqual({ state: 'unavailable', reason: 'insufficient' })
})

it('still judges "only crypto moved" without a correlation, because that scenario never reads it', () => {
  // ρ 不可用时**不能**把它当成"低相关"（设计 142 §3.3）：该剧本成立靠的是三条宏观腿都没走。
  const reading = resolveCrossAssetReading(input({
    legs: legs({ dxy: 0.11, gold: -0.20, index: 0.15, btc: 3.10 }), correlation: { state: 'unavailable', reason: 'insufficient' }
  }))
  expect(reading.state === 'judged' && reading.scenario).toBe('crypto-specific')
})

it('refuses to judge outside 24h, and says why', () => {
  for (const window of ['1h', '7d'] as const) {
    const reading = resolveCrossAssetReading(input({ window }))
    expect(reading).toEqual({ state: 'undetermined', reason: 'window-not-judged', refuted: [] })
  }
})

it('refuses when a leg has no value, naming the first missing leg in reader order', () => {
  const reading = resolveCrossAssetReading(input({
    legs: { ...legs({ dxy: 0.42, gold: 0.86, index: -1.12, btc: -1.84 }), gold: { state: 'unavailable', reason: 'missing' } }
  }))
  expect(reading).toEqual({ state: 'undetermined', reason: 'legs-missing', leg: 'gold', refuted: [] })
  // 没有完整腿集时不带 legs：兜底描述只能描述真的算出来的东西。
  expect(reading.state === 'undetermined' && 'legs' in reading).toBe(false)
})

it('refuses when a leg is stale, and separates stale from missing', () => {
  const reading = resolveCrossAssetReading(input({
    legs: { ...legs({ dxy: 0.42, gold: 0.86, index: -1.12, btc: -1.84 }), btc: { state: 'unavailable', reason: 'stale' } }
  }))
  expect(reading).toEqual({ state: 'undetermined', reason: 'stale', leg: 'btc', refuted: [] })
})

it('refuses when no scenario fits, and still lists the near misses', () => {
  // 美元小动、黄金小动、股票上、BTC 下：没有任何剧本要求这个组合。
  const reading = resolveCrossAssetReading(input({ legs: legs({ dxy: 0.12, gold: 0.11, index: 2.40, btc: -2.60 }) }))
  expect(reading.state).toBe('undetermined')
  expect(reading.state === 'undetermined' && reading.reason).toBe('no-match')
  // 兜底描述的依据：认不出组合时必须把四条腿带出来（缺腿/停更时则没有完整腿集）。
  expect(reading.state === 'undetermined' && reading.legs?.map(leg => leg.leg))
    .toEqual(['dxy', 'gold', 'index', 'btc'])
  expect(reading.state === 'undetermined' && reading.legs?.map(leg => leg.direction)).toEqual(['flat', 'flat', 'up', 'down'])
  expect(reading.state === 'undetermined' && reading.refuted.every(value => value.scenario !== undefined)).toBe(true)
})

it('carries the substitution notices so the sentence can say what it read', () => {
  // 代币化纳指是产品自己的默认腿，合成美元也是既有替换：它们不是"不判"的理由，但必须说出来。
  const reading = resolveCrossAssetReading(input({ notices: ['index-proxy', 'dxy-synthetic'] }))
  expect(reading.state === 'judged' && reading.notices).toEqual(['index-proxy', 'dxy-synthetic'])
})

it('takes its vocabulary and its bound from the contract, and covers it exactly', () => {
  // 单一 owner 的意义就在这条：契约的清单是线协议校验器用的那一份，服务侧的条件表必须**正好**覆盖它、
  // 顺序也一致。此前两边各写一份（评审 3），分叉的后果是每个快照都被 fail-closed 拒收。
  expect(crossAssetReadingScenarios.map(scenario => scenario.id)).toEqual([...crossAssetContractPolicy.readingScenarios])
  expect([...crossAssetReadingLegs]).toEqual([...crossAssetContractPolicy.readingLegs])
  expect(crossAssetReadingPolicy.maximumRefuted).toBe(crossAssetContractPolicy.maximumRefuted)
  for (const scenario of crossAssetReadingScenarios) {
    expect(scenario.conditions.map(condition => condition.leg)).toEqual([...crossAssetContractPolicy.readingLegs])
    for (const condition of scenario.conditions) {
      const directions = Array.isArray(condition.direction) ? condition.direction : [condition.direction]
      for (const direction of directions) {
        expect(crossAssetContractPolicy.readingDirections as readonly string[]).toContain(direction)
      }
    }
  }
})
