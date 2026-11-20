import { afterEach, describe, expect, it } from 'vitest'

import { createMacroCalendarRepository, type MacroCalendarRepository } from '../macro-calendar/macroCalendarRepository'
import type { PolicyPathObservation } from '../../../contracts/policyPath'

const open: MacroCalendarRepository[] = []
const repository = (): MacroCalendarRepository => {
  const created = createMacroCalendarRepository({ filePath: ':memory:' })
  open.push(created)
  return created
}
afterEach(() => { while (open.length) open.pop()!.close() })

const values = { 'no-change': 0.2, 'hike-25': 0.77, 'hike-50-plus': 0.01, 'cut-25': 0.01, 'cut-50-plus': 0.01 }
const observation = (at: string): PolicyPathObservation => ({ at, values, quote: { bid: 0.76, ask: 0.78 } })

describe('policy path observation store', () => {
  it('returns the series oldest to newest and drops a duplicate instant', () => {
    const store = repository().policyObservations
    store.append('2026-12-09', observation('2026-10-30T02:00:00.000Z'))
    store.append('2026-12-09', observation('2026-10-30T02:10:00.000Z'))
    store.append('2026-12-09', observation('2026-10-30T02:10:00.000Z'))
    const { observations } = store.list('2026-12-09', { limit: 10 })
    expect(observations.map((row) => row.at)).toEqual(['2026-10-30T02:00:00.000Z', '2026-10-30T02:10:00.000Z'])
    expect(observations.at(-1)?.quote).toEqual({ bid: 0.76, ask: 0.78 })
  })

  it('caps from the tail so the newest point survives — and says it truncated', () => {
    const store = repository().policyObservations
    for (const minute of ['00', '10', '20', '30']) store.append('2026-12-09', observation(`2026-10-30T02:${minute}:00.000Z`))
    const capped = store.list('2026-12-09', { limit: 2 })
    expect(capped.observations.map((row) => row.at)).toEqual(['2026-10-30T02:20:00.000Z', '2026-10-30T02:30:00.000Z'])
    // 触到上限必须说出来：不说，读者就会以为这段历史只有这么长。
    expect(capped.truncated).toBe(true)
  })

  it('does not report truncation when the cap was never reached', () => {
    const store = repository().policyObservations
    for (const minute of ['00', '10']) store.append('2026-12-09', observation(`2026-10-30T02:${minute}:00.000Z`))
    expect(store.list('2026-12-09', { limit: 2 })).toEqual({
      observations: [
        { at: '2026-10-30T02:00:00.000Z', values, quote: { bid: 0.76, ask: 0.78 } },
        { at: '2026-10-30T02:10:00.000Z', values, quote: { bid: 0.76, ask: 0.78 } }
      ],
      truncated: false
    })
  })

  it('drops rows older than the window instead of counting them', () => {
    const store = repository().policyObservations
    for (const minute of ['00', '10', '20', '30']) store.append('2026-12-09', observation(`2026-10-30T02:${minute}:00.000Z`))
    const { observations } = store.list('2026-12-09', { from: '2026-10-30T02:20:00.000Z', limit: 10 })
    expect(observations.map((row) => row.at)).toEqual(['2026-10-30T02:20:00.000Z', '2026-10-30T02:30:00.000Z'])
  })

  it('keeps meetings apart and rejects a nonsense limit', () => {
    const store = repository().policyObservations
    store.append('2026-12-09', observation('2026-10-30T02:00:00.000Z'))
    store.append('2027-01-27', observation('2026-10-30T02:00:00.000Z'))
    expect(store.list('2026-12-09', { limit: 10 }).observations).toHaveLength(1)
    expect(store.list('2027-01-27', { limit: 10 }).observations).toHaveLength(1)
    expect(store.list('2026-12-09', { limit: 0 })).toEqual({ observations: [], truncated: false })
  })
})
