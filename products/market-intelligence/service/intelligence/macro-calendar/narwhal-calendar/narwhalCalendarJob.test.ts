import { describe, expect, it, vi } from 'vitest'

import {
  createNarwhalCalendarJobHandler, narwhalCalendarSweepPolicy, narwhalCalendarTickPolicy
} from './narwhalCalendarJob'

const runtimeWith = (result: unknown) => ({
  run: vi.fn(async () => result)
} as unknown as Parameters<typeof createNarwhalCalendarJobHandler>[0]['runtime'])

const succeeded = { collector: { state: 'completed', pages: 1, releases: 5 }, firstPublishedCaptured: 9 }

describe('narwhal calendar jobs', () => {
  it('tick sweeps only UTC today so a fresh release shows up within the half hour', async () => {
    const runtime = runtimeWith(succeeded)
    const handler = createNarwhalCalendarJobHandler({ runtime, now: () => Date.parse('2026-11-13T23:30:00Z'), mode: 'tick' })
    const outcome = await handler()
    expect(runtime.run).toHaveBeenCalledWith({ startDate: '2026-11-13', endDate: '2026-11-13', countries: ['USA'] })
    expect(outcome).toMatchObject({ state: 'succeeded', releases: 5 })
  })

  it('sweep covers the next 30 days — future schedule, not history', async () => {
    const runtime = runtimeWith(succeeded)
    const handler = createNarwhalCalendarJobHandler({ runtime, now: () => Date.parse('2026-11-13T00:00:00Z'), mode: 'sweep' })
    await handler()
    expect(runtime.run).toHaveBeenCalledWith({ startDate: '2026-11-13', endDate: '2026-12-12', countries: ['USA'] })
  })

  it('keeps both definitions: 30-minute tick and daily sweep', () => {
    expect(narwhalCalendarTickPolicy.intervalMs).toBe(30 * 60 * 1_000)
    expect(narwhalCalendarSweepPolicy.intervalMs).toBe(24 * 60 * 60 * 1_000)
    expect(narwhalCalendarTickPolicy.definitionId).not.toBe(narwhalCalendarSweepPolicy.definitionId)
  })

  it('reports the collector failure code instead of pretending the sweep ran', async () => {
    const runtime = runtimeWith({ collector: { state: 'failed', failureCode: 'credential-not-configured', pagesRead: 0 }, firstPublishedCaptured: 0 })
    const handler = createNarwhalCalendarJobHandler({ runtime, now: () => Date.parse('2026-11-13T00:00:00Z'), mode: 'tick' })
    expect(await handler()).toMatchObject({ state: 'failed', failureCode: 'credential-not-configured' })
  })
})
