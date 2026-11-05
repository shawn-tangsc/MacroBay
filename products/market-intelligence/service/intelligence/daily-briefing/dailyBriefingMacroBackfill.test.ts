import { describe, expect, it, vi } from 'vitest'

import { backfillMacroValues } from './dailyBriefingMacroBackfill'
import type { BriefingMacroWebRead } from './dailyBriefingMacroWebSource'

/**
 * 两级取值的判据（`02` v2.127）：先回查日历源，**拿到了就不许再联网**；没拿到才走联网，
 * 开关关掉零请求，而且"发了几次"在**编排层**数。
 */

const CUTOFF = '2026-11-05T00:00:00.000Z'

const event = (eventKey: string, overrides: Readonly<{
  actual?: string
  lifecycleState?: 'released' | 'scheduled' | 'cancelled'
  scheduledAt?: string
}> = {}) => ({
  eventKey,
  importance: 'high' as const,
  scheduledAt: overrides.scheduledAt ?? '2026-11-04T13:15:00.000Z',
  ...(overrides.actual === undefined ? {} : { actual: overrides.actual }),
  ...(overrides.lifecycleState === undefined ? {} : { lifecycleState: overrides.lifecycleState })
})

const webHit = (eventKey: string, actual = '86.0') => ({
  eventKey, actual, sourceUrl: 'https://www.bls.gov/adp', capturedAt: CUTOFF, excerpt: `actual ${actual}`, kind: 'official' as const
})

const noWeb: BriefingMacroWebRead = async (events) => ({ values: [], conflicts: [], calls: events.length })

describe('level one first: what the calendar re-read answers is never searched for', () => {
  it('sends only the still-missing events to the web', async () => {
    const readWeb = vi.fn(async (_events: readonly { eventKey: string }[]) => ({ values: [], conflicts: [], calls: 1 }))
    const result = await backfillMacroValues({
      events: [event('A'), event('B')],
      cutoff: CUTOFF,
      readCalendar: async () => [event('A', { actual: '50.8' })],
      readWeb
    })
    expect(result.resolved).toEqual([{ eventKey: 'A', actual: '50.8', via: 'calendar' }])
    expect(result.calendarCalls).toBe(2)
    expect(result.webCalls).toBe(1)
    // 第二级只收到 B：A 绝不允许再出现一次联网。
    expect((readWeb.mock.calls[0]![0] ?? []).map((entry: { eventKey: string }) => entry.eventKey)).toEqual(['B'])
  })

  it('sends nothing to the web when the re-read answered everything', async () => {
    const readWeb = vi.fn(async (_events: readonly { eventKey: string }[]) => ({ values: [], conflicts: [], calls: 0 }))
    const result = await backfillMacroValues({
      events: [event('A'), event('B')],
      cutoff: CUTOFF,
      readCalendar: async () => [event('A', { actual: '1' }), event('B', { actual: '2' })],
      readWeb
    })
    expect(result.webCalls).toBe(0)
    expect(readWeb).not.toHaveBeenCalled()
    expect(result.unresolved).toEqual([])
  })

  it('does not look up an event that already has a value, and ignores cancelled ones', async () => {
    const readWeb = vi.fn(noWeb)
    const result = await backfillMacroValues({
      events: [event('HAS', { actual: '9.9' }), event('CANCELLED', { lifecycleState: 'cancelled' })],
      cutoff: CUTOFF,
      readCalendar: async () => [],
      readWeb
    })
    expect(readWeb).not.toHaveBeenCalled()
    expect(result.calendarCalls).toBe(0)
    expect(result.unresolved).toEqual([])
  })
})

describe('level two fills only what is missing', () => {
  it('keeps a web value with its provenance and counts the searches', async () => {
    const result = await backfillMacroValues({
      events: [event('A'), event('B')],
      cutoff: CUTOFF,
      readCalendar: async () => [],
      readWeb: async (events) => ({
        values: events.filter((entry) => entry.eventKey === 'B').map((entry) => webHit(entry.eventKey)),
        conflicts: [],
        calls: events.length
      })
    })
    expect(result.resolved).toEqual([{ eventKey: 'B', actual: '86.0', via: 'web', sourceUrl: 'https://www.bls.gov/adp', capturedAt: CUTOFF }])
    expect(result.webCalls).toBe(2)
    expect(result.unresolved).toEqual(['A'])
  })

  it('keeps an event in the unresolved list when both levels come back empty', async () => {
    const result = await backfillMacroValues({
      events: [event('A')],
      cutoff: CUTOFF,
      readCalendar: async () => [],
      readWeb: noWeb
    })
    expect(result.resolved).toEqual([])
    expect(result.unresolved).toEqual(['A'])
    expect(result.webCalls).toBe(1)
  })

  it('records a conflict instead of choosing a number', async () => {
    const result = await backfillMacroValues({
      events: [event('A')],
      cutoff: CUTOFF,
      readCalendar: async () => [],
      readWeb: async () => ({ values: [], conflicts: [{ eventKey: 'A', values: ['86.0', '85.0'] }], calls: 1 })
    })
    expect(result.resolved).toEqual([])
    expect(result.conflicts).toEqual([{ eventKey: 'A', values: ['86.0', '85.0'] }])
    expect(result.unresolved).toEqual(['A'])
  })

  it('sends nothing when the web level is absent (switch off is translated to "no reader")', async () => {
    const result = await backfillMacroValues({
      events: [event('A')],
      cutoff: CUTOFF,
      readCalendar: async () => []
    })
    expect(result.webCalls).toBe(0)
    expect(result.unresolved).toEqual(['A'])
  })
})
