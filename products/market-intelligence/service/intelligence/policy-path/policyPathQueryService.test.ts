import { describe, expect, it } from 'vitest'

import { createPolicyPathQueryService } from './policyPathQueryService'
import type { PolicyPathObservation } from '../../../contracts/policyPath'

const values = (hike: number): PolicyPathObservation['values'] => ({
  'no-change': 1 - hike - 0.03, 'hike-25': hike, 'hike-50-plus': 0.01, 'cut-25': 0.01, 'cut-50-plus': 0.01
})
const observation = (at: string, hike: number): PolicyPathObservation => ({ at, values: values(hike), quote: { bid: hike - 0.01, ask: hike + 0.01 } })
/** For a realised band the hike helper cannot describe, such as a cut. */
const CUT_VALUES: PolicyPathObservation['values'] = {
  'no-change': 0.2, 'hike-25': 0.01, 'hike-50-plus': 0.01, 'cut-25': 0.77, 'cut-50-plus': 0.01
}

const service = (input: {
  meeting?: { eventKey: string; scheduledDate: string } | null
  facts?: Record<string, unknown> | null
  /** The decision before `facts`; the settlement strip asks for the day before the meeting. */
  previousDecision?: Record<string, unknown> | null
  /** The meeting the calendar returns once the decided one is in the past. */
  nextAfter?: { eventKey: string; scheduledDate: string }
  series?: PolicyPathObservation[]
  /** Observations per meeting, when the decided meeting and the next one differ. */
  observations?: Record<string, PolicyPathObservation[]>
  readTargetRange?: () => { lowerPercent: number; upperPercent: number } | undefined
}) => createPolicyPathQueryService({
  calendar: {
    nextFomcMeeting: (query: unknown) => {
      const meetingDate = typeof (input.facts as { meetingDate?: unknown } | null | undefined)?.meetingDate === 'string'
        ? String((input.facts as { meetingDate: string }).meetingDate)
        : ''
      const queriedAt = String((query as { asOf?: string } | undefined)?.asOf ?? '').slice(0, 10)
      if (input.nextAfter && meetingDate && queriedAt > meetingDate) return { state: 'available', meeting: input.nextAfter } as const
      return input.meeting === null
        ? { state: 'unavailable', failureCode: 'meeting-not-found' } as const
        : { state: 'available', meeting: input.meeting! } as const
    }
  },
  facts: {
    read: () => input.facts as never,
    readLatestDecision: (asOf: string) => {
      const meetingDate = (input.facts as { meetingDate?: string } | null | undefined)?.meetingDate
      return (input.previousDecision && meetingDate && asOf.slice(0, 10) < meetingDate
        ? input.previousDecision
        : input.facts) as never
    },
    readLatestDecisionBefore: () => input.previousDecision as never,
    readLatestSep: () => input.facts as never
  },
  observations: { list: (meetingDate: string) => input.observations?.[meetingDate] ?? input.series ?? [] },
  ...(input.readTargetRange ? { readTargetRange: input.readTargetRange } : {})
})

