import { describe, expect, it } from 'vitest'

import { createRawRecordStore } from './rawRecordStore'
import type { RawIntelligenceRecord } from '../schema/intelligenceRecord'

/**
 * 0.4.5 缺陷③：原文与元数据只增不减。
 *
 * 判据：按天轮转**只删通用记录**（日历不跟着动）、删掉的记录其原文文件一起回收、
 * **被别的记录引用的原文不许删**（内容寻址会去重）、同一天跑第二遍 `0` 且不再写盘。
 */
function record(input: Readonly<{ id: string; detectedAt: string; owner?: 'generic-intelligence' | 'macro-calendar'; fileRef?: string }>): RawIntelligenceRecord {
  return {
    rawRecordId: input.id,
    sourceId: 'binance-announcements',
    runId: `run-${input.id}`,
    detectedAt: input.detectedAt,
    payloadFormat: 'html',
    payloadRefType: input.fileRef === undefined ? 'inline' : 'file',
    ...(input.fileRef === undefined ? { payloadBody: '<p>x</p>' } : { payloadFileRef: input.fileRef }),
    payloadHash: `hash-${input.id}`,
    payloadSizeBytes: 8,
    sourceDedupeKey: `dedupe-${input.id}`,
    processingOwner: input.owner ?? 'generic-intelligence',
    processingState: 'received',
    parserVersion: 'v1',
    storageTier: 'hot',
    archiveStatus: 'none'
  } as RawIntelligenceRecord
}

function harness(records: RawIntelligenceRecord[], files: Record<string, number> = {}) {
  const writes: number[] = []
  const deleted: string[] = []
  const store = createRawRecordStore({
    snapshot: { records, sequence: records.length },
    storage: {
      readAll: async () => ({ records, sequence: records.length }),
      writeAll: async (next) => { writes.push(next.records.length) },
      writeAllSync: (next) => { writes.push(next.records.length) }
    },
    deletePayload: (fileRef) => {
      const bytes = files[fileRef]
      if (bytes === undefined) return undefined
      deleted.push(fileRef)
      // 真实文件删掉之后就列不出来了：夹具也要跟着消失，否则第二遍会重复报释放字节。
      delete files[fileRef]
      return bytes
    },
    listPayloadFiles: () => Object.keys(files)
  })
  return { store, writes, deleted }
}

const NOW = '2026-11-21T00:00:00.000Z'

describe('原始记录保留期', () => {
  it('drops generic records past the cutoff with their payload files, and leaves calendar records alone', () => {
    const { store, writes, deleted } = harness(
      [
        record({ id: 'raw-old', detectedAt: '2026-11-01T00:00:00.000Z', fileRef: 'a'.repeat(64) + '.bin' }),
        record({ id: 'raw-fresh', detectedAt: '2026-11-20T00:00:00.000Z', fileRef: 'b'.repeat(64) + '.bin' }),
        record({ id: 'raw-cal', detectedAt: '2026-11-01T00:00:00.000Z', owner: 'macro-calendar', fileRef: 'c'.repeat(64) + '.bin' })
      ],
      { ['a'.repeat(64) + '.bin']: 100, ['b'.repeat(64) + '.bin']: 200, ['c'.repeat(64) + '.bin']: 300 }
    )

    const result = store.pruneRawRecords({ retentionDays: 7, now: NOW })
    expect(result).toMatchObject({ removedRecords: 1, removedPayloadFiles: 1, reclaimedPayloadBytes: 100, remainingRecords: 2 })
    expect(deleted).toEqual(['a'.repeat(64) + '.bin'])
    // 删除是显式删除，写盘闸放行；日历那条仍在。
    expect(writes).toEqual([2])
    expect(store.getRawRecord('raw-cal')).toBeDefined()
    expect(store.getRawRecord('raw-old')).toBeUndefined()
  })

  it('never deletes a payload file another record still references', () => {
    const shared = 'd'.repeat(64) + '.bin'
    const { store, deleted } = harness(
      [
        record({ id: 'raw-old', detectedAt: '2026-11-01T00:00:00.000Z', fileRef: shared }),
        record({ id: 'raw-fresh', detectedAt: '2026-11-20T00:00:00.000Z', fileRef: shared })
      ],
      { [shared]: 50 }
    )

    const result = store.pruneRawRecords({ retentionDays: 7, now: NOW })
    expect(result.removedRecords).toBe(1)
    // 内容寻址会去重：另一个活着的记录还在用它，删了就是「有记录无原文」。
    expect(result.removedPayloadFiles).toBe(0)
    expect(deleted).toEqual([])
  })

  it('is idempotent: the second pass removes nothing and writes nothing; orphans can be reclaimed on request', () => {
    const live = 'e'.repeat(64) + '.bin'
    const orphan = 'f'.repeat(64) + '.bin'
    const { store, writes, deleted } = harness(
      [record({ id: 'raw-fresh', detectedAt: '2026-11-20T00:00:00.000Z', fileRef: live })],
      { [live]: 10, [orphan]: 40 }
    )

    const first = store.pruneRawRecords({ retentionDays: 7, now: NOW, includeOrphans: true })
    expect(first).toMatchObject({ removedRecords: 0, removedOrphanFiles: 1, reclaimedPayloadBytes: 40 })
    expect(deleted).toEqual([orphan])
    // 没有删记录 → 不写盘（避免每天做一次无意义的整份写回）。
    expect(writes).toEqual([])

    const second = store.pruneRawRecords({ retentionDays: 7, now: NOW, includeOrphans: true })
    expect(second).toMatchObject({ removedRecords: 0, removedOrphanFiles: 0, reclaimedPayloadBytes: 0 })
  })
})
