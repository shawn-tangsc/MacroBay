import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'

import { createMarketCalendarEventRepository } from './marketCalendarEventRepository'
import { createMarketCalendarPublicQueryService } from './marketCalendarPublicQueryService'
import { parseZeroXRouterEconomicData } from './zeroXRouterEconomicDataParser'
import { parseNarwhalCalendarPage } from '../narwhal-calendar/narwhalCalendarParser'
import { narwhalObservationBatches } from '../narwhal-calendar/narwhalCalendarObservationBatches'
import type { MarketCollectionContext } from './marketCalendarStorageValidation'

const NOW = '2026-11-13T09:00:00.000Z'
const QUERY = { month: '2026-11', locale: 'zh' as const, asOf: '2026-11-13T12:00:00.000Z' }

function repository() {
  const database = new DatabaseSync(':memory:')
  const contexts = new Map<string, MarketCollectionContext>()
  const repo = createMarketCalendarEventRepository({
    database, cursorKey: Buffer.alloc(32, 3), now: () => NOW,
    resolveCollectionContext: (id: string) => contexts.get(id),
    readCapacity: () => ({ marketBytes: 0, walBytes: 0, freeBytes: 10 * 1024 ** 3, archiveAvailable: true })
  })
  return { database, repo, contexts }
}

describe('公开投影把身份搬出来，不重算', () => {
  it('Narwhal 的经济指标行带出 metric_key', () => {
    const { repo, contexts } = repository()
    const parsed = parseNarwhalCalendarPage({ releases: [{
      release_id: 'r-cpi', revision: 1, country: 'USA', series_id: 'usa-consumer-prices', name: 'Consumer prices',
      topic: 'prices', period: '2026-10', status: 'released', at: '2026-11-13T13:30:00Z', timezone: 'America/New_York',
      values: [{ measure: 'cpi_yoy', concept: 'cpi', actual: '3.7' }]
    }] }, { asOf: NOW })
    if (parsed.state !== 'succeeded') throw new Error('parse')
    for (const batch of narwhalObservationBatches(parsed.releases, { locale: 'zh', parserVersion: 'v1', collectionIdPrefix: 'x' })) {
      contexts.set(batch.collectionId, { providerId: 'narwhal', descriptorId: batch.descriptorId, locale: 'zh',
        month: batch.month, detectedAt: NOW,
        evidence: { providerId: 'narwhal', descriptorId: batch.descriptorId, rawRecordId: 'raw-1', evidenceHash: 'a'.repeat(64) } })
      expect(repo.appendCollection(batch).state).toBe('succeeded')
    }
    const page = createMarketCalendarPublicQueryService({ repository: repo }).queryMonth(QUERY)
    expect(page.state).toBe('available')
    if (page.state !== 'available') return
    expect(page.events[0]?.eventNameKey).toBe('US.CPI.NSA.YOY')
  })

  it('旧源没有身份的行不带这个字段——不填空串、不现算', () => {
    const { repo, contexts } = repository()
    const descriptorId = 'macro-calendar-0xrouter-economic-data'
    const parseResult = parseZeroXRouterEconomicData({ code: 200, msg: '', data: [{
      calendarId: 'derived', id: 7, calendarName: 'Derived event', locale: 'zh', star: 3,
      pubTimestamp: Date.parse('2026-11-13T13:30:00Z'), estimateValue: 1, preValue: null, pubValue: '2'
    }] }, 'zh')
    contexts.set('old-1', { providerId: '0xrouter', descriptorId, locale: 'zh', month: '2026-11', detectedAt: NOW,
      evidence: { providerId: '0xrouter', descriptorId, rawRecordId: 'raw-old', evidenceHash: 'b'.repeat(64) } })
    expect(repo.appendCollection({ providerId: '0xrouter', descriptorId, locale: 'zh', month: '2026-11',
      collectionId: 'old-1', parserVersion: 'derived', parseResult }).state).toBe('succeeded')
    const page = createMarketCalendarPublicQueryService({ repository: repo }).queryMonth(QUERY)
    expect(page.state).toBe('available')
    if (page.state !== 'available') return
    expect(Object.hasOwn(page.events[0] ?? {}, 'eventNameKey')).toBe(false)
  })
})
