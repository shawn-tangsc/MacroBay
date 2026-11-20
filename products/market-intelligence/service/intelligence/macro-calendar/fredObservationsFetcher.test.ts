import { describe, expect, it, vi } from 'vitest'

import { createFredObservationsFetcher } from './fredIndicatorYoY'

/**
 * URL 只在这里拼一次，并且**必须过注入的 `fetchText`**——它负责加 `api_key`。
 * 读服务里不碰凭据；这条用例钉住「请求形状」与「缺值不丢行」。
 */
describe('createFredObservationsFetcher', () => {
  it('asks for FRED observations with the pc1 unit and sorts newest first', async () => {
    const fetchText = vi.fn(async () => JSON.stringify({ observations: [{ date: '2026-10-01', value: '.' }, { date: '2026-09-01', value: '3.73768' }, { date: '2026-08-01', value: '3.39655' }] }))
    const rows = await createFredObservationsFetcher(fetchText)({ seriesId: 'CPIAUCNS', units: 'pc1', limit: 3 })
    expect(rows).toEqual([
      { date: '2026-10-01', value: '.' },
      { date: '2026-09-01', value: '3.73768' },
      { date: '2026-08-01', value: '3.39655' }
    ])
    const [url, sourceId] = fetchText.mock.calls[0] as unknown as [string, string]
    expect(sourceId).toBe('fred-rates-liquidity')
    expect(url).toContain('series_id=CPIAUCNS')
    expect(url).toContain('units=pc1')
    expect(url).toContain('sort_order=desc')
    // key 不在这里拼：由 fetchText 注入，URL 里不许出现 api_key。
    expect(url).not.toContain('api_key')
  })

  it('drops rows that are not a date/value pair instead of inventing one', async () => {
    const fetchText = async () => JSON.stringify({ observations: [{ date: '2026-09-01' }, null, { date: '2026-08-01', value: '3.4' }] })
    expect(await createFredObservationsFetcher(fetchText)({ seriesId: 'CPIAUCNS', units: 'pc1', limit: 3 }))
      .toEqual([{ date: '2026-08-01', value: '3.4' }])
  })
})
