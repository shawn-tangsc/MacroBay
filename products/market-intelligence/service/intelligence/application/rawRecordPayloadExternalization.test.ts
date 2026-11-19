import { describe, expect, it } from 'vitest'

import { externalizeInlinePayloads } from './rawRecordPayloadExternalization'

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

const okWriter = { writeVerifiedPayload: ({ expectedHash }: { expectedHash: string }) => `${expectedHash.slice(5)}.bin` }

describe('存量原文外置', () => {
  it('inline → file：条数不变、body 不落库、引用可解析', () => {
    const input = [record('a'), record('b')]
    const out = externalizeInlinePayloads({ records: input, deps: okWriter })
    expect(out.records).toHaveLength(input.length)
    expect(out.externalized).toBe(2)
    for (const item of out.records) {
      expect(item.payloadRefType).toBe('file')
      expect('payloadBody' in item).toBe(false)
      expect(item.payloadFileRef).toBe(`${item.payloadHash.slice(5)}.bin`)
    }
  })

  it('跑两遍第二遍 0 变更（已经是 file 的跳过）', () => {
    const first = externalizeInlinePayloads({ records: [record('a')], deps: okWriter })
    const second = externalizeInlinePayloads({ records: first.records, deps: okWriter })
    expect(second.externalized).toBe(0)
    expect(second.alreadyFile).toBe(1)
    expect(second.records).toEqual(first.records)
  })

  it('原语校验失败的那条原地不动：不换引用、不删记录、不搬一半', () => {
    const failing = { writeVerifiedPayload: () => undefined }
    const before = record('bad')
    const out = externalizeInlinePayloads({ records: [before, record('good')], deps: failing })
    expect(out.untouched).toBe(2)
    expect(out.externalized).toBe(0)
    expect(out.records[0]).toEqual(before)
    expect(out.records[0]!.payloadRefType).toBe('inline')
  })

  it('缺 body 或缺 hash 的记录不猜：原地不动', () => {
    const out = externalizeInlinePayloads({
      records: [record('nobody', { payloadBody: undefined }), record('nohash', { payloadHash: '' })],
      deps: okWriter
    })
    expect(out.untouched).toBe(2)
    expect(out.externalized).toBe(0)
  })
})
