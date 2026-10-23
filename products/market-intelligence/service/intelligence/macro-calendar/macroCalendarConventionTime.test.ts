import { describe, expect, it } from 'vitest'

import { conventionReleaseInstant, macroCalendarConventionTimePolicy, resolveDisplayedReleaseTime } from './macroCalendarConventionTime'

describe('macro calendar convention release times', () => {
  it('converts the 08:30 Eastern convention through daylight saving, not a fixed offset', () => {
    // BEA's own released rows sit at exactly these two instants, which is what makes 08:30 defensible.
    expect(conventionReleaseInstant('consumer-price-index', '2026-10-14')).toBe('2026-10-14T12:30:00.000Z') // EDT
    expect(conventionReleaseInstant('consumer-price-index', '2026-12-10')).toBe('2026-12-10T13:30:00.000Z') // EST
    expect(conventionReleaseInstant('employment-situation', '2026-11-10')).toBe('2026-11-10T13:30:00.000Z')
    expect(conventionReleaseInstant('fomc', '2026-10-28')).toBe('2026-10-28T18:00:00.000Z') // 14:00 EDT
  })

  it('has no convention for a family nobody has a defensible expectation about', () => {
    expect(conventionReleaseInstant('some-other-family', '2026-10-14')).toBeUndefined()
    // A date that is not a real calendar date never becomes an instant.
    expect(conventionReleaseInstant('consumer-price-index', '2026-02-30')).toBeUndefined()
    expect(conventionReleaseInstant('consumer-price-index', 'not-a-date')).toBeUndefined()
  })

  it('marks the convention as a convention, never as something the source published', () => {
    const resolved = resolveDisplayedReleaseTime({ eventFamily: 'consumer-price-index', scheduledDate: '2026-10-14' })
    expect(resolved).toEqual({
      scheduledAt: '2026-10-14T12:30:00.000Z',
      provenance: macroCalendarConventionTimePolicy.provenance.conventionDefault,
      conventionAt: '2026-10-14T12:30:00.000Z'
    })
    expect(resolved.provenance).not.toBe(macroCalendarConventionTimePolicy.provenance.official)
  })

  it('lets a published time beat the convention, and a reader edit beat them both', () => {
    const official = resolveDisplayedReleaseTime({ eventFamily: 'consumer-price-index', scheduledDate: '2026-10-14', officialScheduledAt: '2026-10-14T12:31:00.000Z' })
    expect(official.provenance).toBe(macroCalendarConventionTimePolicy.provenance.official)
    expect(official.scheduledAt).toBe('2026-10-14T12:31:00.000Z')
    // The convention is still reported beside it, so a reader can see what the expectation was.
    expect(official.conventionAt).toBe('2026-10-14T12:30:00.000Z')

    const edited = resolveDisplayedReleaseTime({ eventFamily: 'consumer-price-index', scheduledDate: '2026-10-14', officialScheduledAt: '2026-10-14T12:31:00.000Z', userEditedAt: '2026-10-14T13:00:00.000Z' })
    expect(edited.provenance).toBe(macroCalendarConventionTimePolicy.provenance.userEdited)
    expect(edited.scheduledAt).toBe('2026-10-14T13:00:00.000Z')
  })

  it('stays date-only when there is no official time and no convention', () => {
    const resolved = resolveDisplayedReleaseTime({ eventFamily: 'some-other-family', scheduledDate: '2026-10-14' })
    expect(resolved.scheduledAt).toBeUndefined()
    expect(resolved.provenance).toBe(macroCalendarConventionTimePolicy.provenance.dateOnly)
  })
})
