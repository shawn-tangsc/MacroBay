import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomBytes, randomUUID } from 'node:crypto'
import { afterAll, describe, expect, it } from 'vitest'

import { createMarketCalendarEventRepository, ManualCalendarCapacityPolicy } from './marketCalendarEventRepository'
import { createMarketCalendarPublicQueryService } from './marketCalendarPublicQueryService'
import { parseZeroXRouterEconomicData } from './zeroXRouterEconomicDataParser'

/**
 * Shared-calendar manual admission, measured on a synthetic 525-event month.
 *
 * The fixture is a synthetic response with two CPI rows and 523 generic rows, so the
 * capacity and pagination paths stay covered without copying a provider response.
 * Nothing here touches the network or a credential.
 */
const fixtureUrl = new URL('./fixtures/zeroxrouter-economic-data-zh-2026-10-success.json', import.meta.url)
const descriptorId = 'macro-calendar-0xrouter-economic-data' as const
const month = '2026-10'
// The live shared calendar file on 2026-10-14T15:50Z.
const liveSharedPageCount = 65520
const cpiNames = ['9月未季调消费者物价指数(年率)', '9月未季调核心消费者物价指数(年率)']
const directories: string[] = []

afterAll(() => {
  for (const directory of directories) rmSync(directory, { recursive: true, force: true })
}, 60_000)

/** Zeroblobs stream straight into the file, so a 2 GiB logical footprint costs no RSS. */
function sharedCalendarDatabase(occupancyTable = 'official_pressure'): DatabaseSync {
  const directory = mkdtempSync(join(tmpdir(), 'mc-shared-capacity-'))
  directories.push(directory)
  const database = new DatabaseSync(join(directory, 'macro-calendar.sqlite'))
  database.exec(`create table ${occupancyTable} (payload blob)`)
  return database
}
function growTo(database: DatabaseSync, occupancyTable: string, ceilingBytes: number): void {
  const pageSize = Number(database.prepare('pragma page_size').get()?.page_size)
  const insert = database.prepare(`insert into ${occupancyTable} values (zeroblob(?))`)
  while (Number(database.prepare('pragma page_count').get()?.page_count) * pageSize <= ceilingBytes) insert.run(64 * 1024 * 1024)
}
function logicalBytes(database: DatabaseSync): number {
  return Number(database.prepare('pragma page_count').get()?.page_count) * Number(database.prepare('pragma page_size').get()?.page_size)
}
function repositoryOn(database: DatabaseSync, collectionId: string, capacity: ReturnType<typeof capacityReading>) {
  const scope = { providerId: '0xrouter', descriptorId, locale: 'zh' as const, month }
  const context = { ...scope, detectedAt: '2026-10-14T15:33:33.917Z',
    evidence: { providerId: '0xrouter', descriptorId, rawRecordId: `shared-capacity-${collectionId}`, evidenceHash: 'a'.repeat(64) } }
  return { input: { ...scope, collectionId, parserVersion: '0xrouter-calendar-mc2-v1', parseResult: parsedFixture() },
    repository: createMarketCalendarEventRepository({ database, manualCapacityAdmission: true,
      resolveCollectionContext: id => id === collectionId ? context : undefined,
      readCapacity: () => capacity(database), now: () => '2026-10-14T15:34:00.000Z', cursorKey: randomBytes(32) }) }
}
function capacityReading(database: DatabaseSync) {
  return { marketBytes: logicalBytes(database), walBytes: 0, freeBytes: 64 * 1024 ** 3, archiveAvailable: true }
}
function parsedFixture() {
  const parsed = parseZeroXRouterEconomicData(JSON.parse(readFileSync(fixtureUrl, 'utf8')), 'zh')
  if (parsed.state !== 'succeeded') throw new Error('the captured fixture must parse')
  return parsed
}

