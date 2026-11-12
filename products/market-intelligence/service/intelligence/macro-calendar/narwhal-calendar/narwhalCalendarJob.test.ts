import { describe, expect, it, vi } from 'vitest'

import { createNarwhalCalendarJobHandler, narwhalCalendarJobPolicy } from './narwhalCalendarJob'

const runtimeWith = (result: unknown) => ({
  run: vi.fn(async () => result)
} as unknown as Parameters<typeof createNarwhalCalendarJobHandler>[0]['runtime'])

describe('narwhal calendar job handler', () => {
  it('sweeps UTC today and yesterday — the ledger uses UTC, not the reader time zone', async () => {
    const runtime = runtimeWith({ collector: { state: 'completed', pages: 2, releases: 85 }, firstPublishedCaptured: 7 })
    const handler = createNarwhalCalendarJobHandler({ runtime, now: () => Date.parse('2026-11-13T23:30:00Z') })
    const outcome = await handler()
    expect(runtime.run).toHaveBeenCalledWith({ startDate: '2026-11-12', endDate: '2026-11-13', countries: ['USA'] })
    expect(outcome).toMatchObject({ state: 'succeeded', pages: 2, releases: 85, firstPublishedCaptured: 7 })
  })

  it('reports the collector failure code instead of pretending the sweep ran', async () => {
    const runtime = runtimeWith({ collector: { state: 'failed', failureCode: 'credential-not-configured', pagesRead: 0 }, firstPublishedCaptured: 0 })
    const handler = createNarwhalCalendarJobHandler({ runtime, now: () => Date.parse('2026-11-13T00:00:00Z') })
    expect(await handler()).toMatchObject({ state: 'failed', failureCode: 'credential-not-configured' })
  })

  it('keeps a daily interval — a market calendar is swept once a day, not every thirty minutes', () => {
    expect(narwhalCalendarJobPolicy.intervalMs).toBe(24 * 60 * 60 * 1_000)
  })
})
