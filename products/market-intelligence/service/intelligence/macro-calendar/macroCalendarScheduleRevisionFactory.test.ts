import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { parseMacroCalendarEvidence } from './macroCalendarEvidenceParser'
import { createMacroCalendarScheduleRevisions } from './macroCalendarScheduleRevisionFactory'
import { getMacroCalendarOfficialSourceDescriptor } from './macroCalendarOfficialSourceRegistry'
import { parseManualBlsIcs } from './bls-ics-manual/blsManualIcsParser'

const detectedAt = '2026-08-04T00:00:00.000Z'
const fixtureDirectory = join(dirname(fileURLToPath(import.meta.url)), 'fixtures')
const fixture = (file: string) => readFileSync(join(fixtureDirectory, file), 'utf8')

describe('createMacroCalendarScheduleRevisions', () => {
  it('maps accepted Fed and BEA schedule results into deterministic internal schedule revisions', () => {
    const fed = scheduleResult('macro-calendar-fed-schedule', fixture('fed-fomc-schedule-2026-08-03.html'))
    const bea = scheduleResult('macro-calendar-bea-schedule', fixture('bea-release-schedule-2026-08-03.html'))
    const fedMapped = createMacroCalendarScheduleRevisions(fed, evidence('macro-calendar-fed-schedule'))
    const beaMapped = createMacroCalendarScheduleRevisions(bea, evidence('macro-calendar-bea-schedule'))

    expect(fedMapped.state).toBe('mapped')
    expect(beaMapped.state).toBe('mapped')
    if (fedMapped.state !== 'mapped' || beaMapped.state !== 'mapped') return
    const fomc = fedMapped.revisions.find((revision) => revision.eventKey === 'US.FOMC.2026-12-09')!
    const pce = beaMapped.revisions.find((revision) => revision.eventKey === 'US.PCE.2026-07')!
    const gdpAdvance = beaMapped.revisions.find((revision) => revision.eventKey === 'US.GDP.2026-Q3.ADVANCE')!
    const gdpSecond = beaMapped.revisions.find((revision) => revision.eventKey === 'US.GDP.2026-Q3.SECOND')!
    expect(fomc).toMatchObject({
      countryCode: 'US', importance: 'high', lifecycleState: 'scheduled', revisionKind: 'schedule',
      scheduledDate: '2026-12-09', detectedAt, recordedAt: detectedAt,
      providerId: 'macro-calendar-fed', descriptorId: 'macro-calendar-fed-schedule',
      sourceUrl: getMacroCalendarOfficialSourceDescriptor('macro-calendar-fed-schedule')!.sourceUrl,
      rawRecordId: 'raw-1', evidenceHash: 'evidence-hash', parserVersion: 'fed-fomc-schedule-v2',
      caveats: ['official-time-not-published'], evidenceRefs: [{ fieldKinds: ['schedule'], rawRecordId: 'raw-1', detectedAt }]
    })
    expect(fomc.scheduledAt).toBeUndefined()
    expect(fomc.publishedAt).toBeUndefined()
    expect(fomc.actual).toBeUndefined()
    expect(fomc.previous).toBeUndefined()
    expect(fomc.consensus).toBeUndefined()
    expect(fomc.replacesRevisionId).toBeUndefined()
    expect(fomc.evidenceRefs).toEqual([{
      providerId: 'macro-calendar-fed', descriptorId: 'macro-calendar-fed-schedule',
      sourceUrl: getMacroCalendarOfficialSourceDescriptor('macro-calendar-fed-schedule')!.sourceUrl,
      rawRecordId: 'raw-1', evidenceHash: 'evidence-hash', detectedAt, fieldKinds: ['schedule']
    }])
    expect(pce).toMatchObject({ scheduledDate: '2026-08-26', scheduledAt: '2026-08-26T12:30:00.000Z', caveats: [] })
    expect([gdpAdvance, gdpSecond]).toEqual([
      expect.objectContaining({ eventKey: 'US.GDP.2026-Q3.ADVANCE', releaseGroupKey: 'US.BEA.GDP.2026-Q3.ADVANCE', periodKey: '2026-Q3', scheduledDate: '2026-10-29' }),
      expect.objectContaining({ eventKey: 'US.GDP.2026-Q3.SECOND', releaseGroupKey: 'US.BEA.GDP.2026-Q3.SECOND', periodKey: '2026-Q3', scheduledDate: '2026-11-25' })
    ])
    expect(fedMapped.revisions.map((revision) => revision.revisionId)).toEqual(createMacroCalendarScheduleRevisions(fed, evidence('macro-calendar-fed-schedule')).state === 'mapped'
      ? (createMacroCalendarScheduleRevisions(fed, evidence('macro-calendar-fed-schedule')) as { state: 'mapped'; revisions: { revisionId: string }[] }).revisions.map((revision) => revision.revisionId)
      : [])
    expect(fomc.snapshotHash).toBe('pending-repository-snapshot-hash')
  })

  it('maps only validated manual BLS schedule drafts with their fixed evidence identity', () => {
    const body = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'bls-ics-manual', 'fixtures', 'bls-release-schedule.ics'), 'utf8')
    const parsed = parseManualBlsIcs(body)
    const mapped = createMacroCalendarScheduleRevisions(parsed, evidence('macro-calendar-bls-ics-manual'))

    expect(mapped.state).toBe('mapped')
    if (mapped.state !== 'mapped') return
    expect(mapped.revisions).toHaveLength(115)
    expect(mapped.revisions[0]).toMatchObject({
      providerId: 'macro-calendar-bls', descriptorId: 'macro-calendar-bls-ics-manual',
      detectedAt, recordedAt: detectedAt, rawRecordId: 'raw-1', evidenceHash: 'evidence-hash',
      parserVersion: 'bls-manual-ics-v1', revisionKind: 'schedule', lifecycleState: 'scheduled',
      caveats: ['official-period-not-published-in-ics', 'manual-ics-import'],
      evidenceRefs: [{ providerId: 'macro-calendar-bls', descriptorId: 'macro-calendar-bls-ics-manual', fieldKinds: ['schedule'] }]
    })
    expect(new Set(mapped.revisions.map((revision) => revision.eventKey)).size).toBe(115)
  })

  it('rejects incoherent manual BLS drafts and non-manual evidence', () => {
    const body = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'bls-ics-manual', 'fixtures', 'bls-release-schedule.ics'), 'utf8')
    const parsed = parseManualBlsIcs(body)
    if (parsed.state !== 'parsed') throw new Error('expected accepted manual BLS result')

    expect(createMacroCalendarScheduleRevisions(parsed, evidence('macro-calendar-fed-schedule'))).toEqual({
      state: 'failed', failureCode: 'schedule-input-invalid'
    })
    expect(createMacroCalendarScheduleRevisions({
      ...parsed,
      drafts: parsed.drafts.map((draft, index) => index === 0 ? { ...draft, parserVersion: 'wrong-parser' } : draft)
    }, evidence('macro-calendar-bls-ics-manual'))).toEqual({ state: 'failed', failureCode: 'schedule-input-invalid' })
  })

  it.each([
    ['provider', { providerId: 'macro-calendar-bea' }],
    ['descriptor', { descriptorId: 'macro-calendar-bea-schedule' }],
    ['parser', { parserVersion: 'wrong-parser' }],
    ['source URL', { sourceUrl: 'https://example.test/invalid' }],
    ['detectedAt', { detectedAt: '2026-08-04T00:00:00Z' }],
    ['raw id', { rawRecordId: '  ' }],
    ['hash', { evidenceHash: '  ' }]
  ])('rejects corrupted evidence %s without producing revisions', (_label, patch) => {
    const parsed = scheduleResult('macro-calendar-fed-schedule', fixture('fed-fomc-schedule-2026-08-03.html'))
    expect(createMacroCalendarScheduleRevisions(parsed, { ...evidence('macro-calendar-fed-schedule'), ...patch })).toEqual({ state: 'failed', failureCode: 'schedule-input-invalid' })
  })

  it('rejects parsed and draft mismatches, duplicate event keys, and BLS observed values', () => {
    const parsed = scheduleResult('macro-calendar-fed-schedule', fixture('fed-fomc-schedule-2026-08-03.html'))
    const mismatchedDraft = { ...parsed, drafts: parsed.drafts.map((draft, index) => index === 0 ? { ...draft, descriptorId: 'macro-calendar-bea-schedule' } : draft) }
    const mismatchedDraftProvider = { ...parsed, drafts: parsed.drafts.map((draft, index) => index === 0 ? { ...draft, providerId: 'macro-calendar-bea' } : draft) }
    const mismatchedDraftParser = { ...parsed, drafts: parsed.drafts.map((draft, index) => index === 0 ? { ...draft, parserVersion: 'wrong-parser' } : draft) }
    const mismatchedParser = { ...parsed, parserId: 'wrong-parser' }
    const duplicateDraft = { ...parsed, drafts: [...parsed.drafts, parsed.drafts[0]!] }
    const bls = parseMacroCalendarEvidence({
      descriptorId: 'macro-calendar-bls-values',
      body: readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'bls-observations', 'fixtures', 'bls-six-series-2025-2026-2026-08-03.json'), 'utf8')
    })

    expect(createMacroCalendarScheduleRevisions(mismatchedDraft, evidence('macro-calendar-fed-schedule'))).toEqual({ state: 'failed', failureCode: 'schedule-input-invalid' })
    expect(createMacroCalendarScheduleRevisions(mismatchedDraftProvider, evidence('macro-calendar-fed-schedule'))).toEqual({ state: 'failed', failureCode: 'schedule-input-invalid' })
    expect(createMacroCalendarScheduleRevisions(mismatchedDraftParser, evidence('macro-calendar-fed-schedule'))).toEqual({ state: 'failed', failureCode: 'schedule-input-invalid' })
    expect(createMacroCalendarScheduleRevisions(mismatchedParser, evidence('macro-calendar-fed-schedule'))).toEqual({ state: 'failed', failureCode: 'schedule-input-invalid' })
    expect(createMacroCalendarScheduleRevisions(duplicateDraft, evidence('macro-calendar-fed-schedule'))).toEqual({ state: 'failed', failureCode: 'schedule-input-invalid' })
    expect(createMacroCalendarScheduleRevisions(bls, evidence('macro-calendar-bls-values'))).toEqual({ state: 'failed', failureCode: 'parser-unavailable' })
  })

  it('rejects an empty schedule batch derived from an accepted Fed dispatcher result', () => {
    const parsed = scheduleResult('macro-calendar-fed-schedule', fixture('fed-fomc-schedule-2026-08-03.html'))

    expect(createMacroCalendarScheduleRevisions({ ...parsed, drafts: [] }, evidence('macro-calendar-fed-schedule'))).toEqual({
      state: 'failed', failureCode: 'schedule-input-invalid'
    })
  })
})

function scheduleResult(descriptorId: 'macro-calendar-fed-schedule' | 'macro-calendar-bea-schedule', body: string) {
  const result = parseMacroCalendarEvidence({ descriptorId, body })
  if (result.kind !== 'schedule-drafts') throw new Error('expected accepted schedule result')
  return result
}

function evidence(descriptorId: 'macro-calendar-fed-schedule' | 'macro-calendar-bea-schedule' | 'macro-calendar-bls-values' | 'macro-calendar-bls-ics-manual') {
  const descriptor = getMacroCalendarOfficialSourceDescriptor(descriptorId)!
  return {
    rawRecordId: 'raw-1', providerId: descriptor.providerId, descriptorId: descriptor.descriptorId,
    sourceUrl: descriptor.sourceUrl, evidenceHash: 'evidence-hash', detectedAt,
    parserVersion: descriptor.parserId, inserted: true, deduped: false
  }
}
