import { describe, expect, it, vi } from 'vitest'

import { createMacroCalendarRepository } from '../macroCalendarRepository'
import { firstPublishedKey } from './narwhalCalendarIngest'
import { createNarwhalCalendarRuntime } from './narwhalCalendarRuntime'
import type { NarwhalHttpResult } from './narwhalCalendarHttp'

const page = (overrides: Record<string, unknown> = {}): NarwhalHttpResult => ({
  status: 200,
  headers: { 'x-ratelimit-remaining': '7', 'x-ratelimit-reset': '1' },
  body: {
    releases: [{
      release_id: 'rel-nfp', at: '2026-11-06T13:30:00Z', timezone: 'America/New_York',
      series_id: 'usa-payrolls', name: 'Payroll employment', country: 'USA', status: 'published',
      values: [{ measure: 'nonfarm_payrolls_change', previous: '29', actual: '165' }],
      ...overrides
    }]
  }
})

const runtimeWith = (responses: NarwhalHttpResult[]) => {
  const queue = [...responses]
  const repository = createMacroCalendarRepository({ filePath: ':memory:' })
  const runtime = createNarwhalCalendarRuntime({
    request: vi.fn(async () => queue.shift() ?? { status: 500, headers: {}, body: null }),
    readApiKey: () => 'test-key',
    repository,
    now: () => Date.parse('2026-11-06T14:00:00Z'),
    sleep: vi.fn(async () => undefined)
  })
  return { runtime, repository }
}

describe('narwhal calendar runtime (real path: http → loop → parse → ingest)', () => {
  it('captures 29 on the first collection and keeps it after the source revises previous to 60', async () => {
    const { runtime, repository } = runtimeWith([
      page(),
      page({ values: [{ measure: 'nonfarm_payrolls_change', previous: '60', actual: '165' }] })
    ])
    try {
      const first = await runtime.run({ startDate: '2026-11-06', endDate: '2026-11-06', countries: ['USA'] })
      expect(first.collector).toMatchObject({ state: 'completed', pages: 1, releases: 1 })
      expect(first.firstPublishedCaptured).toBe(1)

      // 同一期第二次采集：来源把 previous 修订成 60（真实的修订路径，不是直接调仓库）。
      const second = await runtime.run({ startDate: '2026-11-06', endDate: '2026-11-06', countries: ['USA'] })
      expect(second.firstPublishedCaptured).toBe(0)

      const rows = repository.listReleaseRows({ countryCode: 'USA', scheduledDate: '2026-11-06' })
      expect(rows).toHaveLength(1)
      expect(rows[0]!.values[0]!.previous).toBe('60')
      expect(repository.readFirstPublished(firstPublishedKey('rel-nfp', 'nonfarm_payrolls_change'))?.firstPrevious).toBe('29')
    } finally { repository.close() }
  })

  it('writes nothing when the key is missing — the loop never reaches the network', async () => {
    const request = vi.fn()
    const repository = createMacroCalendarRepository({ filePath: ':memory:' })
    const runtime = createNarwhalCalendarRuntime({ request, readApiKey: () => undefined, repository, sleep: vi.fn(async () => undefined) })
    try {
      const result = await runtime.run({ startDate: '2026-11-06', endDate: '2026-11-06', countries: ['USA'] })
      expect(result.collector).toMatchObject({ state: 'failed', failureCode: 'credential-not-configured' })
      expect(request).not.toHaveBeenCalled()
      expect(repository.listReleaseRows({ countryCode: 'USA', scheduledDate: '2026-11-06' })).toEqual([])
    } finally { repository.close() }
  })
})
