import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, describe, expect, it } from 'vitest'

import { createRawRecordStore } from '../application/rawRecordStore'
import { getMacroCalendarOfficialSourceDescriptor, zeroXRouterCalendarEvidenceDescriptors } from './macroCalendarOfficialSourceRegistry'
import { createMacroCalendarEvidenceStore } from './macroCalendarEvidenceStore'
import { createMacroCalendarEvidenceArchive } from './macroCalendarEvidenceArchive'

const testDirectories: string[] = []
afterAll(() => testDirectories.forEach((directory) => rmSync(directory, { recursive: true, force: true })))

const statement = getMacroCalendarOfficialSourceDescriptor('macro-calendar-fed-statement')!
const schedule = getMacroCalendarOfficialSourceDescriptor('macro-calendar-fed-schedule')!
const manualBlsIcs = getMacroCalendarOfficialSourceDescriptor('macro-calendar-bls-ics-manual')!
const zeroXRouterEconomic = zeroXRouterCalendarEvidenceDescriptors[0]!

function input(overrides: Record<string, unknown> = {}) {
  return {
    descriptor: statement,
    sourceUrl: statement.sourceUrl,
    detectedAt: '2026-08-03T13:54:17.000Z',
    body: 'FOMC caf\u00e9',
    payloadFormat: 'text' as const,
    runId: 'macro-run-1',
    parserVersion: 'fed-fomc-statement-v1',
    response: { status: 200, contentType: 'application/rss+xml' },
    ...overrides
  }
}

