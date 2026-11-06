import { describe, expect, it, vi } from 'vitest'

import type { DailyBriefingCalendarEvent } from './dailyBriefingFactPacket'
import {
  BRIEFING_MACRO_VALUE_LIMIT,
  lookupMissingMacroValues,
  mergeMacroValues,
  selectMacroValueCandidates,
  type BriefingMacroValueEvent
} from './dailyBriefingMacroValueLookup'

/**
 * `A0.12` 取值三条判据落在这里：只回查无值事件（有值的行 0 次）、一版最多 5 条且同一事件不重复、
 * 回查失败只是"没有值"。回查的对象是日历源，不是网络——用例按**事件条数**数次数。
 */

const CUTOFF = '2026-11-05T00:00:00.000Z'

const event = (eventKey: string, overrides: Readonly<{
  importance?: 'high' | 'medium' | 'low'
  actual?: string
  lifecycleState?: 'scheduled' | 'released' | 'cancelled'
  scheduledAt?: string
  relevance?: number
}> = {}): BriefingMacroValueEvent => ({
  eventKey,
  importance: overrides.importance ?? 'high',
  scheduledAt: overrides.scheduledAt ?? '2026-11-04T13:15:00.000Z',
  ...(overrides.actual === undefined ? {} : { actual: overrides.actual }),
  ...(overrides.lifecycleState === undefined ? {} : { lifecycleState: overrides.lifecycleState }),
  ...(overrides.relevance === undefined ? {} : { relevance: overrides.relevance })
})

describe('which events get re-read from the calendar source', () => {
  it('queues only high-impact events that have no actual and were not cancelled', () => {
    // 有值的不用取；取消的永远不会有值——把它放进队列等于浪费一次回查。
    const { queue, skipped } = selectMacroValueCandidates({
      events: [
        event('US.ADP'),
        event('US.CPI', { actual: '3.4%' }),
        event('US.EIA', { lifecycleState: 'cancelled' }),
        event('US.PMI', { importance: 'medium' }),
        event('US.PPI')
      ],
      cutoff: CUTOFF
    })

    expect(queue.map((candidate) => candidate.eventKey)).toEqual(['US.ADP', 'US.PPI'])
    expect(skipped).toEqual([])
  })

  it('orders by distance to the cutoff, then relevance, and keeps one look at each event', () => {
    const { queue } = selectMacroValueCandidates({
      events: [
        event('US.FAR', { scheduledAt: '2026-11-01T13:15:00.000Z' }),
        event('US.NEAR', { scheduledAt: '2026-11-04T23:15:00.000Z' }),
        event('US.TIE_LOW', { scheduledAt: '2026-11-04T13:15:00.000Z', relevance: 10 }),
        event('US.TIE_HIGH', { scheduledAt: '2026-11-04T13:15:00.000Z', relevance: 80 }),
        event('US.NEAR')
      ],
      cutoff: CUTOFF
    })

    expect(queue.map((candidate) => candidate.eventKey)).toEqual(['US.NEAR', 'US.TIE_HIGH', 'US.TIE_LOW', 'US.FAR'])
  })

  it('caps the queue at five events and records the rest as skipped', () => {
    const events = Array.from({ length: 8 }, (_, index) => event(`US.E${index}`, {
      scheduledAt: `2026-11-04T${String(10 + index).padStart(2, '0')}:00:00.000Z`
    }))
    const { queue, skipped } = selectMacroValueCandidates({ events, cutoff: CUTOFF })

    expect(BRIEFING_MACRO_VALUE_LIMIT).toBe(5)
    expect(queue).toHaveLength(5)
    expect(skipped).toHaveLength(3)
  })
})

describe('the re-read itself', () => {
  it('does not read the source at all when every event already has a value', async () => {
    // 判据是次数：有值的事件回查 0 次，不能靠"代码看起来没发"来解释。
    const read = vi.fn(async () => [] as readonly BriefingMacroValueEvent[])
    const result = await lookupMissingMacroValues({
      events: [event('US.CPI', { actual: '3.4%' })],
      cutoff: CUTOFF,
      read
    })

    expect(read).not.toHaveBeenCalled()
    expect(result.calls).toBe(0)
    expect(result.values).toEqual([])
  })

  it('takes the value the calendar source now carries, and counts one look per event', async () => {
    const result = await lookupMissingMacroValues({
      events: [event('US.ADP'), event('US.EIA')],
      cutoff: CUTOFF,
      read: async () => [event('US.ADP', { actual: '86.0' })]
    })

    expect(result.calls).toBe(2)
    expect(result.values).toEqual([{ eventKey: 'US.ADP', actual: '86.0' }])
  })

  it('treats a failed read as "no value" instead of failing the edition', async () => {
    const result = await lookupMissingMacroValues({
      events: [event('US.ADP')],
      cutoff: CUTOFF,
      read: async () => { throw new Error('calendar read failed') }
    })

    expect(result.values).toEqual([])
    expect(result.calls).toBe(1)
  })

  it('never reads more than the cap, even when more events are missing values', async () => {
    const read = vi.fn(async () => [] as readonly BriefingMacroValueEvent[])
    const events = Array.from({ length: 7 }, (_, index) => event(`US.E${index}`, {
      scheduledAt: `2026-11-04T${String(10 + index).padStart(2, '0')}:00:00.000Z`
    }))
    const result = await lookupMissingMacroValues({ events, cutoff: CUTOFF, read })

    expect(result.calls).toBe(5)
    expect(result.skipped).toHaveLength(2)
    expect(read).toHaveBeenCalledTimes(1)
  })
})

describe('merging what came back', () => {
  const calendarEvent = (eventKey: string, overrides: Partial<DailyBriefingCalendarEvent> = {}): DailyBriefingCalendarEvent => ({
    eventKey,
    title: eventKey,
    scheduledAt: '2026-11-04T13:15:00.000Z',
    importance: 'high',
    lifecycleState: 'scheduled',
    category: 'economic-indicator',
    surprise: { direction: 'consensus-unavailable' },
    ...overrides
  })

  it('fills only the rows that had no actual, and leaves the rest untouched', () => {
    const events = [calendarEvent('US.ADP'), calendarEvent('US.CPI', { actual: '3.4%', lifecycleState: 'released' })]
    const merged = mergeMacroValues(events, [{ eventKey: 'US.ADP', actual: '86.0' }, { eventKey: 'US.CPI', actual: '9.9%' }])

    expect(merged.find((event) => event.eventKey === 'US.ADP')?.actual).toBe('86.0')
    // 库内已有的值不许被回查结果覆盖。
    expect(merged.find((event) => event.eventKey === 'US.CPI')?.actual).toBe('3.4%')
  })

  it('is a no-op when the re-read found nothing', () => {
    const events = [calendarEvent('US.ADP')]
    expect(mergeMacroValues(events, [])).toBe(events)
  })
})
