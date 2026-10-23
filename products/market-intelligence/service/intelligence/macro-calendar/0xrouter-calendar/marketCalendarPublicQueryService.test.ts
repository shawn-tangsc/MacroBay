import { existsSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import { createMarketCalendarEventRepository } from './marketCalendarEventRepository'
import { parseZeroXRouterCentralBankActivities } from './zeroXRouterCentralBankActivitiesParser'
import { parseZeroXRouterEconomicData } from './zeroXRouterEconomicDataParser'

const databases: DatabaseSync[] = []
afterEach(() => databases.splice(0).forEach(db => db.close()))
const scope = { providerId: '0xrouter', descriptorId: 'macro-calendar-0xrouter-economic-data', locale: 'zh', month: '2026-09' }
const centralBankDescriptor = 'macro-calendar-0xrouter-central-bank-activities'
const asOf = '2026-09-10T02:00:00.000Z'
const query = { month: scope.month, locale: 'zh', asOf }
async function setup(readRefreshAttempt?: (scope: unknown, kind: string) => { state: 'failed'; attemptedAt: string } | undefined) {
  expect(existsSync(new URL('./marketCalendarPublicQueryService.ts', import.meta.url))).toBe(true)
  const { createMarketCalendarPublicQueryService } = await import('./marketCalendarPublicQueryService')
  const database = new DatabaseSync(':memory:'); databases.push(database)
  let detectedAt = '2026-09-10T00:00:00.000Z'
  let descriptorId: string = scope.descriptorId
  const repository = createMarketCalendarEventRepository({ database, cursorKey: Buffer.alloc(32, 1),
    resolveCollectionContext: () => ({ ...scope, descriptorId, detectedAt, evidence: { providerId: scope.providerId,
      descriptorId, rawRecordId: 'private-raw-id', evidenceHash: 'a'.repeat(64) } }),
    now: () => detectedAt, readCapacity: () => ({ marketBytes: 0, walBytes: 0, freeBytes: 10 * 1024 ** 3, archiveAvailable: true }) })
  const append = (id: string, count: number, title = 'Derived event', country?: { code: string; name: string }) => {
    descriptorId = scope.descriptorId
    const data = Array.from({ length: count }, (_, i) => ({ calendarId: 'derived', id: i + 1, calendarName: title,
      locale: 'zh', star: 3, pubTimestamp: Date.parse(asOf), estimateValue: 0, preValue: null, pubValue: '3',
      ...(country ? { countryCode: country.code, countryName: country.name } : {}) }))
    expect(repository.appendCollection({ ...scope, collectionId: id, parserVersion: 'derived',
      parseResult: parseZeroXRouterEconomicData({ code: 200, msg: '', data }, 'zh') }).state).toBe('succeeded')
  }
  const appendCentralBank = (id: string, count: number) => {
    descriptorId = centralBankDescriptor
    const data = Array.from({ length: count }, (_, i) => ({ calendarId: 'derived-central-bank', id: i + 1,
      calendarName: 'Derived activity', locale: 'zh', star: 2, pubTimestamp: Date.parse(asOf) }))
    expect(repository.appendCollection({ ...scope, descriptorId: centralBankDescriptor, collectionId: id,
      parserVersion: 'derived', parseResult: parseZeroXRouterCentralBankActivities({ code: 200, msg: '', data }, 'zh') }).state).toBe('succeeded')
  }
  return { service: createMarketCalendarPublicQueryService({ repository, readRefreshAttempt }), repository, database, append, appendCentralBank,
    setTime: (value: string) => { detectedAt = value } }
}
describe('market public paging independent of official 200 item cap', () => {
  it('projects a failed latest attempt alongside the unchanged successful snapshot and real zero value', async () => {
    const h = await setup((requested, kind) => JSON.stringify(requested) === JSON.stringify({ month: '2026-09', locale: 'zh' }) && kind === 'economic-indicator'
      ? { state: 'failed', attemptedAt: '2026-09-10T01:00:00.000Z' } : undefined)
    h.append('old', 1)
    expect(h.service.queryMonth(query)).toMatchObject({ state: 'available', events: [{ consensus: { displayValue: '0' }, providerActual: { displayValue: '3' } }],
      sources: [{ status: 'success', sourceObservedAt: '2026-09-10T00:00:00.000Z', latestAttempt: { state: 'failed', attemptedAt: '2026-09-10T01:00:00.000Z' } }, {}, {}] })
    const earlier = h.service.queryMonth({ ...query, asOf: '2026-09-10T00:30:00.000Z' })
    expect(earlier.state === 'available' && earlier.sources[0]?.latestAttempt).toBeUndefined()
    const other = h.service.queryMonth({ ...query, locale: 'en' })
    expect(other.state === 'available' && other.sources[0]?.latestAttempt).toBeUndefined()
  })
  it('provides query-scoped evidence only to the main observer, never in the public page', async () => {
    const h = await setup(); h.append('first', 1)
    const observed: unknown[] = []
    const result = h.service.queryMonth(query, (event, evidence) => observed.push({ event, evidence }))
    expect(observed).toHaveLength(1)
    expect(observed[0]).toMatchObject({ evidence: { providerId: '0xrouter', descriptorId: scope.descriptorId,
      locale: 'zh', evidenceHash: 'a'.repeat(64), sourceEventId: JSON.stringify(['derived', 1]), indicatorId: null } })
    expect(JSON.stringify(result)).not.toMatch(/evidenceHash|sourceEventId|collectionId|indicatorId/)
    const second: unknown[] = []
    h.setTime('2026-09-10T01:00:00.000Z'); h.append('second', 1)
    h.service.queryMonth(query, (_event, evidence) => second.push(evidence))
    expect(second).toHaveLength(1)
  })
  it('keeps one stable observation key and one stored row while an unchanged resample arrives', async () => {
    const h = await setup(); h.append('first', 1)
    const before = h.service.queryMonth(query)
    expect(before).toMatchObject({ state: 'available' })
    if (before.state !== 'available') throw new Error('expected page')
    h.setTime('2026-09-10T01:00:00.000Z'); h.append('second', 1, 'New batch')
    const after = h.service.queryMonth(query)
    expect(after).toMatchObject({ state: 'available' })
    if (after.state !== 'available') throw new Error('expected page')

    const observationKey = JSON.stringify(['0xrouter', scope.descriptorId, 'zh', JSON.stringify(['derived', 1])])
    expect(before.events[0]?.observationKey).toBe(observationKey)
    expect(after.events[0]?.observationKey).toBe(observationKey)
    // The resample carries the same values, so it stored no second row: the projection is the
    // same event, and the deduplicated batch is remembered in the last-seen ledger instead.
    expect(h.database.prepare('select count(*) as n from mi_macro_calendar_market_event_observations').get()?.n).toBe(1)
    expect(after.events[0]?.eventKey).toBe(before.events[0]?.eventKey)
    expect(h.database.prepare('select count(*) as n from mi_macro_calendar_market_observation_ledger').get()?.n).toBe(1)
    expect(before.events[0]?.observationKey).not.toContain('observation_id')
  })
  it('reads all 251 observations with frozen selection while another collection arrives', async () => {
    const h = await setup(); h.append('first', 251)
    let page = h.service.queryMonth(query)
    expect(page.state).toBe('available')
    if (page.state !== 'available') throw new Error('expected page')
    expect(page.events).toHaveLength(100)
    const first = page
    h.setTime('2026-09-10T01:00:00.000Z'); h.append('second', 1, 'New batch')
    const events = [...page.events]
    while (page.nextCursor) {
      page = h.service.queryMonth({ ...query, cursor: page.nextCursor })
      if (page.state !== 'available') throw new Error('expected continuation')
      expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThanOrEqual(256 * 1024)
      events.push(...page.events)
    }
    expect(events).toHaveLength(251)
    expect(new Set(events.map(item => item.eventKey)).size).toBe(251)
    expect(events.every(item => item.title === 'Derived event')).toBe(true)
    expect(events[0]).toMatchObject({ countryCode: null, consensus: { displayValue: '0' }, providerPrevious: null, providerActual: { displayValue: '3' } })
    expect(JSON.stringify(first)).not.toMatch(/private-raw-id|collection_id|source_event_id|evidence_hash|parser_version|candidate_key/)
    // The later batch re-sampled one known identity with an unchanged value, so it stored no
    // row: the current projection of that identity is still the batch that first stored it.
    const resampledKey = JSON.stringify(['0xrouter', scope.descriptorId, 'zh', JSON.stringify(['derived', 1])])
    const resampled: Array<{ observationKey?: string; sourceObservedAt: string; title: string }> = []
    let cursor: string | undefined
    for (let page = 0; page < 5; page++) {
      const next = h.service.queryMonth({ ...query, ...(cursor ? { cursor } : {}) })
      if (next.state !== 'available') throw new Error('expected a page')
      resampled.push(...next.events.map((item) => ({ observationKey: item.observationKey, sourceObservedAt: item.sourceObservedAt, title: item.title })))
      cursor = next.nextCursor
      if (!cursor) break
    }
    expect(resampled).toHaveLength(251)
    expect(resampled.filter((item) => item.observationKey === resampledKey)).toEqual([
      { observationKey: resampledKey, sourceObservedAt: '2026-09-10T00:00:00.000Z', title: 'Derived event' }
    ])
    expect(h.database.prepare('select count(*) as n from mi_macro_calendar_market_event_observations where collection_id = ?').get('second')?.n).toBe(0)
    expect(h.service.queryMonth({ ...query, locale: 'en', cursor: first.nextCursor }).state).toBe('unavailable')
    // Before the later batch existed, the same 251 observations are reachable.
    const early = h.service.queryMonth({ ...query, asOf: '2026-09-10T00:30:00.000Z' })
    if (early.state !== 'available') throw new Error('expected an early page')
    expect(early.events).toHaveLength(100)
    expect(early.events[0]?.sourceObservedAt).toBe('2026-09-10T00:00:00.000Z')
  })
  it('keeps the last observed sample when the newest batch stored no rows, isolates locale, and reports all-skipped', async () => {
    const h = await setup(); h.append('first', 1)
    expect(h.service.queryMonth({ ...query, locale: 'en' })).toMatchObject({ state: 'available', events: [] })
    h.setTime('2026-09-10T01:00:00.000Z'); h.append('empty', 0)
    // The newest batch is empty, which is a statement about this attempt, not evidence that
    // the events stopped existing: the last stored sample is still the current projection.
    expect(h.service.queryMonth(query)).toMatchObject({ state: 'available', events: [{ title: 'Derived event' }],
      sources: [{ status: 'success-empty' }, {}, {}] })
    h.database.prepare("update mi_macro_calendar_market_event_collections set status='all-skipped', input_count=1, skipped_count=1 where collection_id='empty'").run()
    expect(h.service.queryMonth(query)).toMatchObject({ state: 'available', events: [{ title: 'Derived event' }],
      sources: [{ status: 'all-skipped' }, {}, {}] })
  })
  it('projects the persisted country name without exposing storage fields', async () => {
    const h = await setup(); h.append('country', 1, 'China event')
    h.database.prepare("update mi_macro_calendar_market_event_observations set country_code = 'CHN', country_name = '中国' where collection_id = 'country'").run()
    const page = h.service.queryMonth(query)
    expect(page).toMatchObject({ state: 'available', events: [{ countryCode: 'CHN', countryName: '中国' }] })
    expect(JSON.stringify(page)).not.toMatch(/country_name|observation_id|source_event_id/)
  })
  it('rejects caller identifiers and malformed storage projections safely', async () => {
    const h = await setup(); h.append('first', 1)
    expect(h.service.queryMonth({ ...query, collectionId: 'first' }).state).toBe('unavailable')
    h.database.exec("update mi_macro_calendar_market_event_observations set consensus_json='{}'")
    expect(h.service.queryMonth(query)).toEqual({ state: 'unavailable', failureCode: 'query-unavailable' })
  })
  it('resumes a partly read storage page at a descriptor boundary instead of skipping its tail', async () => {
    const h = await setup()
    h.append('economic', 150)
    h.appendCentralBank('central-bank', 150)
    const events: { eventKey: string }[] = []
    let page = h.service.queryMonth(query)
    for (let index = 0; index < 20; index++) {
      expect(page.state).toBe('available')
      if (page.state !== 'available') throw new Error('expected a page')
      events.push(...page.events)
      if (!page.nextCursor) break
      page = h.service.queryMonth({ ...query, cursor: page.nextCursor })
    }
    // 150 economic events fill one page and half of the next; the remaining 50 are emitted with
    // the first 50 of the 150 central-bank events. Advancing the storage cursor when the page
    // bound was hit half-way through the central-bank page used to drop the other 50 of that
    // page, and the tail of the storage page was never re-read.
    expect(events).toHaveLength(300)
    expect(new Set(events.map((event) => event.eventKey)).size).toBe(300)
  })
})
