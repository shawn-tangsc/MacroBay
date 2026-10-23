import { describe, expect, it } from 'vitest'

import { resolveBlsReleaseTime } from './blsReleaseCalendar'

describe('resolveBlsReleaseTime', () => {
  it('maps CPI observation months to the following mid-month release anchor', () => {
    expect(
      resolveBlsReleaseTime({ periodKey: '2026-M06', metricKind: 'inflation' })
    ).toBe('2026-07-13T12:30:00.000Z')
  })

  it('maps employment observation months to the first Friday of the following month', () => {
    expect(
      resolveBlsReleaseTime({ periodKey: '2026-M06', metricKind: 'employment' })
    ).toBe('2026-07-03T12:30:00.000Z')
  })
})
