import { createHash } from 'node:crypto'
import { mkdtemp, readdir, rm, truncate, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { createRawRecordStore } from '../application/rawRecordStore'
import {
  createMacroCalendarEvidenceArchive,
  macroCalendarEvidenceArchivePolicy
} from './macroCalendarEvidenceArchive'

const directories: string[] = []

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe('macro calendar evidence archive', () => {
  it('serializes committed plus active reservations against the fixed archive cap', async () => {
    const archive = await createArchive()
    const first = archive.reserve(macroCalendarEvidenceArchivePolicy.maximumArchiveBytes - 1)

    expect(first).toBeTruthy()
    expect(Object.isFrozen(first)).toBe(true)
    expect(archive.reserve(2)).toBeUndefined()
    expect(archive.inspect()).toEqual({
      committedBytes: 0,
      reservedBytes: macroCalendarEvidenceArchivePolicy.maximumArchiveBytes - 1,
      activeReservations: 1
    })

    expect(archive.release(first!)).toBe(true)
    expect(archive.release(first!)).toBe(false)
    expect(archive.reserve(macroCalendarEvidenceArchivePolicy.maximumArchiveBytes)).toBeTruthy()
  })

  it('denies new evidence when the raw-record metadata snapshot exceeds its fixed budget', async () => {
    const rawRecords = createRawRecordStore()
    vi.spyOn(rawRecords, 'inspectSnapshot').mockReturnValue({
      recordCount: 1,
      serializedBytes: macroCalendarEvidenceArchivePolicy.maximumMetadataBytes + 1,
      macroCalendarInlineBodyBytes: 0
    })
    const archive = await createArchive(rawRecords)

    expect(archive.reserve(1)).toBeUndefined()
    expect(archive.inspect()).toMatchObject({ activeReservations: 0, reservedBytes: 0 })
  })

  it('reserves fixed metadata headroom for every concurrent evidence admission', async () => {
    const rawRecords = createRawRecordStore()
    vi.spyOn(rawRecords, 'inspectSnapshot').mockReturnValue({
      recordCount: 1,
      serializedBytes: macroCalendarEvidenceArchivePolicy.maximumMetadataBytes -
        macroCalendarEvidenceArchivePolicy.maximumRecordMetadataBytes - 1,
      macroCalendarInlineBodyBytes: 0
    })
    const archive = await createArchive(rawRecords)
    const first = archive.reserve(1)

    expect(first).toBeTruthy()
    expect(archive.reserve(1)).toBeUndefined()
    expect(archive.release(first!)).toBe(true)
    expect(archive.reserve(1)).toBeTruthy()
  })

  it('rechecks metadata headroom before append and fails closed when inspection is unavailable', async () => {
    const rawRecords = createRawRecordStore()
    const inspect = vi.spyOn(rawRecords, 'inspectSnapshot')
      .mockReturnValueOnce({ recordCount: 0, serializedBytes: 0, macroCalendarInlineBodyBytes: 0 })
      .mockReturnValue({
        recordCount: 1,
        serializedBytes: macroCalendarEvidenceArchivePolicy.maximumMetadataBytes,
        macroCalendarInlineBodyBytes: 0
      })
    const archive = await createArchive(rawRecords)
    const reservation = archive.reserve(100)!

    expect(archive.append(reservation, input('{"late":true}'))).toBeUndefined()
    expect(archive.inspect()).toEqual({ committedBytes: 0, reservedBytes: 0, activeReservations: 0 })

    inspect.mockImplementation(() => { throw new Error('metadata unavailable') })
    expect(archive.reserve(1)).toBeUndefined()
  })

  it('settles a reservation to actual archived bytes and stores no inline body', async () => {
    const rawRecords = createRawRecordStore()
    const archive = await createArchive(rawRecords)
    const body = '{"status":"REQUEST_SUCCEEDED"}'
    const reservation = archive.reserve(1_500_000)!

    const result = archive.append(reservation, input(body))

    expect(result).toMatchObject({ inserted: true, deduped: false })
    expect(result?.record).toMatchObject({
      payloadRefType: 'file',
      payloadBody: undefined,
      payloadSizeBytes: Buffer.byteLength(body),
      processingOwner: 'macro-calendar',
      archiveStatus: 'archived',
      storageTier: 'warm'
    })
    expect(result?.record.payloadFileRef).toMatch(/^[a-f0-9]{64}\.bin$/)
    expect(archive.readBody(result!.record)).toBe(body)
    expect(archive.inspect()).toEqual({
      committedBytes: Buffer.byteLength(body),
      reservedBytes: 0,
      activeReservations: 0
    })
  })

  it('dedupes the same source body and releases the unused reservation', async () => {
    const archive = await createArchive()
    const body = '{"same":true}'
    const first = archive.append(archive.reserve(100)!, input(body))
    const second = archive.append(archive.reserve(100)!, input(body))

    expect(first?.inserted).toBe(true)
    expect(second).toMatchObject({ inserted: false, deduped: true })
    expect(second?.record.rawRecordId).toBe(first?.record.rawRecordId)
    expect(archive.inspect()).toEqual({
      committedBytes: Buffer.byteLength(body),
      reservedBytes: 0,
      activeReservations: 0
    })
  })

  it('rejects forged, stale, undersized, and mismatched append attempts without writing', async () => {
    const rawRecords = createRawRecordStore()
    const archive = await createArchive(rawRecords)
    const body = '{"value":1}'
    const stale = archive.reserve(100)!
    expect(archive.release(stale)).toBe(true)

    expect(archive.append(stale, input(body))).toBeUndefined()
    expect(archive.append(Object.freeze({}) as never, input(body))).toBeUndefined()
    expect(archive.append(archive.reserve(1)!, input(body))).toBeUndefined()
    expect(archive.append(archive.reserve(100)!, { ...input(body), payloadHash: 'wrong' })).toBeUndefined()
    expect(archive.append(archive.reserve(100)!, {
      ...input(body), runId: 'x'.repeat(macroCalendarEvidenceArchivePolicy.maximumRecordMetadataBytes)
    })).toBeUndefined()
    expect(rawRecords.listByProcessingOwner('macro-calendar', 10)).toEqual([])
    expect(archive.inspect()).toEqual({ committedBytes: 0, reservedBytes: 0, activeReservations: 0 })
  })

  it('accounts for a verified archive file when metadata append does not commit', async () => {
    const rawRecords = createRawRecordStore()
    vi.spyOn(rawRecords, 'appendRawRecord').mockReturnValue(undefined)
    const archive = await createArchive(rawRecords)
    const body = '{"orphaned":true}'

    expect(archive.append(archive.reserve(100)!, input(body))).toBeUndefined()
    expect(archive.inspect()).toEqual({
      committedBytes: Buffer.byteLength(body),
      reservedBytes: 0,
      activeReservations: 0
    })
  })

  it('migrates inline calendar bodies idempotently and keeps them readable after restart', async () => {
    const rawRecords = createRawRecordStore()
    const body = '<html>official schedule</html>'
    const record = rawRecords.appendRawRecord({
      ...input(body),
      payloadRefType: 'inline',
      processingOwner: 'macro-calendar'
    })!
    const archive = await createArchive(rawRecords)

    expect(archive.migrateInlineBodies()).toEqual({ state: 'migrated', migratedCount: 1, dedupedCount: 0 })
    expect(rawRecords.getRawRecord(record.rawRecordId)).toMatchObject({
      payloadRefType: 'file', payloadBody: undefined, payloadFileRef: `${record.payloadHash}.bin`
    })
    expect(archive.readBody(rawRecords.getRawRecord(record.rawRecordId)!)).toBe(body)

    const restarted = createMacroCalendarEvidenceArchive({
      rawRecords,
      archiveDirectory: directories.at(-1)!
    })
    expect(restarted.migrateInlineBodies()).toEqual({ state: 'unchanged', migratedCount: 0, dedupedCount: 0 })
    expect(restarted.readBody(rawRecords.getRawRecord(record.rawRecordId)!)).toBe(body)
  })

  it('does not partially migrate when a later inline body has a mismatched archive file', async () => {
    const rawRecords = createRawRecordStore()
    const recoveredBody = '{"recover":true}'
    const retainedBody = '{"retain":true}'
    const recovered = rawRecords.appendRawRecord({ ...input(recoveredBody), payloadRefType: 'inline', processingOwner: 'macro-calendar' })!
    const retained = rawRecords.appendRawRecord({ ...input(retainedBody), sourceDedupeKey: 'retained', payloadRefType: 'inline', processingOwner: 'macro-calendar' })!
    const directory = await mkdtemp(join(tmpdir(), 'macro-calendar-evidence-'))
    directories.push(directory)
    await writeFile(join(directory, `${recovered.payloadHash}.bin`), recoveredBody, 'utf8')
    await writeFile(join(directory, `${retained.payloadHash}.bin`), 'mismatched-body', 'utf8')
    const archive = createMacroCalendarEvidenceArchive({ rawRecords, archiveDirectory: directory })
    const updateArchiveRefs = vi.spyOn(rawRecords, 'updateArchiveRefs')

    expect(archive.migrateInlineBodies()).toEqual({ state: 'unavailable', migratedCount: 0, dedupedCount: 0 })
    expect(rawRecords.getRawRecord(recovered.rawRecordId)?.payloadBody).toBe(recoveredBody)
    expect(rawRecords.getRawRecord(retained.rawRecordId)?.payloadBody).toBe(retainedBody)
    expect(updateArchiveRefs).not.toHaveBeenCalled()
  })

  it('removes newly written archive files when migration cannot replace inline metadata', async () => {
    const rawRecords = createRawRecordStore()
    const body = '{"migration":"interrupted"}'
    rawRecords.appendRawRecord({ ...input(body), payloadRefType: 'inline', processingOwner: 'macro-calendar' })
    vi.spyOn(rawRecords, 'updateArchiveRefs').mockImplementation(() => { throw new Error('metadata unavailable') })
    const archive = await createArchive(rawRecords)

    expect(archive.migrateInlineBodies()).toMatchObject({ state: 'unavailable' })
    expect(archive.inspect().committedBytes).toBe(Buffer.byteLength(body))
    expect(await readdir(directories.at(-1)!)).toEqual([])
  })

  it('leaves an inline body untouched when migration would exceed the archive cap', async () => {
    const rawRecords = createRawRecordStore()
    const body = '{"migration":"near-cap"}'
    const record = rawRecords.appendRawRecord({ ...input(body), payloadRefType: 'inline', processingOwner: 'macro-calendar' })!
    const directory = await mkdtemp(join(tmpdir(), 'macro-calendar-evidence-'))
    directories.push(directory)
    const occupiedFile = join(directory, `${'a'.repeat(64)}.bin`)
    await writeFile(occupiedFile, 'x', 'utf8')
    await truncate(occupiedFile, macroCalendarEvidenceArchivePolicy.maximumArchiveBytes - Buffer.byteLength(body))
    const updateArchiveRefs = vi.spyOn(rawRecords, 'updateArchiveRefs')
    const archive = createMacroCalendarEvidenceArchive({ rawRecords, archiveDirectory: directory })

    expect(archive.migrateInlineBodies()).toEqual({ state: 'unavailable', migratedCount: 0, dedupedCount: 0 })
    expect(rawRecords.getRawRecord(record.rawRecordId)?.payloadBody).toBe(body)
    expect(updateArchiveRefs).not.toHaveBeenCalled()
    expect(await readdir(directory)).toEqual([`${'a'.repeat(64)}.bin`])
    expect(archive.inspect()).toMatchObject({
      committedBytes: macroCalendarEvidenceArchivePolicy.maximumArchiveBytes,
      reservedBytes: 0
    })
  })

  it('rolls back the whole migration batch when a later body exceeds the archive cap', async () => {
    const rawRecords = createRawRecordStore()
    const firstBody = '{"migration":"first"}'
    const secondBody = '{"migration":"second"}'
    const first = rawRecords.appendRawRecord({ ...input(firstBody), payloadRefType: 'inline', processingOwner: 'macro-calendar' })!
    const second = rawRecords.appendRawRecord({ ...input(secondBody), sourceDedupeKey: 'second', payloadRefType: 'inline', processingOwner: 'macro-calendar' })!
    const directory = await mkdtemp(join(tmpdir(), 'macro-calendar-evidence-'))
    directories.push(directory)
    const occupiedFile = join(directory, `${'a'.repeat(64)}.bin`)
    const firstBytes = Buffer.byteLength(firstBody)
    const secondBytes = Buffer.byteLength(secondBody)
    await writeFile(occupiedFile, 'x', 'utf8')
    await truncate(occupiedFile, macroCalendarEvidenceArchivePolicy.maximumArchiveBytes - (2 * firstBytes) - secondBytes)
    const updateArchiveRefs = vi.spyOn(rawRecords, 'updateArchiveRefs')
    const archive = createMacroCalendarEvidenceArchive({ rawRecords, archiveDirectory: directory })

    expect(archive.migrateInlineBodies()).toEqual({ state: 'unavailable', migratedCount: 0, dedupedCount: 0 })
    expect(rawRecords.getRawRecord(first.rawRecordId)?.payloadBody).toBe(firstBody)
    expect(rawRecords.getRawRecord(second.rawRecordId)?.payloadBody).toBe(secondBody)
    expect(updateArchiveRefs).not.toHaveBeenCalled()
    expect(await readdir(directory)).toEqual([`${'a'.repeat(64)}.bin`])
  })

  it('migrates multiple verified inline records with one metadata snapshot rewrite', async () => {
    const bodies = Array.from({ length: 120 }, (_, index) => JSON.stringify({
      year: 2020 + Math.floor(index / 12),
      month: (index % 12) + 1
    }))
    const records = bodies.map((body, index) => ({
      ...input(body), rawRecordId: `raw-${index + 1}`, sourceDedupeKey: `year-${index + 1}`,
      payloadRefType: 'inline' as const, processingOwner: 'macro-calendar' as const,
      processingState: 'received' as const, storageTier: 'hot' as const, archiveStatus: 'none' as const
    }))
    const writeAllSync = vi.fn()
    const rawRecords = createRawRecordStore({
      snapshot: { records, sequence: records.length },
      storage: { readAll: async () => ({ records: [], sequence: 0 }), writeAll: async () => {}, writeAllSync }
    })
    const archive = await createArchive(rawRecords)

    expect(archive.migrateInlineBodies()).toEqual({ state: 'migrated', migratedCount: 120, dedupedCount: 0 })
    expect(writeAllSync).toHaveBeenCalledOnce()
    expect(rawRecords.inspectSnapshot().serializedBytes).toBeLessThan(macroCalendarEvidenceArchivePolicy.maximumMetadataBytes)
    expect(records.map((record) => archive.readBody(rawRecords.getRawRecord(record.rawRecordId)!))).toEqual(bodies)
  })
})

async function createArchive(rawRecords = createRawRecordStore()) {
  const directory = await mkdtemp(join(tmpdir(), 'macro-calendar-evidence-'))
  directories.push(directory)
  return createMacroCalendarEvidenceArchive({ rawRecords, archiveDirectory: directory })
}

function input(body: string) {
  const payloadHash = createHash('sha256').update(body, 'utf8').digest('hex')
  return {
    sourceId: 'macro-calendar-bls-test',
    runId: 'run-1',
    sourceUrl: 'https://example.invalid/fixed',
    detectedAt: '2026-08-12T00:00:00.000Z',
    payloadFormat: 'json' as const,
    payloadBody: body,
    payloadSizeBytes: Buffer.byteLength(body),
    payloadHash,
    payloadMetaJson: '{"kind":"test"}',
    sourceDedupeKey: payloadHash,
    parserVersion: 'test-v1'
  }
}
