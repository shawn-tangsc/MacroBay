import { describe, expect, it, vi } from 'vitest'

import { createRawRecordStore } from './rawRecordStore'
import type { RawIntelligenceRecord } from '../schema/intelligenceRecord'

/**
 * 0.4.5 缺陷②：升级前已经 inline 的正文不会自己搬出去。
 *
 * 三条判据：搬完之后原文读得出（引用可解析）、跑第二遍 `0 变更`、**失败的那条原地不动**
 * （不产生「有记录、原文读不到」的行）。
 */
function inlineRecord(id: string, body: string): RawIntelligenceRecord {
  return {
    rawRecordId: id,
    sourceId: 'binance-announcements',
    runId: `run-${id}`,
    parserVersion: 'binance-announcements-v1',
    processingOwner: 'generic-intelligence',
    processingState: 'received',
    storageTier: 'hot',
    archiveStatus: 'none',
    payloadFormat: 'html',
    payloadRefType: 'inline',
    payloadBody: body,
    payloadHash: `hash-${id}`,
    payloadSizeBytes: body.length,
    sourceDedupeKey: `dedupe-${id}`,
    detectedAt: '2026-11-18T00:00:00.000Z'
  }
}

function harness(input: Readonly<{ records: RawIntelligenceRecord[]; write?: (body: string) => { fileRef: string } | { failed: string } }>) {
  const writes: number[] = []
  const written: string[] = []
  const store = createRawRecordStore({
    snapshot: { records: input.records, sequence: input.records.length },
    storage: {
      readAll: async () => ({ records: input.records, sequence: input.records.length }),
      writeAll: async (next) => { writes.push(next.records.length) },
      writeAllSync: (next) => { writes.push(next.records.length) }
    },
    payloadDirectory: '/payloads/generic-intelligence',
    writeVerifiedPayload: ({ body }) => {
      const outcome = input.write ? input.write(body) : { fileRef: `${body.length}-${'.bin'}` }
      if ('failed' in outcome) return { state: 'failed' as const, reason: outcome.failed }
      written.push(body)
      return { state: 'written' as const, fileRef: outcome.fileRef }
    }
  })
  return { store, writes, written }
}

describe('存量原文外置：启动时幂等迁移', () => {
  it('moves an inline body into a file reference, keeps the record, and the second run moves nothing', () => {
    const { store, writes, written } = harness({
      records: [inlineRecord('raw-1', '<p>old</p>'), inlineRecord('raw-2', '<p>older</p>')]
    })

    const first = store.migrateInlinePayloads()
    expect(first).toMatchObject({ state: 'migrated', inlineToFile: 2, untouched: 0, remainingInline: 0 })
    expect(written).toEqual(['<p>old</p>', '<p>older</p>'])
    // 条数一条不少（写盘闸也要求「不比读入少」），原文改成引用、正文不再落库。
    expect(writes).toEqual([2])
    const migrated = store.getRawRecord('raw-1')!
    expect(migrated.payloadRefType).toBe('file')
    expect(migrated.payloadFileRef).toBeDefined()
    expect(migrated.payloadBody).toBeUndefined()

    // 第二遍：缺口归零 → 0 变更、不再写盘。
    const second = store.migrateInlinePayloads()
    expect(second).toMatchObject({ state: 'unchanged', inlineToFile: 0, remainingInline: 0 })
    expect(writes).toEqual([2])
  })

  it('leaves a record whose write failed exactly as it was, and never writes half a migration', () => {
    const { store, writes } = harness({
      records: [inlineRecord('raw-1', '<p>ok</p>'), inlineRecord('raw-2', '<p>boom</p>')],
      write: (body) => (body.includes('boom') ? { failed: 'verify-failed' } : { fileRef: 'ok.bin' })
    })

    const result = store.migrateInlinePayloads()
    expect(result).toMatchObject({ state: 'migrated', inlineToFile: 1, untouched: 1, remainingInline: 1 })
    // 失败那条：仍是 inline，正文还在——「有记录、原文读不到」不允许出现。
    const failed = store.getRawRecord('raw-2')!
    expect(failed.payloadRefType).toBe('inline')
    expect(failed.payloadBody).toBe('<p>boom</p>')
    expect(failed.payloadFileRef).toBeUndefined()
    expect(writes).toEqual([2])
  })

  it('reports "not wired" instead of "nothing to migrate" when no payload directory is configured', () => {
    const store = createRawRecordStore({ snapshot: { records: [inlineRecord('raw-1', 'x')], sequence: 1 } })
    expect(store.migrateInlinePayloads()).toEqual({ state: 'unavailable', reason: 'no-payload-directory' })
  })
})
