import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterAll, describe, expect, it, vi } from 'vitest'

import { createRawRecordStore } from '../application/rawRecordStore'
import type { MacroCalendarRepository } from './macroCalendarRepository'
import { createMacroCalendarRepository } from './macroCalendarRepository'
import { createMacroCalendarEvidenceStore } from './macroCalendarEvidenceStore'
import { getMacroCalendarOfficialSourceDescriptor } from './macroCalendarOfficialSourceRegistry'
import { createMacroCalendarSchedulePersistenceService } from './macroCalendarSchedulePersistenceService'
import { createMacroCalendarEvidenceArchive } from './macroCalendarEvidenceArchive'

const testDirectories: string[] = []
afterAll(() => testDirectories.forEach((directory) => rmSync(directory, { recursive: true, force: true })))

const detectedAt = '2026-08-04T00:00:00.000Z'
const fixtureDirectory = join(dirname(fileURLToPath(import.meta.url)), 'fixtures')
const fixture = (file: string) => readFileSync(join(fixtureDirectory, file), 'utf8')

describe('macroCalendarSchedulePersistenceService', () => {
  it('reads verified archived schedule bytes through the evidence boundary', () => {
    const body = fixture('fed-fomc-schedule-2026-08-03.html')
    const descriptor = getMacroCalendarOfficialSourceDescriptor('macro-calendar-fed-schedule')!
    const record = {
      rawRecordId: 'raw-file', sourceId: descriptor.descriptorId, runId: 'run-file', sourceUrl: descriptor.sourceUrl,
      detectedAt, payloadFormat: descriptor.payloadFormat, payloadRefType: 'file' as const, payloadFileRef: 'hash.bin',
      payloadSizeBytes: Buffer.byteLength(body), payloadHash: hash(body), sourceDedupeKey: 'file', processingOwner: 'macro-calendar' as const,
      processingState: 'received' as const, parserVersion: descriptor.parserId, storageTier: 'warm' as const, archiveStatus: 'archived' as const
    }
    const repository = createMacroCalendarRepository({ filePath: ':memory:' })
    const evidence = { getCalendarRecord: () => record, readBody: () => body }

    expect(createMacroCalendarSchedulePersistenceService({ evidence: evidence as never, repository }).persistScheduleEvidence(record.rawRecordId)).toMatchObject({
      state: 'persisted', providerId: 'macro-calendar-fed'
    })
    repository.close()
  })

  it('fails closed when archived evidence cannot be read', () => {
    const source = createTestEvidenceStore()
    const record = appendScheduleEvidence(source, 'macro-calendar-fed-schedule', fixture('fed-fomc-schedule-2026-08-03.html'))
    const appendIfNew = vi.fn()
    const evidence = { ...source, readBody: () => { throw new Error('/private/archive/hash.bin') } }

    expect(createMacroCalendarSchedulePersistenceService({
      evidence,
      repository: { appendIfNew } as never
    }).persistScheduleEvidence(record.rawRecordId)).toEqual({
      providerId: 'macro-calendar-fed', descriptorId: 'macro-calendar-fed-schedule',
      state: 'failed', failureCode: 'evidence-invalid', insertedCount: 0
    })
    expect(appendIfNew).not.toHaveBeenCalled()
  })

  it('persists verified Fed evidence appended through the real macro evidence store', () => {
    const rawRecords = createRawRecordStore()
    const evidence = createTestEvidenceStore(rawRecords)
    const repository = createMacroCalendarRepository({ filePath: ':memory:' })
    const record = appendScheduleEvidence(evidence, 'macro-calendar-fed-schedule', fixture('fed-fomc-schedule-2026-08-03.html'))
    const service = createMacroCalendarSchedulePersistenceService({ evidence, repository })

    expect(service.persistScheduleEvidence(record.rawRecordId)).toMatchObject({
      providerId: 'macro-calendar-fed', descriptorId: 'macro-calendar-fed-schedule', state: 'persisted', insertedCount: expect.any(Number), dedupedCount: 0
    })
    expect(repository.getEffectiveEventAsOf({ eventKey: 'US.FOMC.2026-12-09', asOf: detectedAt })).toMatchObject({
      rawRecordId: record.rawRecordId, detectedAt, scheduledDate: '2026-12-09', lifecycleState: 'scheduled'
    })
    repository.close()
  })

  it('persists the distinct BEA GDP estimate revisions with a shared measured quarter', () => {
    const evidence = createTestEvidenceStore()
    const repository = createMacroCalendarRepository({ filePath: ':memory:' })
    const record = appendScheduleEvidence(evidence, 'macro-calendar-bea-schedule', fixture('bea-release-schedule-2026-08-03.html'))
    const service = createMacroCalendarSchedulePersistenceService({ evidence, repository })

    expect(service.persistScheduleEvidence(record.rawRecordId)).toMatchObject({ state: 'persisted', providerId: 'macro-calendar-bea' })
    expect([
      repository.getEffectiveEventAsOf({ eventKey: 'US.GDP.2026-Q3.ADVANCE', asOf: detectedAt }),
      repository.getEffectiveEventAsOf({ eventKey: 'US.GDP.2026-Q3.SECOND', asOf: detectedAt })
    ]).toEqual([
      expect.objectContaining({ releaseGroupKey: 'US.BEA.GDP.2026-Q3.ADVANCE', periodKey: '2026-Q3', scheduledDate: '2026-10-29' }),
      expect.objectContaining({ releaseGroupKey: 'US.BEA.GDP.2026-Q3.SECOND', periodKey: '2026-Q3', scheduledDate: '2026-11-25' })
    ])
    repository.close()
  })

  it('makes exact replay idempotent through repository semantic dedupe', () => {
    const evidence = createTestEvidenceStore()
    const repository = createMacroCalendarRepository({ filePath: ':memory:' })
    const record = appendScheduleEvidence(evidence, 'macro-calendar-fed-schedule', fixture('fed-fomc-schedule-2026-08-03.html'))
    const service = createMacroCalendarSchedulePersistenceService({ evidence, repository })
    const first = service.persistScheduleEvidence(record.rawRecordId)
    const replay = service.persistScheduleEvidence(record.rawRecordId)

    expect(first).toMatchObject({ state: 'persisted', dedupedCount: 0 })
    expect(replay).toEqual({ providerId: 'macro-calendar-fed', descriptorId: 'macro-calendar-fed-schedule', state: 'persisted', insertedCount: 0, dedupedCount: first.state === 'persisted' ? first.insertedCount : 0 })
    repository.close()
  })

  it('rejects generic, corrupted, and unsupported raw records before a repository write', () => {
    const rawRecords = createRawRecordStore()
    const evidence = createTestEvidenceStore(rawRecords)
    const writes: unknown[] = []
    const repository = { appendIfNew: (revision: unknown) => { writes.push(revision); return { inserted: true, revision } } } as unknown as MacroCalendarRepository
    const fedBody = fixture('fed-fomc-schedule-2026-08-03.html')
    const generic = rawRecords.appendRawRecord({ sourceId: 'generic', runId: 'generic-run', payloadFormat: 'html', payloadRefType: 'inline', payloadBody: fedBody, payloadHash: hash(fedBody), sourceDedupeKey: 'generic', parserVersion: 'generic-v1' })!
    const corrupted = seedMacroRecord(rawRecords, 'macro-calendar-fed-schedule', fedBody, { payloadHash: 'wrong-hash' }, 'hash')
    const wrongUrl = seedMacroRecord(rawRecords, 'macro-calendar-fed-schedule', fedBody, { sourceUrl: 'https://example.test/wrong' }, 'url')
    const wrongFormat = seedMacroRecord(rawRecords, 'macro-calendar-fed-schedule', fedBody, { payloadFormat: 'text' }, 'format')
    const wrongParser = seedMacroRecord(rawRecords, 'macro-calendar-fed-schedule', fedBody, { parserVersion: 'wrong-parser' }, 'parser')
    const missingInlineBody = seedMacroRecord(rawRecords, 'macro-calendar-fed-schedule', fedBody, { payloadRefType: 'file', payloadBody: undefined }, 'inline-body')
    const wrongDetectedAt = seedMacroRecord(rawRecords, 'macro-calendar-fed-schedule', fedBody, { detectedAt: '2026-08-04T00:00:00Z' }, 'detected-at')
    const wrongByteCount = seedMacroRecord(rawRecords, 'macro-calendar-fed-schedule', fedBody, { payloadSizeBytes: 1 }, 'byte-count')
    const bls = seedMacroRecord(rawRecords, 'macro-calendar-bls-values', '{"Results":{"series":[]}}')
    const unknown = rawRecords.appendRawRecord({
      sourceId: 'unknown-macro-source', runId: 'unknown-run', sourceUrl: 'https://example.test/unknown', detectedAt,
      payloadFormat: 'html', payloadRefType: 'inline', payloadBody: fedBody, payloadHash: hash(fedBody),
      sourceDedupeKey: 'unknown-macro-source', processingOwner: 'macro-calendar', parserVersion: 'unknown-v1'
    })!
    const service = createMacroCalendarSchedulePersistenceService({ evidence, repository })

    expect(service.persistScheduleEvidence('  ')).toEqual({ state: 'failed', failureCode: 'evidence-invalid', insertedCount: 0 })
    expect(service.persistScheduleEvidence(generic.rawRecordId)).toEqual({ state: 'failed', failureCode: 'evidence-not-found', insertedCount: 0 })
    expect(service.persistScheduleEvidence(corrupted)).toEqual({ providerId: 'macro-calendar-fed', descriptorId: 'macro-calendar-fed-schedule', state: 'failed', failureCode: 'evidence-invalid', insertedCount: 0 })
    for (const rawRecordId of [wrongUrl, wrongFormat, wrongParser, missingInlineBody, wrongDetectedAt, wrongByteCount]) {
      expect(service.persistScheduleEvidence(rawRecordId)).toMatchObject({ failureCode: 'evidence-invalid', insertedCount: 0 })
    }
    expect(service.persistScheduleEvidence(bls)).toEqual({ providerId: 'macro-calendar-bls', descriptorId: 'macro-calendar-bls-values', state: 'failed', failureCode: 'parser-unavailable', insertedCount: 0 })
    expect(service.persistScheduleEvidence(unknown.rawRecordId)).toEqual({ state: 'failed', failureCode: 'evidence-invalid', insertedCount: 0 })
    expect(writes).toEqual([])
  })

  it('preserves a verified schedule parser failure without a repository write', () => {
    const evidence = createTestEvidenceStore()
    const writes: unknown[] = []
    const repository = { appendIfNew: (revision: unknown) => { writes.push(revision); return { inserted: true, revision } } } as unknown as MacroCalendarRepository
    const record = appendScheduleEvidence(evidence, 'macro-calendar-fed-schedule', 'official capture missing expected meeting structure')

    expect(createMacroCalendarSchedulePersistenceService({ evidence, repository }).persistScheduleEvidence(record.rawRecordId)).toEqual({
      providerId: 'macro-calendar-fed', descriptorId: 'macro-calendar-fed-schedule', state: 'failed', failureCode: 'parser-output-empty', insertedCount: 0
    })
    expect(writes).toEqual([])
  })

  it('rejects a mismatched record id returned by the evidence boundary', () => {
    const source = createTestEvidenceStore()
    const record = appendScheduleEvidence(source, 'macro-calendar-fed-schedule', fixture('fed-fomc-schedule-2026-08-03.html'))
    const repository = { appendIfNew: () => { throw new Error('must not write') } } as unknown as MacroCalendarRepository
    const evidence = { getCalendarRecord: () => ({ ...source.getCalendarRecord(record.rawRecordId)!, rawRecordId: 'raw-other' }) }

    expect(createMacroCalendarSchedulePersistenceService({ evidence, repository }).persistScheduleEvidence(record.rawRecordId)).toEqual({
      providerId: 'macro-calendar-fed', descriptorId: 'macro-calendar-fed-schedule', state: 'failed', failureCode: 'evidence-invalid', insertedCount: 0
    })
  })

  it('redacts repository exceptions and reports a partial inserted count', () => {
    const evidence = createTestEvidenceStore()
    const record = appendScheduleEvidence(evidence, 'macro-calendar-fed-schedule', fixture('fed-fomc-schedule-2026-08-03.html'))
    let calls = 0
    const repository = {
      appendIfNew(revision: unknown) {
        calls += 1
        if (calls === 2) throw new Error('https://secret.example.test/?key=do-not-leak')
        return { inserted: true, revision }
      }
    } as unknown as MacroCalendarRepository
    const result = createMacroCalendarSchedulePersistenceService({ evidence, repository }).persistScheduleEvidence(record.rawRecordId)

    expect(result).toEqual({ providerId: 'macro-calendar-fed', descriptorId: 'macro-calendar-fed-schedule', state: 'failed', failureCode: 'repository-write-failed', insertedCount: 1 })
    expect(JSON.stringify(result)).not.toMatch(/https?:|secret|key/i)
  })
})

