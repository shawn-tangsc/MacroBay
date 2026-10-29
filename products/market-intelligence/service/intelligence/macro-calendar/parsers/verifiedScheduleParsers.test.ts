import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { getMacroCalendarOfficialSourceDescriptor } from '../macroCalendarOfficialSourceRegistry'
import { parseBeaReleaseSchedule } from './beaReleaseScheduleParser'
import { parseFedFomcSchedule } from './fedFomcScheduleParser'
import { hasVerifiedScheduleFixture } from './verifiedScheduleParserSupport'

const fixtureDirectory = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures')
const fixture = (file: string) => readFileSync(join(fixtureDirectory, file), 'utf8')
const descriptor = (id: string) => getMacroCalendarOfficialSourceDescriptor(id)!

describe('verified official schedule parsers', () => {
  it('parses only final FOMC meeting dates from the raw official Fed capture', () => {
    const drafts = parseFedFomcSchedule({
      descriptor: descriptor('macro-calendar-fed-schedule'),
      body: fixture('fed-fomc-schedule-2026-08-03.html')
    })

    expect(drafts.map((draft) => draft.eventKey)).toEqual(expect.arrayContaining([
      'US.FOMC.2026-01-28', 'US.FOMC.2026-03-18', 'US.FOMC.2026-12-09'
    ]))
    expect(drafts.every((draft) => draft.scheduledAt === undefined && draft.caveats.includes('official-time-not-published'))).toBe(true)
    // The asterisk on the date block is the only signal that a meeting also publishes projections.
    expect(drafts.find((draft) => draft.eventKey === 'US.FOMC.2026-03-18')?.hasProjectionMaterials).toBe(true)
    expect(drafts.find((draft) => draft.eventKey === 'US.FOMC.2026-12-09')?.hasProjectionMaterials).toBe(false)
    expect(JSON.stringify(drafts)).not.toContain('href')
  })

  it('parses scheduled release instants and exact PCE/GDP estimate identities from the raw BEA capture', () => {
    const drafts = parseBeaReleaseSchedule({
      descriptor: descriptor('macro-calendar-bea-schedule'),
      body: fixture('bea-release-schedule-2026-08-03.html')
    })

    expect(drafts.map((draft) => draft.eventKey)).toEqual(expect.arrayContaining([
      'US.PCE.2026-07', 'US.CORE_PCE.2026-07', 'US.GDP.2026-Q2.SECOND', 'US.GDP.2026-Q2.THIRD', 'US.GDP.2026-Q3.ADVANCE', 'US.GDP.2026-Q3.SECOND'
    ]))
    expect(drafts).toEqual(expect.arrayContaining([
      expect.objectContaining({ eventKey: 'US.PCE.2026-07', releaseGroupKey: 'US.BEA.PCE.2026-07', scheduledDate: '2026-08-26', scheduledAt: '2026-08-26T12:30:00.000Z', caveats: [] }),
      expect.objectContaining({ eventKey: 'US.CORE_PCE.2026-07', releaseGroupKey: 'US.BEA.PCE.2026-07', scheduledDate: '2026-08-26', scheduledAt: '2026-08-26T12:30:00.000Z', caveats: [] }),
      expect.objectContaining({ eventKey: 'US.GDP.2026-Q2.SECOND', releaseGroupKey: 'US.BEA.GDP.2026-Q2.SECOND', periodKey: '2026-Q2', scheduledDate: '2026-08-26', scheduledAt: '2026-08-26T12:30:00.000Z', caveats: [] }),
      expect.objectContaining({ eventKey: 'US.GDP.2026-Q2.THIRD', releaseGroupKey: 'US.BEA.GDP.2026-Q2.THIRD', periodKey: '2026-Q2', scheduledDate: '2026-09-30', scheduledAt: '2026-09-30T12:30:00.000Z', caveats: [] }),
      expect.objectContaining({ eventKey: 'US.GDP.2026-Q3.ADVANCE', releaseGroupKey: 'US.BEA.GDP.2026-Q3.ADVANCE', periodKey: '2026-Q3', scheduledDate: '2026-10-29', scheduledAt: '2026-10-29T12:30:00.000Z', caveats: [] }),
      expect.objectContaining({ eventKey: 'US.GDP.2026-Q3.SECOND', releaseGroupKey: 'US.BEA.GDP.2026-Q3.SECOND', periodKey: '2026-Q3', scheduledDate: '2026-11-25', scheduledAt: '2026-11-25T13:30:00.000Z', caveats: [] })
    ]))
    expect(drafts.some((draft) => draft.eventKey.includes('County'))).toBe(false)
    expect(JSON.stringify(drafts)).not.toContain('href')
  })

  it('rejects unrecognized GDP estimate variants without changing PCE identities', () => {
    const bea = fixture('bea-release-schedule-2026-08-03.html')
    const drafts = parseBeaReleaseSchedule({
      descriptor: descriptor('macro-calendar-bea-schedule'),
      body: bea.replace('GDP (Advance Estimate), 3rd Quarter 2026', 'GDP (Fourth Estimate), 3rd Quarter 2026')
    })

    expect(drafts.map((draft) => draft.eventKey)).not.toContain('US.GDP.2026-Q3.ADVANCE')
    expect(drafts.map((draft) => draft.eventKey)).toEqual(expect.arrayContaining(['US.PCE.2026-07', 'US.CORE_PCE.2026-07']))
  })

  it('rejects a descriptor mismatch, unavailable provenance, and missing required raw structures', () => {
    const fed = fixture('fed-fomc-schedule-2026-08-03.html')
    const bea = fixture('bea-release-schedule-2026-08-03.html')

    expect(parseFedFomcSchedule({ descriptor: descriptor('macro-calendar-bea-schedule'), body: fed })).toEqual([])
    expect(parseBeaReleaseSchedule({ descriptor: descriptor('macro-calendar-bls-schedule'), body: bea })).toEqual([])
    expect(hasVerifiedScheduleFixture({ descriptor: descriptor('macro-calendar-bls-schedule'), body: bea }, 'macro-calendar-bls-schedule')).toBe(false)
    expect(hasVerifiedScheduleFixture({ descriptor: { ...descriptor('macro-calendar-fed-schedule'), sourceUrl: 'https://example.invalid' }, body: fed }, 'macro-calendar-fed-schedule')).toBe(false)
    expect(parseFedFomcSchedule({ descriptor: descriptor('macro-calendar-fed-schedule'), body: fed.replaceAll('fomc-meeting__date', 'missing-date') })).toEqual([])
    expect(parseBeaReleaseSchedule({ descriptor: descriptor('macro-calendar-bea-schedule'), body: bea.replace('release-schedule-table', 'missing-table') })).toEqual([])
    expect(parseBeaReleaseSchedule({ descriptor: descriptor('macro-calendar-bea-schedule'), body: bea.replaceAll('release-title', 'missing-title') })).toEqual([])
  })
})
