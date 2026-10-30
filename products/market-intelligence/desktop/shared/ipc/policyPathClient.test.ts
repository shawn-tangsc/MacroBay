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
    expect(result.state === 'available' ? result.reading.sep?.medianPath.y2026 : undefined).toBe(4.1)
  })

  it('drops a probability whose bucket is not one the reading can name', () => {
    const result = sanitize(reading({ probability: { venue: 'polymarket', outcome: 'hike-75', value: 0.2 } }))
    expect(result.state === 'available' ? result.reading.probability : 'kept').toBeUndefined()
  })

  it('keeps the named dissenters', () => {
    const result = sanitize(reading({
      lastDecision: { vote: { for: 10, against: 2 }, dissents: [{ name: 'Lisa D. Cook', preferred: 'raise' }], statementUrl: 'https://www.federalreserve.gov/newsevents/pressreleases/monetary20261028a.htm' }
    }))
    expect(result.state === 'available' ? result.reading.lastDecision?.dissents : undefined).toEqual([{ name: 'Lisa D. Cook', preferred: 'raise' }])
  })
})
