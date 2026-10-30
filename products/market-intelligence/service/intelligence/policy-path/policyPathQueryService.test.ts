import { describe, expect, it } from 'vitest'

import { createPolicyPathQueryService } from './policyPathQueryService'
import type { PolicyPathObservation } from '../../../contracts/policyPath'

const values = (hike: number): PolicyPathObservation['values'] => ({
  'no-change': 1 - hike - 0.03, 'hike-25': hike, 'hike-50-plus': 0.01, 'cut-25': 0.01, 'cut-50-plus': 0.01
})
const observation = (at: string, hike: number): PolicyPathObservation => ({ at, values: values(hike), quote: { bid: hike - 0.01, ask: hike + 0.01 } })

const service = (input: {
  meeting?: { eventKey: string; scheduledDate: string } | null
  facts?: Record<string, unknown> | null
  series?: PolicyPathObservation[]
  readTargetRange?: () => { lowerPercent: number; upperPercent: number } | undefined
}) => createPolicyPathQueryService({
  calendar: { nextFomcMeeting: () => input.meeting === null ? { state: 'unavailable', failureCode: 'meeting-not-found' } as const : { state: 'available', meeting: input.meeting! } },
  facts: {
    read: () => input.facts as never,
    readLatestDecision: () => input.facts as never,
    readLatestSep: () => input.facts as never
  },
  observations: { list: () => input.series ?? [] },
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
