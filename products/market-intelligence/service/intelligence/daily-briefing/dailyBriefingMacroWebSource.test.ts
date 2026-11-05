import { describe, expect, it, vi } from 'vitest'

import { createBriefingMacroWebRead, readStatedActual } from './dailyBriefingMacroWebSource'

/**
 * 第二级（联网）的判据：开关关掉零请求、只认原文写了"实际值 = 数"的片段、转述不算、
 * 两个来源冲突不选、失败只算这一条没值。
 */

const event = (eventKey: string) => ({
  eventKey,
  importance: 'high' as const,
  scheduledAt: '2026-11-04T13:15:00.000Z'
})

const results = (items: readonly { content: string; url: string }[]) =>
  ({ results: items.map((item) => ({ ...item, title: 't', sourceInput: 'q' })) })

describe('the second level sends nothing when the switch is off', () => {
  it('does not search at all when the gate is closed', async () => {
    const searchKeywords = vi.fn(async () => results([]))
    const read = createBriefingMacroWebRead({ enabled: async () => false, searchKeywords })
    const out = await read([event('US.ADP')])
    expect(searchKeywords).not.toHaveBeenCalled()
    expect(out.calls).toBe(0)
    expect(out.values).toEqual([])
  })

  it('stops searching mid-run once the switch closes', async () => {
    let allow = true
    const searchKeywords = vi.fn(async () => { allow = false; return results([]) })
    const read = createBriefingMacroWebRead({ enabled: async () => allow, searchKeywords })
    const out = await read([event('US.ADP'), event('US.EIA')])
    // 第一条发出去之后开关被关掉：第二条连请求都不该有。
    expect(searchKeywords).toHaveBeenCalledTimes(1)
    expect(out.calls).toBe(1)
  })
})

describe('only a stated actual becomes a value', () => {
  it('keeps the link, the capture time and the sentence', async () => {
    const searchKeywords = vi.fn(async () => results([
      { content: 'Private payrolls rose. ADP actual: 86.0 thousand.', url: 'https://www.bls.gov/adp' }
    ]))
    const read = createBriefingMacroWebRead({ enabled: async () => true, searchKeywords, now: () => '2026-11-05T04:20:00.000Z' })
    const out = await read([event('US.ADP')])
    expect(out.values).toHaveLength(1)
    expect(out.values[0]).toMatchObject({ actual: '86.0', sourceUrl: 'https://www.bls.gov/adp', capturedAt: '2026-11-05T04:20:00.000Z', kind: 'official' })
    expect(out.values[0]!.excerpt).toContain('86.0')
  })

  it('refuses a paraphrase that never states the actual', async () => {
    const searchKeywords = vi.fn(async () => results([
      { content: 'Payrolls came in far above the 60k consensus.', url: 'https://example.com/a' }
    ]))
    const read = createBriefingMacroWebRead({ enabled: async () => true, searchKeywords })
    expect((await read([event('US.ADP')])).values).toEqual([])
  })

  it('records a conflict instead of picking a source', async () => {
    const searchKeywords = vi.fn(async () => results([
      { content: 'ADP actual: 86.0', url: 'https://www.bls.gov/adp' },
      { content: 'ADP actual: 85.0', url: 'https://example.com/a' }
    ]))
    const read = createBriefingMacroWebRead({ enabled: async () => true, searchKeywords })
    const out = await read([event('US.ADP')])
    expect(out.values).toEqual([])
    expect(out.conflicts).toEqual([{ eventKey: 'US.ADP', values: ['86.0', '85.0'] }])
  })

  it('treats a failed search as "no value for this event" and keeps going', async () => {
    let first = true
    const searchKeywords = vi.fn(async () => {
      if (first) { first = false; throw new Error('search down') }
      return results([{ content: 'EIA actual: -86.5', url: 'https://www.eia.gov/x' }])
    })
    const read = createBriefingMacroWebRead({ enabled: async () => true, searchKeywords })
    const out = await read([event('US.ADP'), event('US.EIA')])
    expect(out.calls).toBe(2)
    expect(out.values.map((value) => value.eventKey)).toEqual(['US.EIA'])
  })
})

describe('reading the stated actual', () => {
  it('accepts the three explicit shapes and refuses prose numbers', () => {
    expect(readStatedActual('ADP actual: 86.0 thousand')).toBe('86.0')
    expect(readStatedActual('实际值 50.8')).toBe('50.8')
    expect(readStatedActual('公布值：-105.0')).toBe('-105.0')
    expect(readStatedActual('欧元区 CPI 初值 0.4%')).toBeUndefined()
  })
})