describe('macroCalendarEvidenceStore', () => {
  it('admits only the fixed 0xRouter evidence descriptor identity into the product archive', () => {
    const evidence = createTestEvidenceStore()
    const accepted = evidence.append(input({
      descriptor: zeroXRouterEconomic,
      sourceUrl: zeroXRouterEconomic.sourceUrl,
      payloadFormat: 'json',
      parserVersion: zeroXRouterEconomic.parserId,
      body: '{"code":200,"data":[]}'
    }))
    const forged = evidence.append(input({
      descriptor: { ...zeroXRouterEconomic, sourceUrl: 'https://example.test/forged' },
      sourceUrl: 'https://example.test/forged',
      payloadFormat: 'json',
      parserVersion: zeroXRouterEconomic.parserId,
      body: '{"code":200,"data":[]}'
    }))

    expect(accepted).toMatchObject({ descriptorId: zeroXRouterEconomic.descriptorId, providerId: 'macro-calendar-0xrouter' })
    expect(forged).toBeUndefined()
  })

  it('owns macro raw identity and computes exact UTF-8 evidence metadata', () => {
    const rawRecords = createRawRecordStore()
    const evidence = createTestEvidenceStore(rawRecords)
    const body = 'FOMC caf\u00e9'

    const appended = evidence.append(input({ body }))
    const record = rawRecords.getRawRecord(appended!.rawRecordId)!

    expect(appended).toMatchObject({ providerId: 'macro-calendar-fed', descriptorId: statement.descriptorId, sourceUrl: statement.sourceUrl, detectedAt: '2026-08-03T13:54:17.000Z', parserVersion: 'fed-fomc-statement-v1', inserted: true, deduped: false })
    expect(record).toMatchObject({ processingOwner: 'macro-calendar', sourceId: statement.descriptorId, sourceUrl: statement.sourceUrl, payloadRefType: 'file', payloadBody: undefined, payloadSizeBytes: Buffer.byteLength(body, 'utf8'), payloadHash: createHash('sha256').update(body, 'utf8').digest('hex') })
    expect(evidence.readBody(record)).toBe(body)
    expect(rawRecords.listUnprocessed()).toEqual([])
    expect(rawRecords.listSafeSummaries()).toEqual([])
  })

  it('dedupes a descriptor and payload but keeps the same body under another descriptor independent', () => {
    const evidence = createTestEvidenceStore()
    const first = evidence.append(input())!
    const duplicate = evidence.append(input({ detectedAt: '2026-08-04T00:00:00.000Z' }))!
    const independent = evidence.append(input({ descriptor: schedule, sourceUrl: schedule.sourceUrl, payloadFormat: 'html' }))!

    expect(duplicate).toMatchObject({ rawRecordId: first.rawRecordId, inserted: false, deduped: true, evidenceHash: first.evidenceHash })
    expect(independent.rawRecordId).not.toBe(first.rawRecordId)
    expect(independent.descriptorId).toBe(schedule.descriptorId)
  })

  it('dedupes unchanged evidence across parser versions without replacing stored provenance', () => {
    const rawRecords = createRawRecordStore()
    const evidence = createTestEvidenceStore(rawRecords)
    const first = evidence.append(input({ parserVersion: 'fed-fomc-statement-v1' }))!
    const upgraded = evidence.append(input({ parserVersion: 'fed-fomc-statement-v2' }))

    expect(upgraded).toMatchObject({
      rawRecordId: first.rawRecordId,
      parserVersion: 'fed-fomc-statement-v2',
      inserted: false,
      deduped: true
    })
    expect(rawRecords.getRawRecord(first.rawRecordId)?.parserVersion).toBe('fed-fomc-statement-v1')
    expect(evidence.listCalendarRecords()).toHaveLength(1)
  })

  it('appends manual BLS ICS with product-owned provenance and exact byte metadata', () => {
    const rawRecords = createRawRecordStore()
    const evidence = createTestEvidenceStore(rawRecords)
    const body = 'BEGIN:VCALENDAR\r\nSUMMARY:BLS\r\nEND:VCALENDAR\r\n'

    const appended = evidence.appendManualBlsIcs({
      body, detectedAt: '2026-08-03T13:54:17.000Z', runId: 'manual-run-1'
    })
    const record = appended && rawRecords.getRawRecord(appended.rawRecordId)

    expect(appended).toMatchObject({
      providerId: 'macro-calendar-bls', descriptorId: manualBlsIcs.descriptorId,
      sourceUrl: manualBlsIcs.sourceUrl, parserVersion: manualBlsIcs.parserId,
      inserted: true, deduped: false
    })
    expect(record).toMatchObject({
      processingOwner: 'macro-calendar', sourceId: manualBlsIcs.descriptorId,
      sourceUrl: manualBlsIcs.sourceUrl, payloadFormat: 'text', payloadRefType: 'file',
      payloadBody: undefined, payloadSizeBytes: Buffer.byteLength(body, 'utf8'),
      payloadHash: createHash('sha256').update(body, 'utf8').digest('hex'),
      payloadMetaJson: '{"provenance":"manual-ics-upload","calendar":"bls-release-schedule"}',
      runId: 'manual-run-1', parserVersion: manualBlsIcs.parserId
    })
    expect(evidence.readBody(record!)).toBe(body)
  })

  it('dedupes identical manual BLS ICS without replacing the stored body', () => {
    const rawRecords = createRawRecordStore()
    const evidence = createTestEvidenceStore(rawRecords)
    const first = evidence.appendManualBlsIcs({ body: 'same-body', detectedAt: '2026-08-03T00:00:00.000Z', runId: 'run-1' })!
    const second = evidence.appendManualBlsIcs({ body: 'same-body', detectedAt: '2026-08-04T00:00:00.000Z', runId: 'run-2' })!

    expect(second).toMatchObject({ rawRecordId: first.rawRecordId, inserted: false, deduped: true, parserVersion: manualBlsIcs.parserId })
    expect(rawRecords.getRawRecord(first.rawRecordId)).toMatchObject({ detectedAt: '2026-08-03T00:00:00.000Z', runId: 'run-1' })
  })

  it('does not accept the manual descriptor through the HTTP evidence append contract', () => {
    const evidence = createTestEvidenceStore()

    expect(evidence.append(input({
      descriptor: manualBlsIcs, sourceUrl: manualBlsIcs.sourceUrl, payloadFormat: 'text',
      parserVersion: manualBlsIcs.parserId
    }))).toBeUndefined()
  })

  it('fails closed when a generic record collides with the macro dedupe key', () => {
    const rawRecords = createRawRecordStore()
    const validInput = input()
    const evidenceHash = createHash('sha256').update(validInput.body, 'utf8').digest('hex')
    const sourceDedupeKey = createHash('sha256').update(`${statement.descriptorId}\n${evidenceHash}`, 'utf8').digest('hex')
    const generic = rawRecords.appendRawRecord({
      sourceId: statement.descriptorId,
      runId: 'generic-run',
      sourceUrl: 'https://example.test/not-fed',
      detectedAt: validInput.detectedAt,
      payloadFormat: 'text',
      payloadRefType: 'inline',
      payloadBody: 'wrong-body',
      payloadSizeBytes: 10,
      payloadHash: 'wrong-hash',
      sourceDedupeKey,
      parserVersion: 'wrong-parser'
    })

    const evidence = createTestEvidenceStore(rawRecords)
    expect(evidence.append(validInput)).toBeUndefined()
    expect(rawRecords.getRawRecord(generic!.rawRecordId)?.processingOwner).toBe('generic-intelligence')
    expect(rawRecords.listSafeSummaries().map((summary) => summary.rawRecordId)).toEqual([generic!.rawRecordId])
    expect(evidence.listCalendarRecords()).toEqual([])
  })

  it('fails closed when a macro-owned record collides with mismatched evidence', () => {
    const rawRecords = createRawRecordStore()
    const validInput = input()
    const evidenceHash = createHash('sha256').update(validInput.body, 'utf8').digest('hex')
    const sourceDedupeKey = createHash('sha256').update(`${statement.descriptorId}\n${evidenceHash}`, 'utf8').digest('hex')
    const conflicting = rawRecords.appendRawRecord({
      sourceId: statement.descriptorId,
      runId: 'macro-run-conflict',
      sourceUrl: statement.sourceUrl,
      detectedAt: validInput.detectedAt,
      payloadFormat: 'text',
      payloadRefType: 'inline',
      payloadBody: 'wrong-body',
      payloadSizeBytes: 10,
      payloadHash: 'wrong-hash',
      sourceDedupeKey,
      processingOwner: 'macro-calendar',
      parserVersion: 'wrong-parser'
    })

    const evidence = createTestEvidenceStore(rawRecords)
    expect(evidence.append(validInput)).toBeUndefined()
    expect(evidence.listCalendarRecords()).toEqual([conflicting])
  })

  it('returns bounded calendar owner records in detectedAt then raw-record-id order', () => {
    const evidence = createTestEvidenceStore()
    const later = evidence.append(input({ body: 'later', detectedAt: '2026-08-04T00:00:00.000Z' }))!
    const earlier = evidence.append(input({ body: 'earlier', detectedAt: '2026-08-03T00:00:00.000Z' }))!
    evidence.append(input({ body: 'latest', detectedAt: '2026-08-05T00:00:00.000Z' }))

    expect(evidence.listCalendarRecords(2).map((record) => record.rawRecordId)).toEqual([earlier.rawRecordId, later.rawRecordId])
  })

  it('reads a full raw record only through the macro-calendar owner boundary', () => {
    const rawRecords = createRawRecordStore()
    const evidence = createTestEvidenceStore(rawRecords)
    const macro = evidence.append(input())!
    const generic = rawRecords.appendRawRecord({
      sourceId: 'generic-source', runId: 'generic-run', payloadFormat: 'text', payloadRefType: 'inline',
      payloadBody: 'generic body', payloadHash: 'generic-hash', sourceDedupeKey: 'generic-dedupe', parserVersion: 'generic-v1'
    })!

    expect(evidence.readBody(evidence.getCalendarRecord(macro.rawRecordId)!)).toBe(input().body)
    expect(evidence.getCalendarRecord(generic.rawRecordId)).toBeUndefined()
  })

  it.each([
    input({ detectedAt: '2026-08-03T13:54:17Z' }),
    input({ sourceUrl: 'https://example.test/feed.xml' }),
    input({ payloadFormat: 'json' }),
    input({ body: '' }),
    input({ runId: '   ' }),
    input({ parserVersion: '\t' }),
    input({ response: { status: 200, contentType: '  ' } }),
    input({ descriptor: { ...statement, eventFamilies: 'not-array' } as unknown as typeof statement })
  ])('rejects invalid evidence input before append', (invalid) => {
    const rawRecords = createRawRecordStore()
    const evidence = createTestEvidenceStore(rawRecords)

    expect(evidence.append(invalid)).toBeUndefined()
    expect(rawRecords.listByProcessingOwner('macro-calendar')).toEqual([])
  })
})

function createTestEvidenceStore(rawRecords = createRawRecordStore()) {
  const directory = mkdtempSync(join(tmpdir(), 'macro-calendar-evidence-store-'))
  testDirectories.push(directory)
  const store = createMacroCalendarEvidenceStore(createMacroCalendarEvidenceArchive({ rawRecords, archiveDirectory: directory }))
  return {
    ...store,
    append(input: Parameters<typeof store.append>[0]) {
      const body = typeof input?.body === 'string' ? input.body : 'x'
      const reservation = store.reserve(Math.max(1, Buffer.byteLength(body, 'utf8')))
      return reservation ? store.append(input, reservation) : undefined
    },
    appendManualBlsIcs(input: Parameters<typeof store.appendManualBlsIcs>[0]) {
      const body = typeof input?.body === 'string' ? input.body : 'x'
      const reservation = store.reserve(Math.max(1, Buffer.byteLength(body, 'utf8')))
      return reservation ? store.appendManualBlsIcs(input, reservation) : undefined
    }
  }
}
