import { describe, expect, it } from 'vitest'

import { sanitize } from './policyPathClient'

const reading = (overrides: Record<string, unknown> = {}) => ({
  state: 'available',
  asOf: '2026-10-30T14:00:00.000Z',
  reading: {
    meetingDate: '2026-12-09', daysUntilMeeting: 39, hasProjectionMaterials: true,
    targetRange: { lowerPercent: 3.75, upperPercent: 4 },
    probability: { venue: 'polymarket', outcome: 'hike-25', value: 0.71, asOf: '2026-10-30T13:50:00.000Z' },
    staleness: 'live',
    ...overrides
  }
})

describe('policy path client sanitizer', () => {
  it('keeps a SEP whose current-year column is missing', () => {
    // A January reading still shows September's table; `medianCurrentYear` is genuinely optional and
    // requiring it dropped the whole projection path.
    const result = sanitize(reading({
      sep: { asOf: '2026-09-16', medianPath: { y2026: 4.1, longerRun: 3.2 }, sourceUrl: 'https://www.federalreserve.gov/monetarypolicy/fomcprojtabl20260916.htm' }
    }))
    expect(result.state).toBe('available')
    expect(result.state === 'available' ? result.reading.sep?.medianPath?.y2026 : undefined).toBe(4.1)
  })

  it('drops a probability whose bucket is not one the reading can name', () => {
    const result = sanitize(reading({ probability: { venue: 'polymarket', outcome: 'hike-75', value: 0.2 } }))
    expect(result.state === 'available' ? result.reading.probability : 'kept').toBeUndefined()
  })

  it('keeps the settlement strip and the distribution it was priced from', () => {
    const result = sanitize(reading({
      phase: { kind: 'settlement', minutesSinceDecision: 42 },
      settlement: {
        decidedMeetingDate: '2026-12-09',
        actualOutcome: 'hike-25',
        priced: 0.38,
        pricedOutcome: 'no-change',
        pricedDistribution: { 'no-change': 0.59, 'hike-25': 0.38, 'hike-50-plus': 0.01, 'cut-25': 0.01, 'cut-50-plus': 0.01 },
        conclusion: { kind: 'relative', direction: 'hawkish', surprisePp: 62 }
      }
    }))
    expect(result.state === 'available' ? result.reading.settlement?.pricedDistribution?.['hike-25'] : undefined).toBe(0.38)
    expect(result.state === 'available' ? result.reading.phase.kind : undefined).toBe('settlement')
  })

  it('drops a settlement whose band is not one the reading can name', () => {
    const result = sanitize(reading({
      settlement: { decidedMeetingDate: '2026-12-09', actualOutcome: 'hike-75', conclusion: { kind: 'priced' } }
    }))
    expect(result.state === 'available' ? result.reading.settlement : 'kept').toBeUndefined()
  })

  it('keeps the named dissenters', () => {
    const result = sanitize(reading({
      lastDecision: { vote: { for: 10, against: 2 }, dissents: [{ name: 'Lisa D. Cook', preferred: 'raise' }], statementUrl: 'https://www.federalreserve.gov/newsevents/pressreleases/monetary20261028a.htm' }
    }))
    expect(result.state === 'available' ? result.reading.lastDecision?.dissents : undefined).toEqual([{ name: 'Lisa D. Cook', preferred: 'raise' }])
  })

  it('keeps a reading with no odds available, not malformed', () => {
    // 「没有赔率」不是失败：会议日、区间、SEP、上次决议都还在，卡片照常画，只是盘口那格是 —。
    const result = sanitize(reading({ probability: undefined }))
    expect(result.state).toBe('available')
    expect(result.state === 'available' ? result.reading.probability : 'kept').toBeUndefined()
  })

  it('carries the calendar failure code through and maps an unknown one to malformed', () => {
    // 四种失败不许都压成 malformed：卡片要靠码分开「没有会议 / 查不到 / 请求不合法」。
    expect(sanitize({ state: 'unavailable', failureCode: 'meeting-not-found' }))
      .toEqual({ state: 'unavailable', failureCode: 'meeting-not-found' })
    expect(sanitize({ state: 'unavailable', failureCode: 'calendar-query-unavailable' }))
      .toEqual({ state: 'unavailable', failureCode: 'calendar-query-unavailable' })
    // 旧构建写死的 `no-meeting` 不在闭集里：读不懂就落 malformed，不猜近义词。
    expect(sanitize({ state: 'unavailable', failureCode: 'no-meeting' }))
      .toEqual({ state: 'unavailable', failureCode: 'malformed' })
  })
})