describe('shared calendar manual admission against a synthetic 525-event month', () => {
  it('stores both released actuals where the old 256 MiB ceiling rejected the batch', () => {
    // The synthetic fixture carries 3.7% / 2.6% for the two CPI rows.
    const drafts = parsedFixture().drafts.filter(draft => cpiNames.includes(draft.displayName))
    expect(drafts.map(draft => [draft.displayName, draft.providerActual])).toEqual([
      ['9月未季调消费者物价指数(年率)', { displayValue: '3.7%' }],
      ['9月未季调核心消费者物价指数(年率)', { displayValue: '2.6%' }]
    ])

    const database = sharedCalendarDatabase()
    const insert = database.prepare('insert into official_pressure values (zeroblob(?))')
    while (Number(database.prepare('pragma page_count').get()?.page_count) < liveSharedPageCount) insert.run(1024 * 1024)
    // At least the live footprint: this is the exact size at which the release batch returned
    // {"state":"unavailable","failureCode":"storage-pressure"} instead of storing the two values.
    expect(logicalBytes(database)).toBeGreaterThanOrEqual(liveSharedPageCount * 4096)

    const collectionId = randomUUID()
    const { repository, input } = repositoryOn(database, collectionId, capacityReading)
    expect(repository.appendCollection(input)).toMatchObject({ state: 'succeeded', inserted: true })
    expect(database.prepare(`select display_name, provider_actual_json from mi_macro_calendar_market_event_observations
      where collection_id = ? and display_name in (?, ?) order by display_name`).all(collectionId, ...cpiNames)).toEqual([
      { display_name: '9月未季调核心消费者物价指数(年率)', provider_actual_json: '{"displayValue":"2.6%"}' },
      { display_name: '9月未季调消费者物价指数(年率)', provider_actual_json: '{"displayValue":"3.7%"}' }
    ])
    // The accepted ceiling must sit above this footprint, so the same release is never refused again.
    expect(logicalBytes(database)).toBeGreaterThan(liveSharedPageCount * 4096)
    expect(ManualCalendarCapacityPolicy.sharedLogicalBytes).toBeGreaterThan(logicalBytes(database))

    // Read back through the public page boundary: 525 observations exceed one 100-event page,
    // so the values must still be reachable by following the cursor, not just present in SQLite.
    const query = createMarketCalendarPublicQueryService({ repository })
    try {
      const events: { title: string; providerActual: unknown }[] = []
      let cursor: string | undefined
      for (let page = 0; page < 20; page++) {
        const result = query.queryMonth({ month, locale: 'zh', asOf: '2026-10-14T16:00:00.000Z', ...(cursor ? { cursor } : {}) })
        expect(result.state).toBe('available')
        if (result.state !== 'available') throw new Error('expected an available page')
        events.push(...result.events.map(event => ({ title: event.title, providerActual: event.providerActual })))
        cursor = result.nextCursor
        if (!cursor) break
      }
      expect(events.filter(event => cpiNames.includes(event.title))).toEqual([
        { title: '9月未季调核心消费者物价指数(年率)', providerActual: { displayValue: '2.6%' } },
        { title: '9月未季调消费者物价指数(年率)', providerActual: { displayValue: '3.7%' } }
      ])
    } finally { query.dispose(); database.close() }
  }, 120_000)

  it('still fails closed above the accepted shared ceiling and writes nothing at all', () => {
    const database = sharedCalendarDatabase()
    growTo(database, 'official_pressure', ManualCalendarCapacityPolicy.sharedLogicalBytes + 16 * 65536)
    expect(logicalBytes(database)).toBeGreaterThan(ManualCalendarCapacityPolicy.sharedLogicalBytes)
    const occupiedRows = database.prepare('select count(*) as count from official_pressure').get()?.count

    const collectionId = randomUUID()
    const { repository, input } = repositoryOn(database, collectionId, capacityReading)
    expect(repository.appendCollection(input)).toEqual({ state: 'unavailable', failureCode: 'storage-pressure' })
    // No partial write, no silent drop, and the occupancy that caused the refusal is untouched.
    expect(database.prepare('select count(*) as count from mi_macro_calendar_market_event_collections').get()?.count).toBe(0)
    expect(database.prepare('select count(*) as count from mi_macro_calendar_market_event_observations').get()?.count).toBe(0)
    expect(database.prepare('select count(*) as count from official_pressure').get()?.count).toBe(occupiedRows)
    expect(database.isTransaction).toBe(false)
    database.close()
  }, 180_000)
})
