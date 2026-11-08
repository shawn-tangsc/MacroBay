import { describe, expect, it } from 'vitest'

import { duplicatedIdentities, preferredObservation, type MarketObservationCandidate } from './marketCalendarObservationPrecedence'

const candidate = (overrides: Partial<MarketObservationCandidate> = {}): MarketObservationCandidate => ({
  eventIdentity: 'US|economic-indicator|2026-10',
  hasActual: false,
  visibleAt: '2026-11-07T13:30:00.000Z',
  stableKey: 'observation-a',
  ...overrides
})

describe('market observation precedence', () => {
  it('prefers a released row over a waiting one, whatever order they arrive in', () => {
    const waiting = candidate({ hasActual: false, visibleAt: '2026-11-07T13:30:00.000Z' })
    const released = candidate({ hasActual: true, visibleAt: '2026-11-07T13:30:05.000Z' })
    // 非农那次：推送读到「等待中」、日报读到有值那行。顺序不该决定胜负。
    expect(preferredObservation(waiting, released)).toBe(true)
    expect(preferredObservation(released, waiting)).toBe(false)
    expect(preferredObservation(undefined, waiting)).toBe(true)
  })

  it('takes the newer correction when both rows are released', () => {
    const first = candidate({ hasActual: true, visibleAt: '2026-11-07T13:30:05.000Z', stableKey: 'a' })
    const corrected = candidate({ hasActual: true, visibleAt: '2026-11-07T15:00:00.000Z', stableKey: 'b' })
    expect(preferredObservation(first, corrected)).toBe(true)
    expect(preferredObservation(corrected, first)).toBe(false)
  })

  it('falls back to the stable key so a replay always picks the same row', () => {
    const left = candidate({ visibleAt: '2026-11-07T13:30:00.000Z', stableKey: 'observation-a' })
    const right = candidate({ visibleAt: '2026-11-07T13:30:00.000Z', stableKey: 'observation-b' })
    expect(preferredObservation(left, right)).toBe(true)
    expect(preferredObservation(right, left)).toBe(false)
    // 一条坏时间戳不许赢过一条正常的：读不出来按更旧处理。
    expect(preferredObservation(candidate({ visibleAt: 'not-an-instant' }), candidate({ visibleAt: '2026-11-07T13:30:00.000Z' }))).toBe(true)
    expect(preferredObservation(candidate({ visibleAt: '2026-11-07T13:30:00.000Z' }), candidate({ visibleAt: 'not-an-instant' }))).toBe(false)
  })

  it('names the identities that arrived twice, so a duplicate is reported as a defect', () => {
    expect(duplicatedIdentities(['a', 'b', 'a', 'c', 'b', 'a'])).toEqual(['a', 'b'])
    expect(duplicatedIdentities(['a', 'b'])).toEqual([])
  })
})