describe('policy path query service', () => {
  it('joins the calendar date, the official facts and the odds', () => {
    const reading = service({
      meeting: { eventKey: 'US.FOMC.2026-12-09', scheduledDate: '2026-12-09' },
      facts: { meetingDate: '2026-12-09', hasProjectionMaterials: true, targetRange: { lowerPercent: 3.75, upperPercent: 4 }, vote: { for: 10, against: 2 }, detectedAt: '2026-10-29T00:00:00.000Z' },
      series: [observation('2026-10-29T02:00:00.000Z', 0.775), observation('2026-10-30T02:00:00.000Z', 0.765)]
    }).read({ asOf: '2026-10-30T02:10:00.000Z' })!

    expect(reading.meetingDate).toBe('2026-12-09')
    expect(reading.daysUntilMeeting).toBe(40)
    expect(reading.hasProjectionMaterials).toBe(true)
    expect(reading.targetRange).toEqual({ lowerPercent: 3.75, upperPercent: 4, source: 'statement' })
    expect(reading.lastDecision?.vote).toEqual({ for: 10, against: 2 })
    expect(reading.probability).toMatchObject({ outcome: 'hike-25', changeInPp24h: -1, venue: 'polymarket' })
    expect(reading.probability?.range30d).toEqual({ min: 0.765, max: 0.775 })
    expect(reading.staleness).toBe('live')
  })

  it('marks a range that fell back to FRED as a FRED reading, not a statement one', () => {
    const reading = service({
      meeting: { eventKey: 'US.FOMC.2026-12-09', scheduledDate: '2026-12-09' },
      facts: null,
      readTargetRange: () => ({ lowerPercent: 3.5, upperPercent: 3.75 })
    }).read({ asOf: '2026-10-30T02:10:00.000Z' })!

    expect(reading.targetRange).toEqual({ lowerPercent: 3.5, upperPercent: 3.75, source: 'fred' })
  })

  it('reports no reading when the calendar has no next meeting', () => {
    expect(service({ meeting: null }).read({ asOf: '2026-10-30T02:10:00.000Z' })).toBeUndefined()
  })

  it('still answers with the official facts when the odds are missing', () => {
    const reading = service({
      meeting: { eventKey: 'US.FOMC.2026-12-09', scheduledDate: '2026-12-09' },
      facts: { meetingDate: '2026-12-09', hasProjectionMaterials: false, detectedAt: '2026-10-29T00:00:00.000Z' }
    }).read({ asOf: '2026-10-30T02:10:00.000Z' })!
    expect(reading.probability).toBeUndefined()
    expect(reading.staleness).toBe('unavailable')
    expect(reading.hasProjectionMaterials).toBe(false)
  })

  it('marks a quote that has not been refreshed as stale', () => {
    const reading = service({
      meeting: { eventKey: 'US.FOMC.2026-12-09', scheduledDate: '2026-12-09' },
      facts: null,
      series: [observation('2026-10-27T02:00:00.000Z', 0.7)]
    }).read({ asOf: '2026-10-30T02:10:00.000Z' })!
    expect(reading.staleness).toBe('stale')
  })
})

describe('policy path reading windows', () => {
  it('ignores observations after the requested instant', () => {
    const probe = service({
      meeting: { eventKey: 'US.FOMC.2026-12-09', scheduledDate: '2026-12-09' },
      facts: { meetingDate: '2026-12-09', hasProjectionMaterials: false, detectedAt: '2026-10-29T00:00:00.000Z' },
      series: [observation('2026-10-28T00:00:00.000Z', 0.6), observation('2026-10-31T00:00:00.000Z', 0.9)]
    })
    const reading = probe.read({ asOf: '2026-10-30T00:00:00.000Z' })!
    // The later print belongs to a future the caller did not ask about.
    expect(reading.probability?.value).toBeCloseTo(0.6, 5)
    expect(reading.probability?.asOf).toBe('2026-10-28T00:00:00.000Z')
  })
})

describe('policy path phase', () => {
  const meeting = { eventKey: 'US.FOMC.2026-12-09', scheduledDate: '2026-12-09' }
  const decidedFact = {
    meetingDate: '2026-12-09', hasProjectionMaterials: true,
    targetRange: { lowerPercent: 4, upperPercent: 4.25 }, vote: { for: 9, against: 3 },
    detectedAt: '2026-12-09T19:05:00.000Z'
  }

  it('upgrades to the countdown once the meeting is inside fourteen days', () => {
    const reading = service({ meeting, facts: null }).read({ asOf: '2026-12-03T19:00:00.000Z' })!
    expect(reading.phase).toEqual({ kind: 'pre-meeting', daysLeft: 6 })
  })

  it('keeps the meeting that just decided through settlement and its verdict days', () => {
    const settlement = service({ meeting, facts: decidedFact }).read({ asOf: '2026-12-09T20:00:00.000Z' })!
    expect(settlement.phase).toEqual({ kind: 'settlement', minutesSinceDecision: 60 })

    const verdict = service({ meeting, facts: decidedFact }).read({ asOf: '2026-12-10T20:00:00.000Z' })!
    expect(verdict.phase).toEqual({ kind: 'verdict', daysSinceDecision: 1 })

    // Three days after the decision the card belongs to the next meeting again.
    const normal = service({ meeting, facts: decidedFact }).read({ asOf: '2026-12-12T20:00:00.000Z' })!
    expect(normal.phase).toEqual({ kind: 'normal' })
  })
})

