import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterAll, describe, expect, it, vi } from 'vitest'

import { createRawRecordStore } from '../../application/rawRecordStore'
import { createMacroCalendarEvidenceStore } from '../macroCalendarEvidenceStore'
import { createMacroCalendarRepository } from '../macroCalendarRepository'
import { createManualBlsIcsImportService, manualBlsIcsImportPolicy } from './blsManualIcsImportService'
import { createMacroCalendarEvidenceArchive } from '../macroCalendarEvidenceArchive'

const testDirectories: string[] = []
afterAll(() => testDirectories.forEach((directory) => rmSync(directory, { recursive: true, force: true })))

const fixture = () => readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'bls-release-schedule.ics'), 'utf8')
const firstCpiUid = '00001000-0000-4000-8000-000000001000'

describe('blsManualIcsImportService', () => {
  it('denies a changed import before evidence and SQLite writes when archive admission is unavailable', () => {
    const repository = { getEffectiveEventAsOf: vi.fn(() => undefined), appendManyIfNew: vi.fn() }
    const appendManualBlsIcs = vi.fn()
    const evidence = { reserve: vi.fn(() => undefined), release: vi.fn(), appendManualBlsIcs }
    const service = createManualBlsIcsImportService({
      repository: repository as never,
      evidence: evidence as never,
      now: () => '2026-08-04T00:00:00.000Z'
    })

    expect(service.import({ body: fixture(), truncated: false })).toEqual({ state: 'failed', failureCode: 'persistence-failed' })
    expect(evidence.reserve).toHaveBeenCalledWith(Buffer.byteLength(fixture(), 'utf8'))
    expect(repository.getEffectiveEventAsOf).not.toHaveBeenCalled()
    expect(appendManualBlsIcs).not.toHaveBeenCalled()
    expect(repository.appendManyIfNew).not.toHaveBeenCalled()
  })

  it('previews the official fixture without writing evidence or revisions', () => {
    const context = createContext()

    expect(context.service.preview({ body: fixture(), truncated: false })).toEqual({
      state: 'ready', totalEvents: 313, supportedReleaseGroups: 46, generatedEvents: 115,
      unsupportedEvents: 267, insertedCount: 115, rescheduledCount: 0, unchangedCount: 0
    })
    expect(context.evidence.listCalendarRecords()).toEqual([])
    expect(context.repository.inspectStorage().rowCount).toBe(0)
    context.repository.close()
  })

  it('imports one evidence record and one revision batch, then repeats as an exact zero-write no-op', () => {
    const context = createContext()
    const body = fixture()

    expect(context.service.import({ body, truncated: false })).toEqual({
      state: 'imported', totalEvents: 313, supportedReleaseGroups: 46, generatedEvents: 115,
      unsupportedEvents: 267, insertedCount: 115, rescheduledCount: 0, unchangedCount: 0
    })
    expect(context.evidence.listCalendarRecords()).toHaveLength(1)
    expect(context.repository.inspectStorage().rowCount).toBe(115)
    expect(context.repository.listVisibleProviderFactsAsOf({
      providerIds: ['macro-calendar-bls'], asOf: '2026-08-04T00:00:00.000Z'
    })).toEqual(expect.arrayContaining([
      expect.objectContaining({ eventKey: `US.CPI.RELEASE.${firstCpiUid}`, eventFamily: 'consumer-price-index', eventNameKey: 'cpi' }),
      expect.objectContaining({ eventKey: `US.CORE_CPI.RELEASE.${firstCpiUid}`, eventFamily: 'consumer-price-index', eventNameKey: 'core-cpi' })
    ]))

    context.setNow('2026-08-05T00:00:00.000Z')
    expect(context.service.import({ body, truncated: false })).toEqual({
      state: 'unchanged', totalEvents: 313, supportedReleaseGroups: 46,
      generatedEvents: 115, unsupportedEvents: 267, unchangedCount: 115
    })
    expect(context.evidence.listCalendarRecords()).toHaveLength(1)
    expect(context.repository.inspectStorage().rowCount).toBe(115)
    context.repository.close()
  })

  it('replaces same-UID reschedules and never infers a cancellation from an absent UID', () => {
    const context = createContext()
    const original = fixture()
    expect(context.service.import({ body: original, truncated: false }).state).toBe('imported')

    context.setNow('2026-08-05T00:00:00.000Z')
    const rescheduled = replaceEventStart(original, firstCpiUid, '20250115T093000')
    expect(context.service.import({ body: rescheduled, truncated: false })).toMatchObject({
      state: 'imported', insertedCount: 0, rescheduledCount: 2, unchangedCount: 113
    })
    expect(context.repository.inspectStorage().rowCount).toBe(115)

    context.setNow('2026-08-06T00:00:00.000Z')
    const withoutRelease = removeEvent(rescheduled, firstCpiUid)
    expect(context.service.import({ body: withoutRelease, truncated: false })).toMatchObject({
      state: 'unchanged', unchangedCount: 113
    })
    expect(context.repository.inspectStorage().rowCount).toBe(115)
    expect(context.repository.listVisibleProviderFactsAsOf({
      providerIds: ['macro-calendar-bls'], asOf: '2026-08-06T00:00:00.000Z'
    }).some((revision) => revision.lifecycleState === 'cancelled')).toBe(false)
    context.repository.close()
  })

  it.each([
    null,
    [],
    { body: fixture(), truncated: true },
    { body: '   ', truncated: false },
    { body: fixture(), truncated: 'false' }
  ])('rejects malformed runtime input before any dependency call', (input) => {
    const repository = { getEffectiveEventAsOf: vi.fn(), appendManyIfNew: vi.fn() }
    const evidence = { appendManualBlsIcs: vi.fn() }
    const now = vi.fn()
    const service = createManualBlsIcsImportService({ repository: repository as never, evidence: evidence as never, now })

    expect(service.preview(input)).toEqual({ state: 'failed', failureCode: 'invalid-file' })
    expect(service.import(input)).toEqual({ state: 'failed', failureCode: 'invalid-file' })
    expect(now).not.toHaveBeenCalled()
    expect(repository.getEffectiveEventAsOf).not.toHaveBeenCalled()
    expect(repository.appendManyIfNew).not.toHaveBeenCalled()
    expect(evidence.appendManualBlsIcs).not.toHaveBeenCalled()
  })

  it('returns a redacted persistence failure for evidence and atomic repository failures', () => {
    const body = fixture()
    const repository = {
      getEffectiveEventAsOf: () => undefined,
      appendManyIfNew: () => { throw new Error('sqlite /private/calendar.sqlite https://secret.test/?credential=raw') }
    }
    const evidence = createTestEvidenceStore()
    const service = createManualBlsIcsImportService({ repository: repository as never, evidence, now: () => '2026-08-04T00:00:00.000Z' })

    const result = service.import({ body, truncated: false })
    expect(result).toEqual({ state: 'failed', failureCode: 'persistence-failed' })
    expect(JSON.stringify(result)).not.toMatch(/sqlite|private|https?:|credential|raw|record|hash/i)

    const noEvidence = createManualBlsIcsImportService({
      repository: { ...repository, appendManyIfNew: vi.fn() } as never,
      evidence: {
        reserve: () => Object.freeze({}),
        release: () => true,
        appendManualBlsIcs: () => undefined
      } as never,
      now: () => '2026-08-04T00:00:00.000Z'
    })
    expect(noEvidence.import({ body, truncated: false })).toEqual({ state: 'failed', failureCode: 'persistence-failed' })
  })

  it('keeps sixty changed snapshots within the named eight MiB review envelope and bounded month query', () => {
    const context = createContext()
    const original = fixture()
    for (let index = 0; index < manualBlsIcsImportPolicy.storageReviewSnapshotCount; index += 1) {
      context.setNow(new Date(Date.UTC(2026, 7, 4, 0, 0, index)).toISOString())
      const minute = String(index).padStart(2, '0')
      expect(context.service.import({
        body: replaceEventStart(original, firstCpiUid, `20250115T08${minute}00`), truncated: false
      }).state).toBe('imported')
    }

    const evidenceBytes = context.evidence.listCalendarRecords().reduce((sum, record) => sum + (record.payloadSizeBytes ?? 0), 0)
    expect(context.evidence.listCalendarRecords()).toHaveLength(manualBlsIcsImportPolicy.storageReviewSnapshotCount)
    expect(evidenceBytes).toBeLessThan(manualBlsIcsImportPolicy.storageReviewEvidenceBytes)
    expect(context.repository.listEffectiveMonthAsOf({
      monthStart: '2025-01-01', monthEndExclusive: '2025-02-01',
      asOf: '2026-08-04T00:00:59.000Z', limit: 5_000
    }).length).toBeLessThanOrEqual(200)
    context.repository.close()
  })
})

