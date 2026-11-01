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
    const series = store.list('2026-12-09', 10)
    expect(series.map((row) => row.at)).toEqual(['2026-10-30T02:00:00.000Z', '2026-10-30T02:10:00.000Z'])
    expect(series.at(-1)?.quote).toEqual({ bid: 0.76, ask: 0.78 })
  })

  it('caps from the tail so the newest point survives', () => {
    const store = repository().policyObservations
    for (const minute of ['00', '10', '20', '30']) store.append('2026-12-09', observation(`2026-10-30T02:${minute}:00.000Z`))
    expect(store.list('2026-12-09', 2).map((row) => row.at)).toEqual(['2026-10-30T02:20:00.000Z', '2026-10-30T02:30:00.000Z'])
  })

  it('keeps meetings apart and rejects a nonsense limit', () => {
    const store = repository().policyObservations
    store.append('2026-12-09', observation('2026-10-30T02:00:00.000Z'))
    store.append('2027-01-27', observation('2026-10-30T02:00:00.000Z'))
    expect(store.list('2026-12-09', 10)).toHaveLength(1)
    expect(store.list('2027-01-27', 10)).toHaveLength(1)
    expect(store.list('2026-12-09', 0)).toEqual([])
  })
})
