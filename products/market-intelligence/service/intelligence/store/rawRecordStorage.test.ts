import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { createRawRecordStore } from '../application/rawRecordStore'
import {
  createInMemoryRawRecordStorage,
  createRawRecordJsonStorage
} from './rawRecordStorage'

describe('rawRecordStorage', () => {
  it('persists raw records across reloads', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'intelligence-raw-records-'))
    const filePath = join(dir, 'intelligence-raw-records.json')

    try {
      const storage = createRawRecordJsonStorage(filePath)
      const store = createRawRecordStore({ storage })
      const record = store.appendRawRecord(baseInput())
      store.markParsed(record!.rawRecordId)

      const reloaded = createRawRecordStore({
        storage,
        snapshot: await storage.readAll()
      })

      expect(reloaded.listSafeSummaries()).toHaveLength(1)
      expect(reloaded.getRawRecord(record!.rawRecordId)?.processingState).toBe('parsed')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('keeps in-memory storage isolated for tests', async () => {
    const storage = createInMemoryRawRecordStorage()
    const store = createRawRecordStore({ storage })
    store.appendRawRecord(baseInput())

    expect((await storage.readAll()).records).toHaveLength(1)
  })

  it('normalizes legacy JSON records without a processing owner to generic intelligence', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'intelligence-raw-records-'))
    const filePath = join(dir, 'intelligence-raw-records.json')
    try {
      await writeFile(filePath, JSON.stringify({ sequence: 1, records: [{ ...baseInput(), rawRecordId: 'raw-1', detectedAt: '2026-08-01T00:00:00.000Z', processingState: 'received', storageTier: 'hot', archiveStatus: 'none' }] }), 'utf8')
      const snapshot = await createRawRecordJsonStorage(filePath).readAll()
      expect(snapshot.records[0]?.processingOwner).toBe('generic-intelligence')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
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
