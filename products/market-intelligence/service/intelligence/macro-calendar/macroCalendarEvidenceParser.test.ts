import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { parseMacroCalendarEvidence } from './macroCalendarEvidenceParser'

const fixtureDirectory = join(dirname(fileURLToPath(import.meta.url)), 'fixtures')
const fixture = (file: string) => readFileSync(join(fixtureDirectory, file), 'utf8')
const blsFixture = () => readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'bls-observations', 'fixtures', 'bls-six-series-2025-2026-2026-08-03.json'), 'utf8')

describe('parseMacroCalendarEvidence', () => {
  it("dispatches raw accepted Fed schedule bytes and BEA's official New York schedule times", () => {
    const fed = parseMacroCalendarEvidence({ descriptorId: 'macro-calendar-fed-schedule', body: fixture('fed-fomc-schedule-2026-08-03.html') })
    const bea = parseMacroCalendarEvidence({ descriptorId: 'macro-calendar-bea-schedule', body: fixture('bea-release-schedule-2026-08-03.html') })

    expect(fed).toMatchObject({ providerId: 'macro-calendar-fed', descriptorId: 'macro-calendar-fed-schedule', parserId: 'fed-fomc-calendar-v1', kind: 'schedule-drafts' })
    expect(fed.kind === 'schedule-drafts' && fed.drafts.map((draft) => draft.eventKey)).toContain('US.FOMC.2026-12-09')
    expect(fed.kind === 'schedule-drafts' && fed.drafts.every((draft) => draft.scheduledAt === undefined && draft.caveats.includes('official-time-not-published'))).toBe(true)
    expect(bea).toMatchObject({ providerId: 'macro-calendar-bea', descriptorId: 'macro-calendar-bea-schedule', parserId: 'bea-release-calendar-v1', kind: 'schedule-drafts' })
    expect(bea.kind === 'schedule-drafts' && bea.drafts.map((draft) => draft.eventKey)).toEqual(expect.arrayContaining(['US.PCE.2026-07', 'US.CORE_PCE.2026-07', 'US.GDP.2026-Q2.SECOND', 'US.GDP.2026-Q3.ADVANCE', 'US.GDP.2026-Q3.SECOND']))
    expect(bea.kind === 'schedule-drafts' && bea.drafts).toEqual(expect.arrayContaining([
      expect.objectContaining({ eventKey: 'US.GDP.2026-Q3.ADVANCE', releaseGroupKey: 'US.BEA.GDP.2026-Q3.ADVANCE', periodKey: '2026-Q3', scheduledDate: '2026-10-29' }),
      expect.objectContaining({ eventKey: 'US.GDP.2026-Q3.SECOND', releaseGroupKey: 'US.BEA.GDP.2026-Q3.SECOND', periodKey: '2026-Q3', scheduledDate: '2026-11-25' })
    ]))
    expect(bea.kind === 'schedule-drafts' && bea.drafts.every((draft) => typeof draft.scheduledAt === 'string' && draft.caveats.length === 0)).toBe(true)
    expect(JSON.stringify(fed)).not.toContain('https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm')
    expect(JSON.stringify(bea)).not.toContain('https://www.bea.gov/news/schedule')
    expect(JSON.stringify(fed)).not.toMatch(/https?:\/\//)
    expect(JSON.stringify(bea)).not.toMatch(/https?:\/\//)
  })

  it('dispatches raw BLS JSON to observed-only drafts', () => {
    const result = parseMacroCalendarEvidence({
      descriptorId: 'macro-calendar-bls-values',
      body: blsFixture()
    })

    expect(result).toMatchObject({ providerId: 'macro-calendar-bls', descriptorId: 'macro-calendar-bls-values', parserId: 'bls-calendar-values-v1', kind: 'observed-value-drafts' })
    expect(result.kind === 'observed-value-drafts' && result.drafts).toHaveLength(5)
    expect(JSON.stringify(result)).not.toMatch(/scheduled|published|eventKey|sourceUrl|body/i)
  })

  it('returns safe skipped results for unknown and unavailable parser descriptors', () => {
    expect(parseMacroCalendarEvidence({ descriptorId: 'unknown', body: 'ignored' })).toEqual({ descriptorId: 'unknown', state: 'skipped', failureCode: 'descriptor-not-found' })
    expect(parseMacroCalendarEvidence({ descriptorId: 'macro-calendar-bls-schedule', body: 'ignored' })).toEqual({
      providerId: 'macro-calendar-bls', descriptorId: 'macro-calendar-bls-schedule', parserId: 'bls-release-calendar-v1', state: 'skipped', failureCode: 'parser-unavailable'
    })
  })

  it('fails closed for malformed BLS JSON and structurally empty parser output', () => {
    expect(parseMacroCalendarEvidence({ descriptorId: 'macro-calendar-bls-values', body: '{not-json' })).toMatchObject({
      providerId: 'macro-calendar-bls', descriptorId: 'macro-calendar-bls-values', state: 'failed', failureCode: 'payload-invalid'
    })
    expect(parseMacroCalendarEvidence({
      descriptorId: 'macro-calendar-fed-schedule',
      body: fixture('fed-fomc-schedule-2026-08-03.html').replaceAll('fomc-meeting__date', 'missing-date')
    })).toMatchObject({ providerId: 'macro-calendar-fed', descriptorId: 'macro-calendar-fed-schedule', state: 'failed', failureCode: 'parser-output-empty' })
  })
})
