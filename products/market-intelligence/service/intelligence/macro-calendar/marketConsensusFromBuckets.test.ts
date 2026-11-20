import { describe, expect, it } from 'vitest'

import { checkConsensusCandidate, weightedMedianFromBuckets, type ConsensusBucket } from './marketConsensusFromBuckets'

/** 2026-11-13 实测的真盘口（核心 PCE 年率 10 月，发布 11-25）。 */
const corePceBuckets: readonly ConsensusBucket[] = [
  { label: '≤2.8%', yes: 0.0025, upper: 2.8 },
  { label: '2.9%', yes: 0.0055, lower: 2.9, upper: 2.9 },
  { label: '3.0%', yes: 0.004, lower: 3.0, upper: 3.0 },
  { label: '3.1%', yes: 0.0855, lower: 3.1, upper: 3.1 },
  { label: '3.2%', yes: 0.595, lower: 3.2, upper: 3.2 },
  { label: '3.3%', yes: 0.23, lower: 3.3, upper: 3.3 },
  { label: '3.4%+', yes: 0.037, lower: 3.4 }
]

describe('weightedMedianFromBuckets', () => {
  it('反推出核心 PCE 年率约 3.2%（真盘口）', () => {
    expect(weightedMedianFromBuckets(corePceBuckets)).toBe(3.2)
  })

  /** 不取最高档：把最贵那档的概率挪到相邻档，中位数必须跟着走，而不是钉在「最可能」那档。 */
  it('follows the weights instead of the single most likely bucket', () => {
    const shifted = corePceBuckets.map((bucket) => bucket.label === '3.1%'
      ? { ...bucket, yes: 0.65 }
      : bucket.label === '3.2%' ? { ...bucket, yes: 0.1 } : bucket)
    expect(weightedMedianFromBuckets(shifted)).toBe(3.1)
  })

  it('returns undefined when nothing carries weight', () => {
    expect(weightedMedianFromBuckets(corePceBuckets.map((bucket) => ({ ...bucket, yes: 0 })))).toBeUndefined()
  })
})

describe('checkConsensusCandidate', () => {
  const base = {
    metricKey: 'US.CORE_PCE.NSA.YOY', period: '2026-10', provenance: 'market-implied' as const,
    value: 3.2, asOf: '2026-11-13T18:00:00.000Z', releaseAt: '2026-11-25T13:30:00.000Z', marketVolume: 33213
  }

  it('accepts a market-implied consensus taken before the release', () => {
    expect(checkConsensusCandidate(base)).toEqual({ state: 'displayable' })
  })

  /** 反例一：盘口对了、时点错了——发布之后的价格是结果，不是预期。 */
  it('rejects a market-implied consensus taken after the release', () => {
    expect(checkConsensusCandidate({ ...base, asOf: '2026-11-26T00:00:00.000Z' }))
      .toEqual({ state: 'rejected', missing: ['asOfBeforeRelease'] })
  })

  /** 反例二：时点对了、盘太薄——没有成交量就不显示（不是显示个数再补小字）。 */
  it('rejects a market-implied consensus without volume', () => {
    expect(checkConsensusCandidate({ ...base, marketVolume: undefined }))
      .toEqual({ state: 'rejected', missing: ['marketVolume'] })
  })

  /** 手填没有成交量，但它合法：一律要求成交量会把这一档永久判非法。 */
  it('accepts manual and source-survey without volume', () => {
    expect(checkConsensusCandidate({ ...base, provenance: 'manual', marketVolume: undefined, enteredBy: '唐' }))
      .toEqual({ state: 'displayable' })
    expect(checkConsensusCandidate({ ...base, provenance: 'source-survey', marketVolume: undefined, sourceName: 'Reuters' }))
      .toEqual({ state: 'displayable' })
  })

  it('rejects a value without its period or observation time', () => {
    expect(checkConsensusCandidate({ ...base, period: '' })).toEqual({ state: 'rejected', missing: ['period'] })
    expect(checkConsensusCandidate({ ...base, asOf: undefined })).toEqual({ state: 'rejected', missing: ['asOf'] })
  })
})
