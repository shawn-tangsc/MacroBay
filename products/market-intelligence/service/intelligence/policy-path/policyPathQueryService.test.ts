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
}) => createPolicyPathQueryService({
  calendar: { nextFomcMeeting: () => input.meeting === null ? { state: 'unavailable', failureCode: 'meeting-not-found' } as const : { state: 'available', meeting: input.meeting! } },
  facts: { read: () => input.facts as never },
  observations: { list: () => input.series ?? [] }
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
    expect(reading.targetRange).toEqual({ lowerPercent: 3.75, upperPercent: 4 })
    expect(reading.lastDecision?.vote).toEqual({ for: 10, against: 2 })
    expect(reading.probability).toMatchObject({ outcome: 'hike-25', changeInPp24h: -1, venue: 'polymarket' })
    expect(reading.probability?.range30d).toEqual({ min: 0.765, max: 0.775 })
    expect(reading.staleness).toBe('live')
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
