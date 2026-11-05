import { describe, expect, it, vi } from 'vitest'

import {
  BRIEFING_MACRO_VALUE_LIMIT,
  acceptMacroValue,
  lookupMissingMacroValues,
  selectMacroValueCandidates,
  type BriefingMacroValueHit
} from './dailyBriefingMacroValueLookup'

/**
 * `A0.12` 第三步的判据在这里各落一条：上限 5、顺序固定、同一事件不重复、开关关掉零请求、
 * 有值不联网、取不到/超时/冲突都不写值。这个模块本身不联网——请求次数是数出来的。
 */

const CUTOFF = '2026-11-05T00:00:00.000Z'

const event = (eventKey: string, overrides: Readonly<{
  importance?: 'high' | 'medium' | 'low'
  hasValue?: boolean
  scheduledAt?: string
  relevance?: number
}> = {}) => ({
  eventKey,
  title: eventKey,
  importance: overrides.importance ?? 'high' as const,
  scheduledAt: overrides.scheduledAt ?? '2026-11-04T13:15:00.000Z',
  relevance: overrides.relevance ?? 0,
  hasValue: overrides.hasValue ?? false
})

const hit = (overrides: Partial<BriefingMacroValueHit> = {}): BriefingMacroValueHit => ({
  value: '86.0',
  sourceUrl: 'https://www.bls.gov/example',
  capturedAt: '2026-11-05T04:20:00.000Z',
  excerpt: 'ADP employment change: 86.0 thousand',
  kind: 'official',
  ...overrides
})

describe('which events are worth a lookup', () => {
  it('takes only high-impact events that have no value yet', () => {
    const selection = selectMacroValueCandidates({
      cutoff: CUTOFF,
      events: [event('A'), event('B', { hasValue: true }), event('C', { importance: 'medium' })]
    })
    // 有值的那条不取（第 4 条判据：不许拿网页值覆盖库内值），低影响的不取。
    expect(selection.queue.map((candidate) => candidate.eventKey)).toEqual(['A'])
  })

  it('caps a version at five lookups and reports what it dropped', () => {
    const events = Array.from({ length: 9 }, (_, index) => event(`E${index}`, {
      scheduledAt: new Date(Date.parse(CUTOFF) - (index + 1) * 3_600_000).toISOString()
    }))
    const selection = selectMacroValueCandidates({ cutoff: CUTOFF, events })
    expect(selection.queue).toHaveLength(BRIEFING_MACRO_VALUE_LIMIT)
    expect(selection.skipped).toHaveLength(4)
  })

  it('orders by distance to the cutoff, then by relevance, and never twice for one event', () => {
    const selection = selectMacroValueCandidates({
      cutoff: CUTOFF,
      events: [
        event('FAR', { scheduledAt: '2026-11-03T00:00:00.000Z' }),
        event('NEAR', { scheduledAt: '2026-11-04T23:00:00.000Z' }),
        event('SAME_NEAR_LOW', { scheduledAt: '2026-11-04T23:00:00.000Z', relevance: 10 }),
        event('SAME_NEAR_HIGH', { scheduledAt: '2026-11-04T23:00:00.000Z', relevance: 90 }),
        event('NEAR')
      ]
    })
    // 同样贴近截止时，相关性高的先取（`02` 的顺序：重要性 → 距截止近 → 相关性）。
    expect(selection.queue.map((candidate) => candidate.eventKey)).toEqual(['SAME_NEAR_HIGH', 'SAME_NEAR_LOW', 'NEAR', 'FAR'])
  })
})

describe('what counts as a value', () => {
  it('needs the excerpt, the source link and the capture time', () => {
    expect(acceptMacroValue([hit({ excerpt: '' })]).value).toBeUndefined()
    expect(acceptMacroValue([hit({ sourceUrl: '' })]).value).toBeUndefined()
    expect(acceptMacroValue([hit({ capturedAt: '' })]).value).toBeUndefined()
    // 三样齐了才接受，且把来源一起交出去（正文要能看出这个数是从网页取的）。
    expect(acceptMacroValue([hit()])).toMatchObject({ value: '86.0', sourceUrl: 'https://www.bls.gov/example' })
  })

  it('prefers the official source and refuses to pick between conflicting values', () => {
    const official = hit({ value: '86.0', kind: 'official' })
    const media = hit({ value: '85.0', kind: 'media' })
    // 两个来源冲突：官方不能替媒体选，这条就不写值，只记冲突。
    expect(acceptMacroValue([official, media]).conflict).toEqual(['86.0', '85.0'])
    expect(acceptMacroValue([official, media]).value).toBeUndefined()
    // 只有媒体一个来源时可以用，但值必须是它原文里的那一个。
    expect(acceptMacroValue([media])).toMatchObject({ value: '85.0' })
  })
})

describe('the lookup run', () => {
  it('sends nothing when WebSearch is off', async () => {
    const fetcher = vi.fn(async () => [hit()])
    const result = await lookupMissingMacroValues({ events: [event('A')], cutoff: CUTOFF, enabled: false, fetcher })
    expect(fetcher).not.toHaveBeenCalled()
    expect(result.calls).toBe(0)
    expect(result.values).toHaveLength(0)
  })

  it('sends nothing for an event whose value is already in the store', async () => {
    const fetcher = vi.fn(async () => [hit()])
    const result = await lookupMissingMacroValues({ events: [event('A', { hasValue: true })], cutoff: CUTOFF, enabled: true, fetcher })
    expect(fetcher).not.toHaveBeenCalled()
    expect(result.values).toHaveLength(0)
  })

  it('keeps going when one lookup times out or throws, and never blocks the run', async () => {
    const fetcher = vi.fn(async ({ candidate }: Readonly<{ candidate: Readonly<{ eventKey: string }> }>) => {
      if (candidate.eventKey === 'SLOW') return new Promise<never>(() => undefined)
      if (candidate.eventKey === 'BROKEN') throw new Error('network down')
      return [hit({ value: '86.0' })]
    })
    const result = await lookupMissingMacroValues({
      events: [event('SLOW'), event('BROKEN'), event('OK')],
      cutoff: CUTOFF,
      enabled: true,
      fetcher,
      timeoutMs: 10
    })
    // 三条都发了请求；只有拿得回来的那条有值，其余什么都没有——不是整版失败。
    expect(result.calls).toBe(3)
    expect(result.values.map((value) => value.eventKey)).toEqual(['OK'])
  })

  it('records a conflict instead of choosing a number', async () => {
    const fetcher = vi.fn(async () => [hit({ value: '86.0', kind: 'official' }), hit({ value: '85.0', kind: 'media' })])
    const result = await lookupMissingMacroValues({ events: [event('A')], cutoff: CUTOFF, enabled: true, fetcher })
    expect(result.values).toHaveLength(0)
    expect(result.conflicts).toEqual([{ eventKey: 'A', values: ['86.0', '85.0'] }])
  })
})
