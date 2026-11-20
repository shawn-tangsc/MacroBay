import { describe, expect, it, vi } from 'vitest'

import { collectNarwhalCalendar, type NarwhalPageResponse } from './narwhalCalendarCollector'
import { toPageResponse } from './narwhalCalendarHttp'

const entry = (id: string) => ({
  release_id: id, at: '2026-11-13T13:30:00Z', timezone: 'America/New_York',
  series_id: 'usa-cpi', name: 'Consumer prices', country: 'USA', status: 'scheduled',
  values: [{ measure: 'cpi_yoy', actual: '3.9' }]
})

const deps = (responses: NarwhalPageResponse[], overrides: Partial<Parameters<typeof collectNarwhalCalendar>[1]> = {}) => {
  const queue = [...responses]
  const sleep = vi.fn(async () => undefined)
  const onReleases = vi.fn()
  return {
    sleep, onReleases,
    value: {
      readApiKey: () => 'test-key',
      fetchPage: vi.fn(async () => queue.shift() ?? { state: 'transport' as const }),
      onReleases, sleep,
      ...overrides
    }
  }
}

const input = { startDate: '2026-11-01', endDate: '2026-11-30', countries: ['USA'] }

describe('narwhal calendar collector', () => {
  it('sends no request at all when no key is configured — 401 cannot tell us apart otherwise', async () => {
    const fetchPage = vi.fn()
    const result = await collectNarwhalCalendar(input, { readApiKey: () => undefined, fetchPage, onReleases: vi.fn(), sleep: vi.fn() })
    expect(result).toMatchObject({ state: 'failed', failureCode: 'credential-not-configured' })
    expect(fetchPage).not.toHaveBeenCalled()
  })

  it('follows next_cursor to the end instead of guessing from counts', async () => {
    const { value, onReleases } = deps([
      { state: 'page', body: { releases: [entry('a')], next_cursor: 'c2' } },
      { state: 'page', body: { releases: [entry('b')] } }
    ])
    const result = await collectNarwhalCalendar(input, value)
    expect(result).toEqual({ state: 'completed', pages: 2, releases: 2 })
    expect(onReleases).toHaveBeenCalledTimes(2)
  })

  it('waits out the reset when the page reports remaining at or below 2', async () => {
    const { value, sleep } = deps([
      { state: 'page', body: { releases: [], next_cursor: 'c2' }, remaining: 1, resetInMs: 5_000 },
      { state: 'page', body: { releases: [] } }
    ])
    await collectNarwhalCalendar(input, value)
    expect(sleep).toHaveBeenCalledWith(5_000)
  })

  it('maps 401 / 402 to their own codes', async () => {
    for (const [status, code] of [[401, 'credential-invalid'], [402, 'credits-exhausted']] as const) {
      const { value } = deps([{ state: 'http', status }])
      expect(await collectNarwhalCalendar(input, value)).toMatchObject({ state: 'failed', failureCode: code })
    }
  })

  it('retries a 429 exactly once, waiting the Retry-After the source actually sends', async () => {
    // 实测形状（2026-11-13，20 页 / 200ms 时打出来的）：
    //   type …/rate-limit-exceeded, status 429, Retry-After: 1, x-ratelimit-remaining: 0
    // 裸状态码测不出「用 Retry-After 退避」这件事，所以这里连头一起造。
    const measured = toPageResponse({
      status: 429,
      headers: { 'retry-after': '1', 'x-ratelimit-remaining': '0' },
      body: { type: 'https://narwhalapi.com/problems/rate-limit-exceeded', status: 429 }
    })
    const sleep = vi.fn(async () => undefined)
    const fetchPage = vi.fn(async () => measured)
    const result = await collectNarwhalCalendar(input, { readApiKey: () => 'k', fetchPage, onReleases: vi.fn(), sleep })
    expect(result).toMatchObject({ state: 'failed', failureCode: 'rate-limited' })
    expect(fetchPage).toHaveBeenCalledTimes(2)
    expect(sleep).toHaveBeenCalledWith(1_000)
  })

  it('stops at the page budget instead of looping forever', async () => {
    const fetchPage = vi.fn(async () => ({ state: 'page' as const, body: { releases: [], next_cursor: 'again' } }))
    const result = await collectNarwhalCalendar(input, { readApiKey: () => 'k', fetchPage, onReleases: vi.fn(), sleep: vi.fn(async () => undefined) })
    expect(result).toMatchObject({ state: 'failed', failureCode: 'page-budget-exhausted', pagesRead: 30 })
  })
})
