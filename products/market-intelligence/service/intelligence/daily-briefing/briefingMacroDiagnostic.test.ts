import { describe, expect, it } from 'vitest'

import { briefingMacroDiagnostic, formatBriefingMacroDiagnostic } from './briefingMacroDiagnostic'

const documentWith = (macroEmpty?: string) => ({ news: { notes: macroEmpty === undefined ? {} : { macroEmpty } } }) as never
const packetWith = (lastCollectedAt?: string) => ({
  asOf: '2026-11-16T00:00:00.000Z',
  windowHours: 24,
  ...(lastCollectedAt === undefined ? {} : { calendarFreshness: { state: 'available' as const, lastCollectedAt } })
}) as never

describe('the macro diagnostic line', () => {
  it('records the reason code, the age at the decision, and the window', () => {
    const line = formatBriefingMacroDiagnostic(briefingMacroDiagnostic(
      documentWith('calendar-stale'),
      packetWith('2026-11-13T16:00:00.000Z')
    ))
    const json = JSON.parse(line.slice('[daily-briefing.macro] '.length))
    expect(json).toEqual({
      asOf: '2026-11-16T00:00:00.000Z',
      macroEmpty: 'calendar-stale',
      ageMinutes: 3360,
      windowHours: 24
    })
  })

  it('rounds the age to one decimal and writes null when there is no reading', () => {
    expect(briefingMacroDiagnostic(documentWith(), packetWith('2026-11-15T23:54:54.000Z')).ageMinutes).toBe(5.1)
    expect(briefingMacroDiagnostic(documentWith(), packetWith())).toMatchObject({ macroEmpty: null, ageMinutes: null })
  })

  it('never writes anything beyond those four fields', () => {
    const json = JSON.parse(formatBriefingMacroDiagnostic(
      briefingMacroDiagnostic(documentWith('calendar-catch-up-failed'), packetWith('2026-11-15T00:00:00.000Z'))
    ).slice('[daily-briefing.macro] '.length))
    expect(Object.keys(json).sort()).toEqual(['ageMinutes', 'asOf', 'macroEmpty', 'windowHours'])
  })
})
