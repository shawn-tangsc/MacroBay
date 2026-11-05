import { describe, expect, it, vi } from 'vitest'

import { createBriefingMacroWebSource, readStatedActual } from './dailyBriefingMacroWebSource'

/**
 * 接线层的判据（`A0.12` 第三步）：开关关掉时**一次请求都不发**，发出去的请求只认原文里写了
 * "actual/实际值 = 某个数"的片段，取不到就没有值、不编、不抛。
 */

const candidate = {
  eventKey: 'US.ADP',
  title: 'ADP employment change',
  importance: 'high' as const,
  scheduledAt: '2026-11-04T13:15:00.000Z'
}

const response = (results: readonly { title: string; content: string; url: string }[]) => ({
  results: results.map((result) => ({ ...result, sourceInput: 'q' }))
})

describe('the web source sends nothing when the switch is off', () => {
  it('never calls the search when the gate says no', async () => {
    const search = vi.fn(async () => response([]))
    const fetcher = createBriefingMacroWebSource({ enabled: async () => false, search })
    expect(await fetcher({ candidate })).toEqual([])
    // 这一条就是"接线之后 calls=0 仍然成立"：闸门在发请求之前。
    expect(search).not.toHaveBeenCalled()
  })

  it('re-checks the gate for every event, not once per run', async () => {
    let allow = true
    const search = vi.fn(async () => response([{ title: 'ADP', content: 'ADP actual: 86.0', url: 'https://example.com/a' }]))
    const fetcher = createBriefingMacroWebSource({ enabled: async () => allow, search })
    await fetcher({ candidate })
    allow = false
    await fetcher({ candidate: { ...candidate, eventKey: 'US.EIA' } })
    expect(search).toHaveBeenCalledTimes(1)
  })
})

describe('only a stated actual becomes a value', () => {
  it('takes the number the page itself states, with its link and excerpt', async () => {
    const search = vi.fn(async () => response([
      { title: 'ADP', content: 'Private payrolls rose. ADP actual: 86.0 thousand.', url: 'https://www.bls.gov/adp' }
    ]))
    const fetcher = createBriefingMacroWebSource({ enabled: async () => true, search, now: () => '2026-11-05T04:20:00.000Z' })
    const hits = await fetcher({ candidate })
    expect(hits).toHaveLength(1)
    expect(hits[0]).toMatchObject({ value: '86.0', sourceUrl: 'https://www.bls.gov/adp', capturedAt: '2026-11-05T04:20:00.000Z', kind: 'official' })
    expect(hits[0]!.excerpt).toContain('86.0')
  })

  it('refuses a page that only paraphrases without stating the actual', async () => {
    const search = vi.fn(async () => response([
      { title: 'ADP', content: 'Payrolls came in stronger than expected, well above the 60k consensus.', url: 'https://example.com/a' }
    ]))
    const fetcher = createBriefingMacroWebSource({ enabled: async () => true, search })
    // 没有 "actual/实际值 = 数" 这一句 → 没有值（宁可空着，不许编）。
    expect(await fetcher({ candidate })).toEqual([])
  })

  it('treats a failed search as "no value for this event" instead of throwing', async () => {
    const search = vi.fn(async () => { throw new Error('search down') })
    const fetcher = createBriefingMacroWebSource({ enabled: async () => true, search })
    await expect(fetcher({ candidate })).rejects.toThrow('search down')
    // 适配器不吞错：上游的 lookup 会按"这条没值"继续——错误边界只放在一层，不两处都兜。
  })
})

describe('reading the stated actual', () => {
  it('accepts the three explicit shapes and refuses everything else', () => {
    expect(readStatedActual('ADP actual: 86.0 thousand')).toBe('86.0')
    expect(readStatedActual('实际值 50.8')).toBe('50.8')
    expect(readStatedActual('公布值：-105.0')).toBe('-105.0')
    expect(readStatedActual('欧元区 CPI 初值 0.4%')).toBeUndefined()
    expect(readStatedActual('')).toBeUndefined()
  })
})
