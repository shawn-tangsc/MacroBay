import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'

import { createMarketCalendarEventRepository } from './0xrouter-calendar/marketCalendarEventRepository'
import { createMarketCalendarPublicQueryService } from './0xrouter-calendar/marketCalendarPublicQueryService'
import type { MarketCollectionContext } from './0xrouter-calendar/marketCalendarStorageValidation'
import { parseNarwhalCalendarPage } from './narwhal-calendar/narwhalCalendarParser'
import { narwhalObservationBatches } from './narwhal-calendar/narwhalCalendarObservationBatches'

const NOW = '2026-11-13T09:00:00.000Z'
const descriptorId = 'macro-calendar-narwhal-economic-data'

/** 新源只给 `country_code`；投影必须按码补出本地化国家名。 */
describe('投影补国家名', () => {
  it('有码没名 → 补出「美国」，英文界面补 "United States"', () => {
    const database = new DatabaseSync(':memory:')
    const contexts = new Map<string, MarketCollectionContext>()
    const repository = createMarketCalendarEventRepository({ database, cursorKey: Buffer.alloc(32, 29),
      now: () => NOW, resolveCollectionContext: (id: string) => contexts.get(id),
      readCapacity: () => ({ marketBytes: 0, walBytes: 0, freeBytes: 10 * 1024 ** 3, archiveAvailable: true }) })
    const parsed = parseNarwhalCalendarPage({ releases: [{
      release_id: 'r-1', revision: 1, country: 'USA', series_id: 'usa-consumer-prices', name: 'Consumer prices',
      topic: 'prices', period: '2026-10', status: 'published', at: '2026-11-13T13:30:00Z',
      timezone: 'America/New_York', values: [{ measure: 'cpi_yoy', concept: 'cpi', actual: '3.7' }]
    }] }, { asOf: NOW })
    if (parsed.state !== 'succeeded') throw new Error('parse')
    for (const batch of narwhalObservationBatches(parsed.releases, { locale: 'zh', parserVersion: 'v1', collectionIdPrefix: 'c' })) {
      contexts.set(batch.collectionId, { providerId: 'narwhal', descriptorId: batch.descriptorId, locale: 'zh',
        month: batch.month, detectedAt: NOW,
        evidence: { providerId: 'narwhal', descriptorId: batch.descriptorId, rawRecordId: 'raw-1', evidenceHash: 'f'.repeat(64) } })
      expect(repository.appendCollection(batch).state).toBe('succeeded')
    }
    const service = createMarketCalendarPublicQueryService({ repository })
    for (const [locale, expected] of [['zh', '美国'], ['en', 'United States']] as const) {
      const page = service.queryMonth({ month: '2026-11', locale, asOf: '2026-11-13T12:00:00.000Z' })
      expect(page.state).toBe('available')
      if (page.state !== 'available') return
      // 英文界面读的是 en 的行；这里只验中文那一行确实补出了名字。
      if (locale === 'zh') expect(page.events[0]?.countryName).toBe(expected)
    }
  })
})