function createContext() {
  const evidence = createTestEvidenceStore()
  const repository = createMacroCalendarRepository({ filePath: ':memory:' })
  let currentNow = '2026-08-04T00:00:00.000Z'
  return {
    evidence,
    repository,
    service: createManualBlsIcsImportService({ evidence, repository, now: () => currentNow }),
    setNow(value: string) { currentNow = value }
  }
}

function replaceEventStart(body: string, uid: string, startsAt: string): string {
  const uidIndex = body.indexOf(`UID:${uid}`)
  const startsAtIndex = body.indexOf('DTSTART;TZID=US-Eastern:', uidIndex)
  const lineEnd = body.indexOf('\n', startsAtIndex)
  return `${body.slice(0, startsAtIndex)}DTSTART;TZID=US-Eastern:${startsAt}${body.slice(lineEnd)}`
}

function removeEvent(body: string, uid: string): string {
  const newline = body.includes('\r\n') ? '\r\n' : '\n'
  const uidIndex = body.indexOf(`UID:${uid}`)
  const startMarker = `BEGIN:VEVENT${newline}`
  const endMarker = `END:VEVENT${newline}`
  const start = body.lastIndexOf(startMarker, uidIndex)
  const end = body.indexOf(endMarker, uidIndex) + endMarker.length
  return `${body.slice(0, start)}${body.slice(end)}`
}

function createTestEvidenceStore() {
  const rawRecords = createRawRecordStore()
  const directory = mkdtempSync(join(tmpdir(), 'manual-bls-evidence-'))
  testDirectories.push(directory)
  return createMacroCalendarEvidenceStore(createMacroCalendarEvidenceArchive({ rawRecords, archiveDirectory: directory }))
}
