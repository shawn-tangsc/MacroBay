import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { createRawRecordStore } from '../application/rawRecordStore'
import {
  assertRawRecordSnapshotDoesNotShrink,
  createInMemoryRawRecordStorage,
  createRawRecordJsonStorage,
  RawRecordSnapshotShrinkError
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

describe('raw record snapshot write guard（写盘不得比读入少）', () => {
  it('refuses a write that would persist fewer records than were read, unless it is an explicit delete', () => {
    expect(() => assertRawRecordSnapshotDoesNotShrink({ loadedRecordCount: 3, nextRecordCount: 2 }))
      .toThrow(RawRecordSnapshotShrinkError)
    expect(() => assertRawRecordSnapshotDoesNotShrink({ loadedRecordCount: 3, nextRecordCount: 3 })).not.toThrow()
    expect(() => assertRawRecordSnapshotDoesNotShrink({ loadedRecordCount: 3, nextRecordCount: 4 })).not.toThrow()
    // 只有「显式删除」这一个字面理由能放行；布尔式的 true 不在类型里，写法本身就要说清是删除。
    expect(() => assertRawRecordSnapshotDoesNotShrink({ loadedRecordCount: 3, nextRecordCount: 0, allowRecordDecrease: 'explicit-delete' }))
      .not.toThrow()
  })

  it('stops a store whose loaded snapshot collapses (duplicate ids) from writing the smaller set', () => {
    // 读入 3 条、内存里因重复 id 只剩 2 条：这正是「读多少、写多少」被破坏的形状。
    const snapshot = {
      records: [
        { rawRecordId: 'raw-1', sourceId: 's1', sourceDedupeKey: 'k1', detectedAt: '2026-11-19T00:00:00.000Z' },
        { rawRecordId: 'raw-1', sourceId: 's1', sourceDedupeKey: 'k2', detectedAt: '2026-11-19T00:00:00.000Z' },
        { rawRecordId: 'raw-2', sourceId: 's1', sourceDedupeKey: 'k3', detectedAt: '2026-11-19T00:00:00.000Z' }
      ],
      sequence: 2
    } as never
    const writes: number[] = []
    const store = createRawRecordStore({
      snapshot,
      storage: {
        readAll: async () => snapshot,
        writeAll: async (next) => { writes.push(next.records.length) },
        writeAllSync: (next) => { writes.push(next.records.length) }
      }
    })

    expect(() => store.markParsed('raw-2')).toThrow(RawRecordSnapshotShrinkError)
    // 抛错之后一个字节都没写：坏形状不能被固化成磁盘上的事实。
    expect(writes).toEqual([])
  })

  it('keeps writing normally while the record count only grows', () => {
    const writes: number[] = []
    const store = createRawRecordStore({
      storage: {
        readAll: async () => ({ records: [], sequence: 0 }),
        writeAll: async (next) => { writes.push(next.records.length) },
        writeAllSync: (next) => { writes.push(next.records.length) }
      }
    })
    store.appendRawRecord({
      sourceId: 's1', payloadFormat: 'html', payloadRefType: 'inline', payloadBody: '<p>x</p>',
      payloadSizeBytes: 8, payloadHash: 'h', sourceDedupeKey: 'k1', detectedAt: '2026-11-19T00:00:00.000Z'
    } as never)
    store.appendRawRecord({
      sourceId: 's1', payloadFormat: 'html', payloadRefType: 'inline', payloadBody: '<p>y</p>',
      payloadSizeBytes: 8, payloadHash: 'h2', sourceDedupeKey: 'k2', detectedAt: '2026-11-19T00:00:00.000Z'
    } as never)
    expect(writes).toEqual([1, 2])
  })
})
