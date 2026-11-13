import { describe, expect, it } from 'vitest'

import { parseBucketBounds, polymarketPeriodToken, readPolymarketConsensus } from './polymarketConsensus'

/**
 * 2026-11-14 真盘口（裁到用得到的那几个字段）。取数方式是**按 slug 直接查**
 * （`events?slug=`），所以只有一份载荷；线上把 `outcomePrices` 序列化成字符串，这里照抄。
 */
const detailPayload = JSON.stringify([{
  slug: 'core-pce-yoy-october-2026', volume: 33213.499325,
  markets: [
    { groupItemTitle: '3.1%', outcomePrices: '["0.0855", "0.9145"]' },
    { groupItemTitle: '3.2%', outcomePrices: '["0.595", "0.405"]' },
    { groupItemTitle: '3.3%', outcomePrices: '["0.23", "0.77"]' }
  ]
}])
/** 该期没开盘时 `?slug=` 回空数组。 */
const emptyPayload = JSON.stringify([])

const releaseAt = '2026-11-25T13:30:00.000Z'
const beforeRelease = '2026-11-14T00:00:00.000Z'

const fetchText = (payloads: readonly string[]) => {
  let index = 0
  return async () => payloads[Math.min(index++, payloads.length - 1)]!
}

describe('readPolymarketConsensus', () => {
  it('reverse-engineers 3.2% and carries the volume and observation time', async () => {
    const reading = await readPolymarketConsensus({
      metricKey: 'US.CORE_PCE.NSA.YOY', period: '2026-10', releaseAt, asOf: beforeRelease,
      fetchText: fetchText([detailPayload])
    })
    expect(reading).toEqual({ state: 'ok', value: 3.2, marketVolume: 33213.499325, asOf: beforeRelease, provenance: 'market-implied' })
  })

  /** 非农的档位是绝对人数（`100k to 125k`），卡片口径是千：换算只做一次，读出 87.5 而不是 87500。 */
  it('converts the jobs distribution from absolute counts to thousands', async () => {
    const payload = JSON.stringify([{ slug: 'how-many-jobs-added-in-november-2026', volume: 5285, markets: [
      { groupItemTitle: '75k to 100k', outcomePrices: '["0.5", "0.5"]' },
      { groupItemTitle: '100k to 125k', outcomePrices: '["0.5", "0.5"]' }
    ] }])
    const reading = await readPolymarketConsensus({
      metricKey: 'US.NONFARM.SA.CHANGE', period: '2026-11', releaseAt: '2026-12-04T13:30:00.000Z', asOf: beforeRelease,
      fetchText: async () => payload
    })
    expect(reading).toMatchObject({ state: 'ok', marketVolume: 5285 })
    expect(reading.state === 'ok' ? reading.value : NaN).toBeCloseTo(87.5, 5)
  })

  /** 判红一：有盘却显示「暂无」——期间对不上时也不许拿别的期次凑。 */
  it('does not borrow another period when the exact period has no market', async () => {
    const reading = await readPolymarketConsensus({
      metricKey: 'US.CORE_PCE.NSA.YOY', period: '2026-11', releaseAt, asOf: beforeRelease,
      fetchText: fetchText([emptyPayload])
    })
    expect(reading).toEqual({ state: 'unavailable', reason: 'no-market' })
  })

  /** 判红二：发布之后不取盘（那时价格是结果，不是预期）。 */
  it('refuses a market read taken at or after the release', async () => {
    const reading = await readPolymarketConsensus({
      metricKey: 'US.CORE_PCE.NSA.YOY', period: '2026-10', releaseAt, asOf: '2026-11-26T00:00:00.000Z',
      fetchText: fetchText([detailPayload])
    })
    expect(reading).toEqual({ state: 'unavailable', reason: 'after-release' })
  })

  it('says unavailable when the fetch fails, instead of inventing a number', async () => {
    const reading = await readPolymarketConsensus({
      metricKey: 'US.CORE_PCE.NSA.YOY', period: '2026-10', releaseAt, asOf: beforeRelease,
      fetchText: async () => { throw new Error('network') }
    })
    expect(reading).toEqual({ state: 'unavailable', reason: 'read-failed' })
  })
})

describe('parseBucketBounds', () => {
  it.each([
    ['≤3.2%', { upper: 3.2 }],
    ['≥4.3%', { lower: 4.3 }],
    ['3.7%', { lower: 3.7, upper: 3.7 }],
    ['<25k', { upper: 25000 }],
    ['150k+', { lower: 150000 }],
    ['100k to 125k', { lower: 100000, upper: 125000 }]
  ])('reads %s', (label, expected) => {
    expect(parseBucketBounds(label)).toEqual(expected)
  })

  it('returns undefined for a label with no number, instead of guessing', () => {
    expect(parseBucketBounds('other')).toBeUndefined()
  })
})

describe('polymarketPeriodToken', () => {
  it('turns a period into the month name the venue uses', () => {
    expect(polymarketPeriodToken('2026-10')).toBe('October 2026')
    expect(polymarketPeriodToken('2026-13')).toBeUndefined()
  })
})
