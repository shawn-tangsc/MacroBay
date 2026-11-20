import { describe, expect, it } from 'vitest'

import { externalizeInlinePayloads, isContentAddressedPayloadRef } from './rawRecordPayloadExternalization'

/**
 * 存量外置的规则（用户 2026-11-20）：**按缺口迁、跑两遍 0 变更、hash 不符不搬**。
 * 原语是注入的，所以这里能精确指定「哪一条会失败」——假实现只出现在测试里。
 */
const record = (id: string, over: Partial<Parameters<typeof externalizeInlinePayloads>[0]['records'][number]> = {}) => ({
  rawRecordId: id,
  payloadRefType: 'inline' as const,
  payloadBody: `{"id":"${id}"}`,
  payloadHash: `hash-${id}`,
  ...over
})

const hexOf = (value: string): string => value.replace(/[^0-9a-f]/g, '0').padEnd(64, '0').slice(0, 64)
const okWriter = { writeVerifiedPayload: ({ expectedHash }: { expectedHash: string }) => `${hexOf(expectedHash)}.bin` }

describe('存量原文外置', () => {
  it('inline → file：条数不变、body 不落库、引用可解析', () => {
    const input = [record('a'), record('b')]
    const out = externalizeInlinePayloads({ records: input, deps: okWriter })
    expect(out.records).toHaveLength(input.length)
    expect(out.inlineToFile).toBe(2)
    expect(out.relocatedFromOldLayout).toBe(0)
    for (const item of out.records) {
      expect(item.payloadRefType).toBe('file')
      expect('payloadBody' in item).toBe(false)
      expect(isContentAddressedPayloadRef(item.payloadFileRef!)).toBe(true)
    }
  })

  it('跑两遍第二遍 0 变更（已经是 file 的跳过）', () => {
    const first = externalizeInlinePayloads({ records: [record('a')], deps: okWriter })
    const second = externalizeInlinePayloads({ records: first.records, deps: okWriter })
    expect(second.inlineToFile).toBe(0)
    expect(second.relocatedFromOldLayout).toBe(0)
    expect(second.alreadyContentAddressed).toBe(1)
    expect(second.records).toEqual(first.records)
  })

  it('原语校验失败的那条原地不动：不换引用、不删记录、不搬一半', () => {
    const failing = { writeVerifiedPayload: () => undefined }
    const before = record('bad')
    const out = externalizeInlinePayloads({ records: [before, record('good')], deps: failing })
    expect(out.untouched).toBe(2)
    expect(out.inlineToFile).toBe(0)
    expect(out.records[0]).toEqual(before)
    expect(out.records[0]!.payloadRefType).toBe('inline')
  })

  it('缺 body 或缺 hash 的记录不猜：原地不动', () => {
    const out = externalizeInlinePayloads({
      records: [record('nobody', { payloadBody: undefined }), record('nohash', { payloadHash: '' })],
      deps: okWriter
    })
    expect(out.untouched).toBe(2)
    expect(out.inlineToFile).toBe(0)
  })

  it('老布局的 file 引用会重新安家；读不到就报未迁移、不搬一半', () => {
    const hex = 'a'.repeat(64) + '.bin'
    const contentAddressed = { rawRecordId: 'new', payloadRefType: 'file' as const, payloadHash: 'h-new', payloadFileRef: hex }
    const oldLayout = { rawRecordId: 'old', payloadRefType: 'file' as const, payloadHash: 'h-old', payloadFileRef: 'source-abc/old.bin' }
    const deps = {
      writeVerifiedPayload: ({ expectedHash }: { expectedHash: string }) => `${'b'.repeat(64)}.bin`,
      readOldLayoutPayload: (ref: string) => ref === 'source-abc/old.bin' ? '{"old":1}' : undefined
    }
    const out = externalizeInlinePayloads({ records: [contentAddressed, oldLayout], deps })
    expect(out.relocatedFromOldLayout).toBe(1)
    expect(out.alreadyContentAddressed).toBe(1)
    expect(out.records[1]!.payloadFileRef).toBe(`${'b'.repeat(64)}.bin`)

    const cannotRead = externalizeInlinePayloads({ records: [oldLayout], deps: { ...deps, readOldLayoutPayload: () => undefined } })
    expect(cannotRead.relocatedFromOldLayout).toBe(0)
    expect(cannotRead.untouched).toBe(1)
    expect(cannotRead.records[0]).toEqual(oldLayout)
  })
})