function appendScheduleEvidence(evidence: ReturnType<typeof createMacroCalendarEvidenceStore>, descriptorId: 'macro-calendar-fed-schedule' | 'macro-calendar-bea-schedule', body: string) {
  const descriptor = getMacroCalendarOfficialSourceDescriptor(descriptorId)!
  return evidence.append({
    descriptor, sourceUrl: descriptor.sourceUrl, detectedAt, body, payloadFormat: descriptor.payloadFormat,
    runId: 'schedule-run', parserVersion: descriptor.parserId, response: { status: 200, contentType: 'text/html' }
  })!
}

function seedMacroRecord(rawRecords: ReturnType<typeof createRawRecordStore>, descriptorId: 'macro-calendar-fed-schedule' | 'macro-calendar-bls-values', body: string, overrides: Record<string, unknown> = {}, suffix = ''): string {
  const descriptor = getMacroCalendarOfficialSourceDescriptor(descriptorId)!
  return rawRecords.appendRawRecord({
    sourceId: descriptor.descriptorId, runId: 'seed-run', sourceUrl: descriptor.sourceUrl, detectedAt,
    payloadFormat: descriptor.payloadFormat, payloadRefType: 'inline', payloadBody: body,
    payloadSizeBytes: Buffer.byteLength(body, 'utf8'), payloadHash: hash(body), sourceDedupeKey: `seed-${descriptorId}-${suffix}`,
    processingOwner: 'macro-calendar', parserVersion: descriptor.parserId, ...overrides
  } as Parameters<ReturnType<typeof createRawRecordStore>['appendRawRecord']>[0])!.rawRecordId
}

function hash(body: string): string {
  return createHash('sha256').update(body, 'utf8').digest('hex')
}

function createTestEvidenceStore(rawRecords = createRawRecordStore()) {
  const directory = mkdtempSync(join(tmpdir(), 'macro-calendar-persistence-evidence-'))
  testDirectories.push(directory)
  const store = createMacroCalendarEvidenceStore(createMacroCalendarEvidenceArchive({ rawRecords, archiveDirectory: directory }))
  return {
    ...store,
    append(input: Parameters<typeof store.append>[0]) {
      const reservation = store.reserve(Buffer.byteLength(input.body, 'utf8'))
      return reservation ? store.append(input, reservation) : undefined
    }
  }
}
