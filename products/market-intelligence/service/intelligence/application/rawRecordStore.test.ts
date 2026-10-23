import { describe, expect, it, vi } from 'vitest'

import { createRawRecordStore } from './rawRecordStore'

describe('rawRecordStore', () => {
  it('prevents duplicate raw records for the same source dedupe key', () => {
    const store = createRawRecordStore()
    const first = store.appendRawRecord(baseInput())
    const second = store.appendRawRecord(baseInput())

    expect(first).toBeTruthy()
    expect(second).toBeUndefined()
    expect(store.listSafeSummaries()).toHaveLength(1)
  })

  it('persists payload hash', () => {
    const store = createRawRecordStore()
    const record = store.appendRawRecord({ ...baseInput(), payloadHash: 'hash-123' })
    expect(record?.payloadHash).toBe('hash-123')
  })

  it('accepts inline and file payload refs', () => {
    const store = createRawRecordStore()
    const inline = store.appendRawRecord({
      ...baseInput(),
      sourceDedupeKey: 'inline-1',
      payloadRefType: 'inline',
      payloadBody: '{"id":1}'
    })
    const file = store.appendRawRecord({
      ...baseInput(),
      sourceDedupeKey: 'file-1',
      payloadRefType: 'file',
      payloadFileRef: 'payload-abc.bin'
    })

    expect(inline?.payloadRefType).toBe('inline')
    expect(file?.payloadFileRef).toBe('payload-abc.bin')
  })

  it('supports append-safe processing state transitions', () => {
    const store = createRawRecordStore()
    const record = store.appendRawRecord(baseInput())
    expect(record?.processingState).toBe('received')

    const parsed = store.markParsed(record!.rawRecordId)
    const normalized = store.markNormalized(record!.rawRecordId)

    expect(parsed?.processingState).toBe('parsed')
    expect(normalized?.processingState).toBe('normalized')
  })

  it('does not return raw payload bodies or local archive paths from safe list queries', () => {
    const store = createRawRecordStore()
    store.appendRawRecord({
      ...baseInput(),
      payloadBody: 'secret-payload-body',
      payloadFileRef: '/private/archive/secret.bin'
    })

    const summaries = store.listSafeSummaries()
    expect(summaries[0]).not.toHaveProperty('payloadBody')
    expect(summaries[0]).not.toHaveProperty('payloadFileRef')
    expect(JSON.stringify(summaries)).not.toContain('secret-payload-body')
    expect(JSON.stringify(summaries)).not.toContain('/private/archive/secret.bin')
  })

  it('marks ignored records as terminal and excludes them from unprocessed queue', () => {
    const store = createRawRecordStore()
    const record = store.appendRawRecord(baseInput())
    store.markParsed(record!.rawRecordId)
    const ignored = store.markIgnored(record!.rawRecordId, {
      ignoredReasonCode: 'scope-not-matched',
      classifierVersion: 'p0-core-v1',
      classifierNotes: 'unrelated-enforcement'
    })

    expect(ignored?.processingState).toBe('ignored')
    expect(ignored?.errorMessage).toBe('scope-not-matched')
    expect(store.listUnprocessed()).toHaveLength(0)
    expect(JSON.stringify(store.listSafeSummaries())).not.toContain('secret')
  })

  it('still dedupes ignored records by source dedupe key', () => {
    const store = createRawRecordStore()
    const first = store.appendRawRecord(baseInput())
    store.markIgnored(first!.rawRecordId, {
      ignoredReasonCode: 'noise-policy-filtered',
      classifierVersion: 'p0-core-v1'
    })
    const second = store.appendRawRecord(baseInput())
    expect(second).toBeUndefined()
  })

  it('defaults generic records, excludes macro records from the generic queue, and scopes internal reads by owner', () => {
    const store = createRawRecordStore({
      snapshot: {
        sequence: 1,
        records: [{
          ...baseInput(),
          rawRecordId: 'raw-1',
          detectedAt: '2026-08-01T00:00:00.000Z',
          processingState: 'received',
          storageTier: 'hot',
          archiveStatus: 'none'
        }]
      }
    })
    const generic = store.appendRawRecord({ ...baseInput(), sourceDedupeKey: 'generic-2' })
    const macro = store.appendRawRecord({
      ...baseInput(),
      sourceDedupeKey: 'macro-1',
      processingOwner: 'macro-calendar',
      payloadBody: 'macro-only-payload'
    })

    expect(store.getRawRecord('raw-1')?.processingOwner).toBe('generic-intelligence')
    expect(generic?.processingOwner).toBe('generic-intelligence')
    expect(store.listUnprocessed().map((record) => record.rawRecordId)).toEqual(['raw-1', generic?.rawRecordId])
    expect(store.listByProcessingOwner('macro-calendar', 10)).toEqual([macro])
    expect(store.listSafeSummaries().map((summary) => summary.rawRecordId)).toEqual(['raw-1', generic?.rawRecordId])
    expect(store.listSafeSummaries().map((summary) => summary.rawRecordId)).not.toContain(macro?.rawRecordId)
    expect(JSON.stringify(store.listSafeSummaries())).not.toContain('macro-only-payload')
  })

  it('inspects snapshot size without returning record bodies or archive paths', () => {
    const store = createRawRecordStore()
    store.appendRawRecord({
      ...baseInput(),
      processingOwner: 'macro-calendar',
      payloadBody: 'private-evidence-body',
      payloadFileRef: '/private/evidence.bin'
    })

    const inspection = store.inspectSnapshot()

    expect(inspection.recordCount).toBe(1)
    expect(inspection.serializedBytes).toBeGreaterThan(Buffer.byteLength('private-evidence-body'))
    expect(inspection.macroCalendarInlineBodyBytes).toBe(Buffer.byteLength('private-evidence-body'))
    expect(JSON.stringify(inspection)).not.toMatch(/private-evidence|\.bin/)
  })

  it('restores the previous payload reference when archive metadata persistence fails', () => {
    let failWrites = false
    const writeAllSync = vi.fn(() => {
      if (failWrites) throw new Error('storage unavailable')
    })
    const store = createRawRecordStore({
      storage: { readAll: async () => ({ records: [], sequence: 0 }), writeAll: async () => {}, writeAllSync }
    })
    const record = store.appendRawRecord({ ...baseInput(), payloadBody: 'only-copy' })!
    failWrites = true

    expect(() => store.updateArchiveRef(record.rawRecordId, {
      payloadRefType: 'file', payloadFileRef: 'hash.bin', payloadCodec: 'plain', payloadBody: undefined,
      archiveStatus: 'archived', storageTier: 'warm'
    })).toThrow('storage unavailable')
    expect(store.getRawRecord(record.rawRecordId)).toMatchObject({
      payloadRefType: 'inline', payloadBody: 'only-copy', archiveStatus: 'none', storageTier: 'hot'
    })
  })

  it('persists a batch of archive references once and rolls the whole batch back on failure', () => {
    let failWrites = false
    const writeAllSync = vi.fn(() => {
      if (failWrites) throw new Error('storage unavailable')
    })
    const store = createRawRecordStore({
      storage: { readAll: async () => ({ records: [], sequence: 0 }), writeAll: async () => {}, writeAllSync }
    })
    const first = store.appendRawRecord({ ...baseInput(), sourceDedupeKey: 'first', payloadBody: 'first-body' })!
    const second = store.appendRawRecord({ ...baseInput(), sourceDedupeKey: 'second', payloadBody: 'second-body' })!
    writeAllSync.mockClear()

    const patch = (payloadFileRef: string) => ({
      payloadRefType: 'file' as const, payloadFileRef, payloadCodec: 'plain', payloadBody: undefined,
      archiveStatus: 'archived' as const, storageTier: 'warm' as const
    })
    expect(store.updateArchiveRefs([
      { rawRecordId: first.rawRecordId, patch: patch('first.bin') },
      { rawRecordId: second.rawRecordId, patch: patch('second.bin') }
    ])).toHaveLength(2)
    expect(writeAllSync).toHaveBeenCalledOnce()

    failWrites = true
    expect(() => store.updateArchiveRefs([
      { rawRecordId: first.rawRecordId, patch: { ...patch('next-first.bin'), payloadBody: 'first-body' } },
      { rawRecordId: second.rawRecordId, patch: { ...patch('next-second.bin'), payloadBody: 'second-body' } }
    ])).toThrow('storage unavailable')
    expect(store.getRawRecord(first.rawRecordId)?.payloadFileRef).toBe('first.bin')
    expect(store.getRawRecord(second.rawRecordId)?.payloadFileRef).toBe('second.bin')
  })
})

function baseInput() {
  return {
    sourceId: 'coindesk-rss',
    runId: 'run-1',
    payloadFormat: 'rss-item' as const,
    payloadRefType: 'inline' as const,
    payloadHash: 'abc',
    sourceDedupeKey: 'guid-1',
    parserVersion: 'rss-v1'
  }
}