describe('policy path repricing markers', () => {
  const meeting = { eventKey: 'US.FOMC.2026-12-09', scheduledDate: '2026-12-09' }

  it('names the strongest move once, from the daily window', () => {
    const reading = service({
      meeting, facts: null,
      series: [
        observation('2026-10-29T00:00:00.000Z', 0.6),
        observation('2026-10-30T05:00:00.000Z', 0.72),
        observation('2026-10-30T10:00:00.000Z', 0.69)
      ]
    }).read({ asOf: '2026-10-30T10:10:00.000Z' })!
    expect(reading.markers).toEqual([{ kind: 'repricing', level: 'strong', changeInPp: 9 }])
  })

  it('falls back to the six-hour move when the series is younger than a day', () => {
    const reading = service({
      meeting, facts: null,
      series: [observation('2026-10-30T03:00:00.000Z', 0.7), observation('2026-10-30T10:00:00.000Z', 0.74)]
    }).read({ asOf: '2026-10-30T10:10:00.000Z' })!
    expect(reading.markers).toEqual([{ kind: 'intraday', level: 'normal', changeInPp: 4 }])
  })
})

describe('policy path settlement', () => {
  const meeting = { eventKey: 'US.FOMC.2026-12-09', scheduledDate: '2026-12-09' }
  const previous = {
    meetingDate: '2026-11-04', hasProjectionMaterials: false,
    targetRange: { lowerPercent: 3.75, upperPercent: 4 }, detectedAt: '2026-11-04T19:05:00.000Z'
  }
  const decided = {
    meetingDate: '2026-12-09', hasProjectionMaterials: true,
    targetRange: { lowerPercent: 4, upperPercent: 4.25 }, vote: { for: 9, against: 3 },
    detectedAt: '2026-12-09T19:05:00.000Z'
  }
  const nextAfter = { eventKey: 'US.FOMC.2027-01-27', scheduledDate: '2027-01-27' }

  it('settles the realised band against the price one hour before the decision', () => {
    const reading = service({
      meeting, facts: decided, previousDecision: previous, nextAfter,
      series: [
        // The last point at or before T0-1h is the one that counts: the 18:40 print already reacts
        // to the statement and must not be mistaken for the price before it.
        observation('2026-12-09T17:00:00.000Z', 0.3),
        observation('2026-12-09T18:00:00.000Z', 0.38),
        observation('2026-12-09T18:40:00.000Z', 0.9)
      ]
    }).read({ asOf: '2026-12-09T20:00:00.000Z' })!

    expect(reading.phase).toEqual({ kind: 'settlement', minutesSinceDecision: 60 })
    expect(reading.settlement).toMatchObject({
      decidedMeetingDate: '2026-12-09',
      previousTargetRange: { lowerPercent: 3.75, upperPercent: 4 },
      actualOutcome: 'hike-25',
      priced: 0.38,
      pricedOutcome: 'no-change',
      pricedDistribution: values(0.38),
      conclusion: { kind: 'relative', direction: 'hawkish', surprisePp: 62 },
      nextMeeting: { meetingDate: '2027-01-27', daysUntil: 48 }
    })
  })

  it('calls the outcome priced when it was already the leading band', () => {
    const reading = service({
      meeting,
      facts: { ...decided, targetRange: { lowerPercent: 3.75, upperPercent: 4 } },
      previousDecision: previous, nextAfter,
      series: [observation('2026-12-09T18:00:00.000Z', 0.37)]
    }).read({ asOf: '2026-12-09T20:00:00.000Z' })!

    expect(reading.settlement?.actualOutcome).toBe('no-change')
    expect(reading.settlement?.pricedOutcome).toBe('no-change')
    expect(reading.settlement?.conclusion).toEqual({ kind: 'priced' })
  })

  it('names the missing pre-decision price instead of guessing a conclusion', () => {
    const reading = service({
      meeting, facts: decided, previousDecision: previous, nextAfter,
      series: [observation('2026-12-09T18:30:00.000Z', 0.5)]
    }).read({ asOf: '2026-12-09T20:00:00.000Z' })!

    expect(reading.settlement).toMatchObject({
      actualOutcome: 'hike-25',
      conclusion: { kind: 'unavailable', reason: 'settlement-pricing-unavailable' }
    })
    expect(reading.settlement?.priced).toBeUndefined()
    expect(reading.settlement?.pricedOutcome).toBeUndefined()
  })

  it('reads a cut from the range change and keeps the strip through the next day', () => {
    const reading = service({
      meeting,
      facts: { ...decided, targetRange: { lowerPercent: 3.75, upperPercent: 4 } },
      previousDecision: { ...previous, targetRange: { lowerPercent: 4, upperPercent: 4.25 } },
      nextAfter,
      observations: { '2026-12-09': [{ at: '2026-12-09T18:00:00.000Z', values: CUT_VALUES }] }
    }).read({ asOf: '2026-12-10T20:00:00.000Z' })!

    expect(reading.phase).toEqual({ kind: 'verdict', daysSinceDecision: 1 })
    expect(reading.meetingDate).toBe('2027-01-27')
    expect(reading.settlement).toMatchObject({
      actualOutcome: 'cut-25',
      pricedOutcome: 'cut-25',
      conclusion: { kind: 'priced' },
      nextMeeting: { meetingDate: '2027-01-27', daysUntil: 47 }
    })
  })
})

