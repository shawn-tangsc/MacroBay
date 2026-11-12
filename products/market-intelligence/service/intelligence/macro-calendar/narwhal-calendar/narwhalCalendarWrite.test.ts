import { describe, expect, it, vi } from 'vitest'

import { createMacroCalendarRepository } from '../macroCalendarRepository'
import { createNarwhalPageFetcher, narwhalCalendarUrl, toPageResponse } from './narwhalCalendarHttp'
import { firstPublishedKey, ingestNarwhalReleases } from './narwhalCalendarIngest'
import { parseNarwhalCalendarPage } from './narwhalCalendarParser'

const release = (overrides: Record<string, unknown> = {}) => ({
  release_id: 'rel-nfp', at: '2026-11-06T13:30:00Z', timezone: 'America/New_York',
  series_id: 'usa-payrolls', name: 'Payroll employment', country: 'USA', status: 'published',
  values: [{ measure: 'nonfarm_payrolls_change', previous: '29', actual: '165' }],
  ...overrides
})

const parsed = (entries: unknown[]) => {
  const result = parseNarwhalCalendarPage({ releases: entries }, { asOf: '2026-11-13T00:00:00Z' })
  if (result.state !== 'succeeded') throw new Error('expected a parsed page')
  return result.releases
}

describe('ingest into the calendar tables', () => {
  it('writes one row per release and keeps the first published previous even after a revision', () => {
    const repository = createMacroCalendarRepository({ filePath: ':memory:' })
    try {
      const first = ingestNarwhalReleases({ releases: parsed([release()]), detectedAt: '2026-11-06T14:00:00Z', recordedAt: '2026-11-06T14:00:00Z' }, repository)
      expect(first).toEqual({ releases: 1, firstPublishedCaptured: 1 })

      // 来源后来把上期 29 修订成 60，并补上 actual：发布行跟着变，快照不许变。
      ingestNarwhalReleases({
        releases: parsed([release({ values: [{ measure: 'nonfarm_payrolls_change', previous: '60', actual: '165' }] })]),
        detectedAt: '2026-11-13T14:00:00Z', recordedAt: '2026-11-13T14:00:00Z'
      }, repository)

      const rows = repository.listReleaseRows({ countryCode: 'USA', scheduledDate: '2026-11-06' })
      expect(rows).toHaveLength(1)
      expect(rows[0]!.values[0]!.previous).toBe('60')
      expect(repository.readFirstPublished(firstPublishedKey('rel-nfp', 'nonfarm_payrolls_change'))?.firstPrevious).toBe('29')
    } finally { repository.close() }
  })

  it('does not write an empty snapshot when the source has no previous yet', () => {
    const repository = createMacroCalendarRepository({ filePath: ':memory:' })
    try {
      const result = ingestNarwhalReleases({
        releases: parsed([release({ values: [{ measure: 'nonfarm_payrolls_change' }] })]),
        detectedAt: '2026-11-06T14:00:00Z', recordedAt: '2026-11-06T14:00:00Z'
      }, repository)
      expect(result.firstPublishedCaptured).toBe(0)
      // 读不到 ≠ 是 0：这里必须 undefined，界面才会说「无法确认首发布值」。
      expect(repository.readFirstPublished(firstPublishedKey('rel-nfp', 'nonfarm_payrolls_change'))).toBeUndefined()
    } finally { repository.close() }
  })

  it('keeps an indicative release without a minute-level instant', () => {
    const repository = createMacroCalendarRepository({ filePath: ':memory:' })
    try {
      ingestNarwhalReleases({
        releases: parsed([release({ release_id: 'rel-ind', date_basis: 'indicative' })]),
        detectedAt: '2026-11-06T14:00:00Z', recordedAt: '2026-11-06T14:00:00Z'
      }, repository)
      const [row] = repository.listReleaseRows({ countryCode: 'USA', scheduledDate: '2026-11-06' })
      expect(row!.dateBasis).toBe('indicative')
      expect(row!.scheduledAt).toBeUndefined()
    } finally { repository.close() }
  })
})

describe('narwhal http mapping', () => {
  it('uses a repeated countries parameter, never a comma list', () => {
    const url = narwhalCalendarUrl({ startDate: '2026-11-01', endDate: '2026-11-30', countries: ['USA', 'DEU'] })
    expect(url).toContain('countries=USA&countries=DEU')
    expect(url).not.toContain('USA%2CDEU')
  })

  it('reads the rate-limit headers into remaining and reset milliseconds', () => {
    expect(toPageResponse({ status: 200, headers: { 'x-ratelimit-remaining': '3', 'x-ratelimit-reset': '2' }, body: { releases: [] } }))
      .toMatchObject({ state: 'page', remaining: 3, resetInMs: 2_000 })
  })

  it('sends no request at all when the key is missing', async () => {
    const request = vi.fn()
    const fetcher = createNarwhalPageFetcher(request, () => undefined)
    expect(await fetcher({ startDate: '2026-11-01', endDate: '2026-11-30', countries: ['USA'] })).toEqual({ state: 'http', status: 401 })
    expect(request).not.toHaveBeenCalled()
  })

  it('never puts the key in the URL — it rides on the Authorization header', async () => {
    const request = vi.fn(async () => ({ status: 200, headers: {}, body: { releases: [] } }))
    const fetcher = createNarwhalPageFetcher(request, () => 'secret-key')
    await fetcher({ startDate: '2026-11-01', endDate: '2026-11-30', countries: ['USA'] })
    const [call] = request.mock.calls[0] as unknown as [{ url: string; headers: Record<string, string> }]
    expect(call.url).not.toContain('secret-key')
    expect(call.headers.Authorization).toBe('Bearer secret-key')
  })
})
