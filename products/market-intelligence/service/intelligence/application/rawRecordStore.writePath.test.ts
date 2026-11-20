import { describe, expect, it } from 'vitest'

import { createRawRecordStore } from './rawRecordStore'

/**
 * 写路径外置（用户 2026-11-20）：**新写入一律 file、不落 body、不设阈值**。
 * 原语失败 → 整条不落库（不许留「有记录、原文读不到」的行）。
 */
const base = {
  sourceId: 'macro-calendar-bls', runId: 'run-1', payloadFormat: 'json' as const,
  payloadHash: 'a'.repeat(64), sourceDedupeKey: 'k1', parserVersion: 'v1'
}

describe('appendRawRecord 的原文外置', () => {
  it('inline body → 落成 file 引用，且序列化后没有 payloadBody 这个键', () => {
    const written: Array<{ directory: string; body: string }> = []
    const store = createRawRecordStore({
      payloadDirectory: '/payloads/generic-intelligence',
      writeVerifiedPayload: (input) => { written.push({ directory: input.directory, body: input.body }); return { state: 'written', fileRef: `${'b'.repeat(64)}.bin` } }
    })
    const record = store.appendRawRecord({ ...base, payloadRefType: 'inline', payloadBody: '{"raw":1}' })!
    expect(written).toHaveLength(1)
    expect(written[0]!.directory).toBe('/payloads/generic-intelligence')
    expect(record.payloadRefType).toBe('file')
    expect(record.payloadFileRef).toBe(`${'b'.repeat(64)}.bin`)
    expect('payloadBody' in record).toBe(false)
  })

  it('1 字节也走文件（不设阈值）', () => {
    const store = createRawRecordStore({ payloadDirectory: '/p', writeVerifiedPayload: () => ({ state: 'reused', fileRef: `${'c'.repeat(64)}.bin` }) })
    expect(store.appendRawRecord({ ...base, payloadRefType: 'inline', payloadBody: 'x' })!.payloadRefType).toBe('file')
  })

  it('原语失败 → 整条不落库（返回 undefined），不产生读不到原文的记录', () => {
    const store = createRawRecordStore({ payloadDirectory: '/p', writeVerifiedPayload: () => ({ state: 'failed', reason: 'hash-mismatch' }) })
    expect(store.appendRawRecord({ ...base, payloadRefType: 'inline', payloadBody: '{}' })).toBeUndefined()
    expect(store.getRawRecord('raw-1')).toBeUndefined()
  })
})