describe('policy path projection gap', () => {
  it('carries the previous quarter gap the countdown block compares against', () => {
    const reading = service({
      meeting: { eventKey: 'US.FOMC.2026-12-09', scheduledDate: '2026-12-09' },
      facts: {
        meetingDate: '2026-12-09', hasProjectionMaterials: true,
        targetRange: { lowerPercent: 3.75, upperPercent: 4 },
        sep: {
          asOf: '2026-09-16', medianPath: { y2026: 4.1 }, medianCurrentYear: 4.1, previousMedian: 3.9,
          sourceUrl: 'https://www.federalreserve.gov/monetarypolicy/fomcprojtabl20260916.htm'
        },
        detectedAt: '2026-10-29T00:00:00.000Z'
      }
    }).read({ asOf: '2026-10-30T10:00:00.000Z' })!

    // 4.1 against the 3.875 midpoint is one 25bp step; last quarter's 3.9 was on the midpoint.
    expect(reading.sep?.stepsFromCurrent).toBe(1)
    expect(reading.sep?.previousStepsFromCurrent).toBe(0)
  })
})

describe('last decision direction', () => {
  it('names a hike from the two ranges instead of calling every decision a hold', () => {
    const probe = service({
      meeting: { eventKey: 'US.FOMC.2026-12-09', scheduledDate: '2026-12-09' },
      facts: { meetingDate: '2026-12-09', hasProjectionMaterials: false, targetRange: { lowerPercent: 4, upperPercent: 4.25 }, vote: { for: 9, against: 3 }, detectedAt: '2026-12-10T00:00:00.000Z' },
      previousDecision: { meetingDate: '2026-10-28', hasProjectionMaterials: false, targetRange: { lowerPercent: 3.75, upperPercent: 4 }, detectedAt: '2026-10-29T00:00:00.000Z' }
    })
    expect(probe.read({ asOf: '2026-12-10T00:00:00.000Z' })?.lastDecision?.outcome).toBe('hike-25')
  })

  it('leaves the direction unknown when there is no earlier range to compare', () => {
    const probe = service({
      meeting: { eventKey: 'US.FOMC.2026-12-09', scheduledDate: '2026-12-09' },
      facts: { meetingDate: '2026-12-09', hasProjectionMaterials: false, targetRange: { lowerPercent: 4, upperPercent: 4.25 }, vote: { for: 9, against: 3 }, detectedAt: '2026-12-10T00:00:00.000Z' }
    })
    expect(probe.read({ asOf: '2026-12-10T00:00:00.000Z' })?.lastDecision?.outcome).toBeUndefined()
  })
})
