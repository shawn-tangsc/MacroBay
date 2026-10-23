import { expect, it, vi } from 'vitest'
import { macroCalendarEventContextReaders } from './macroCalendarEventContextReaders'

const query = { eventKey: 'US.CPI', month: '2026-09', asOf: '2026-10-11T09:00:00.000Z' }

function service(overrides: Record<string, unknown> = {}) {
  return {
    queryMacroEconomicCalendarMonth: vi.fn(async () => ({ state: 'available', month: '2026-09', events: [], sources: [] })),
    queryMarketCalendarMonth: vi.fn(() => ({ state: 'available', month: '2026-09', locale: 'zh', asOf: query.asOf, events: [], sources: [] })),
    ...overrides
  } as never
}

it("reads the event's own month, not the asOf month", async () => {
  // An event carried over from the previous month would otherwise be looked for in the wrong one.
  const reads = macroCalendarEventContextReaders(service())
  await reads.readFacts(query)
  expect(reads.isVisible('2026-10-01T00:00:00.000Z', query.asOf)).toBe(true)
  expect(reads.isVisible('2026-10-12T00:00:00.000Z', query.asOf)).toBe(false)
})

it('shares one read between the two ports', async () => {
  const fake = service()
  const reads = macroCalendarEventContextReaders(fake)
  await Promise.all([reads.readFacts(query), reads.readEvidenceRefs(query)])
  expect((fake as never as { queryMacroEconomicCalendarMonth: ReturnType<typeof vi.fn> }).queryMacroEconomicCalendarMonth).toHaveBeenCalledTimes(1)
  // A second question in the same month reuses it as well.
  await reads.readFacts(query)
  expect((fake as never as { queryMacroEconomicCalendarMonth: ReturnType<typeof vi.fn> }).queryMacroEconomicCalendarMonth).toHaveBeenCalledTimes(1)
  expect((fake as never as { queryMacroEconomicCalendarMonth: ReturnType<typeof vi.fn> }).queryMacroEconomicCalendarMonth)
    .toHaveBeenCalledWith(expect.objectContaining({ month: '2026-09', asOf: query.asOf }))
})

it('still reads the provider route when the official query is not wired', async () => {
  const fake = service({ queryMacroEconomicCalendarMonth: undefined })
  const reads = macroCalendarEventContextReaders(fake)
  await expect(reads.readFacts(query)).resolves.toEqual([])
  expect((fake as never as { queryMarketCalendarMonth: ReturnType<typeof vi.fn> }).queryMarketCalendarMonth).toHaveBeenCalled()
})
