import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'

import { createMarketCalendarEventRepository, ManualCalendarCapacityPolicy } from './marketCalendarEventRepository'
import { createMarketCalendarPublicQueryService } from './marketCalendarPublicQueryService'
import { parseZeroXRouterEconomicData } from './zeroXRouterEconomicDataParser'
import { marketCalendarEffectiveLogicalBytes, prepareMarketCollection } from './marketCalendarStorageValidation'
import { marketCalendarRetentionPolicy, readMarketCalendarBilling, reclaimMarketCalendarStorage } from './marketCalendarStorageReclaim'

/**
 * Reclaiming the shared calendar, measured on a synthetic 525-event month.
 *
 * The fixture keeps the parser and capacity paths realistic without copying a provider
 * response. No network, no credential, and the evidence archive is never opened.
 */
const fixtureUrl = new URL('./fixtures/zeroxrouter-economic-data-zh-2026-10-success.json', import.meta.url)
const descriptorId = 'macro-calendar-0xrouter-economic-data' as const
const month = '2026-10'
const cpiNames = ['9月未季调消费者物价指数(年率)', '9月未季调核心消费者物价指数(年率)']
const directories: string[] = []

afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }) })

function parsedFixture() {
  const parsed = parseZeroXRouterEconomicData(JSON.parse(readFileSync(fixtureUrl, 'utf8')), 'zh')
  if (parsed.state !== 'succeeded') throw new Error('the captured fixture must parse')
  return parsed
}
function repositoryOn(database: DatabaseSync, clock: () => string, reserve = 0) {
  return createMarketCalendarEventRepository({ database, manualCapacityAdmission: true, cursorKey: randomBytes(32),
    resolveCollectionContext: (collectionId) => ({ providerId: '0xrouter', descriptorId, locale: 'zh', month,
      detectedAt: clock(), evidence: { providerId: '0xrouter', descriptorId, rawRecordId: `raw-${collectionId}`, evidenceHash: 'a'.repeat(64) } }),
    // `reserve` is a caller-controlled probe offset for the capacity-boundary case only; the
    // pre-existing `marketBytes` policy below it is left at its real value.
    readCapacity: () => ({ marketBytes: reserve, walBytes: 0, freeBytes: 64 * 1024 ** 3, archiveAvailable: true }), now: clock })
}
function batch(collectionId: string) { return { providerId: '0xrouter', descriptorId, locale: 'zh' as const, month,
  collectionId, parserVersion: '0xrouter-calendar-mc2-v1', parseResult: parsedFixture() } }
function bytes(database: DatabaseSync) { return Number(database.prepare('pragma page_count').get()?.page_count) * Number(database.prepare('pragma page_size').get()?.page_size) }
function preparedReserveFor(input: ReturnType<typeof batch>) {
  const context = { providerId: '0xrouter', descriptorId, locale: 'zh' as const, month, detectedAt: '2026-10-14T15:34:00.000Z',
    evidence: { providerId: '0xrouter', descriptorId, rawRecordId: 'probe', evidenceHash: 'a'.repeat(64) } }
  const prepared = prepareMarketCollection(input, context)
  return prepared.serializedBytes * 2 + 16 * (4096 + 24)
}

describe('shared calendar capacity is charged on effective, reclaimable bytes', () => {
  it('bills the freed pages once a delete grows the freelist', () => {
    const database = new DatabaseSync(':memory:')
    try {
      database.exec('create table filler(payload blob); insert into filler values (zeroblob(4 * 1024 * 1024))')
      const before = bytes(database)
      const row = database.prepare('select payload from filler')
      void row
      database.exec('delete from filler')
      expect(Number(database.prepare('pragma freelist_count').get()?.freelist_count)).toBeGreaterThan(0)
      const billing = readMarketCalendarBilling(database)
      // The file did not shrink; the charge did, because those pages are already free again.
      expect(billing.pageCount * billing.pageSize).toBe(before)
      expect(billing.logicalBytes).toBeLessThan(before)
    } finally { database.close() }
  })

  it('falls back to the full page count when the freelist cannot be read or is inconsistent', () => {
    const pageSize = 4096
    const pageCount = 1000
    expect(marketCalendarEffectiveLogicalBytes({ pageSize, pageCount, freelistCount: 250 })).toBe((pageCount - 250) * pageSize)
    // Unreadable, negative and larger-than-the-file all charge the full allocation, never a credit.
    expect(marketCalendarEffectiveLogicalBytes({ pageSize, pageCount, freelistCount: undefined })).toBe(pageCount * pageSize)
    expect(marketCalendarEffectiveLogicalBytes({ pageSize, pageCount, freelistCount: -1 })).toBe(pageCount * pageSize)
    expect(marketCalendarEffectiveLogicalBytes({ pageSize, pageCount, freelistCount: pageCount + 1 })).toBe(pageCount * pageSize)
    expect(Number.isSafeInteger(marketCalendarEffectiveLogicalBytes({ pageSize: undefined, pageCount, freelistCount: 0 }))).toBe(false)
  })

  it('turns the same refused batch into an accepted one once the freelist grows', () => {
    const database = new DatabaseSync(':memory:')
    try {
      // The fixture batch needs a little over a megabyte of reserve, so the caller-controlled
      // probe reports exactly that much as the batch's own admission reserve.
      const pageSize = Number(database.prepare('pragma page_size').get()?.page_size)
      const reserve = preparedReserveFor(batch('probe'))
      const freedPerSlab = 512 * 1024
      // Occupy the shared library right up to the ceiling, then let deletes free the slab the
      // batch needs. A delete only grows the freelist, so the file itself stays put: under the
      // old `page_count x page_size` charge the second attempt below was still refused.
      database.exec('create table official_pressure(payload blob)')
      const insert = database.prepare('insert into official_pressure values (zeroblob(?))')
      while (bytes(database) + freedPerSlab <= ManualCalendarCapacityPolicy.sharedLogicalBytes) insert.run(freedPerSlab)
      const clock = () => '2026-10-14T15:34:00.000Z'
      const repository = repositoryOn(database, clock, reserve)
      const refused = repository.appendCollection(batch(randomUUID()))
      expect(refused).toEqual({ state: 'unavailable', failureCode: 'storage-pressure' })
      const occupied = bytes(database)
      const slabs = Math.ceil(reserve / freedPerSlab)
      database.exec(`delete from official_pressure where rowid in (select rowid from official_pressure order by rowid desc limit ${slabs})`)
      const freed = Number(database.prepare('pragma freelist_count').get()?.freelist_count)
      expect(freed * pageSize).toBeGreaterThanOrEqual(reserve)
      expect(bytes(database)).toBe(occupied)
      const accepted = repository.appendCollection(batch(randomUUID()))
      expect(accepted).toMatchObject({ state: 'succeeded' })
      // The batch landed inside the freed pages, so the file did not grow past the ceiling.
      expect(bytes(database)).toBeLessThanOrEqual(ManualCalendarCapacityPolicy.sharedLogicalBytes)
    } finally { database.close() }
  }, 120_000)
})

describe('the write model stores a sample only when the values changed', () => {
  it('keeps the first and last of a run, every change, and nothing in between', () => {
    const database = new DatabaseSync(':memory:')
    try {
      let current = '2026-10-01T00:00:00.000Z'
      const clock = () => current
      const repository = repositoryOn(database, clock)
      // A: '3.7%' seen three times, then B: '3.8%' once, then A again twice.
      current = '2026-10-01T00:00:00.000Z'; expect(repository.appendCollection(batch('run-a1'))).toMatchObject({ state: 'succeeded' })
      current = '2026-10-01T01:00:00.000Z'; expect(repository.appendCollection(batch('run-a2'))).toMatchObject({ state: 'succeeded' })
      current = '2026-10-01T02:00:00.000Z'; expect(repository.appendCollection(batch('run-a3'))).toMatchObject({ state: 'succeeded' })
      current = '2026-10-01T03:00:00.000Z'
      const changed = parsedFixture()
      if (changed.state !== 'succeeded') throw new Error('fixture must parse')
      for (const draft of changed.drafts) if (cpiNames.includes(draft.displayName)) draft.providerActual = { displayValue: '9.9%' }
      expect(repository.appendCollection({ ...batch('run-b'), parseResult: changed })).toMatchObject({ state: 'succeeded' })
      current = '2026-10-01T04:00:00.000Z'; expect(repository.appendCollection(batch('run-a4'))).toMatchObject({ state: 'succeeded' })
      current = '2026-10-01T05:00:00.000Z'; expect(repository.appendCollection(batch('run-a5'))).toMatchObject({ state: 'succeeded' })

      // Three identical resamples of the first value stored one row; the change stored one more;
      // the two resamples of the original value stored one row that is a real change again.
      const stored = database.prepare(`select c.collection_id, c.detected_at, o.provider_actual_json
        from mi_macro_calendar_market_event_observations as o
        join mi_macro_calendar_market_event_collections as c on c.collection_id = o.collection_id
        where o.display_name = ? order by c.collection_sequence`).all(cpiNames[0]!)
      expect(stored.map((row) => (row as { collection_id: string }).collection_id)).toEqual(['run-a1', 'run-b', 'run-a4'])
      expect((stored[0] as { provider_actual_json: string }).provider_actual_json).toBe('{"displayValue":"3.7%"}')
      expect((stored[1] as { provider_actual_json: string }).provider_actual_json).toBe('{"displayValue":"9.9%"}')
      // The ledger remembers the newest sighting, at one row per event, without a row per batch.
      const ledger = database.prepare('select last_seen_at from mi_macro_calendar_market_observation_ledger').all()
      expect(ledger.length).toBe(parsedFixture().drafts.length)
      expect(new Set(ledger.map((row) => (row as { last_seen_at: string }).last_seen_at))).toEqual(new Set(['2026-10-01T05:00:00.000Z']))
    } finally { database.close() }
  }, 120_000)

  it('replays an accepted batch exactly, and rejects a conflicting one', () => {
    const database = new DatabaseSync(':memory:')
    try {
      const clock = () => '2026-10-01T00:00:00.000Z'
      const repository = repositoryOn(database, clock)
      const first = repository.appendCollection(batch('replay'))
      expect(first).toMatchObject({ state: 'succeeded', inserted: true })
      expect(repository.appendCollection(batch('replay'))).toEqual({ ...first, inserted: false })
      // A real value change under the same collection id is not an exact retry.
      const conflict = parsedFixture()
      if (conflict.state !== 'succeeded') throw new Error('fixture must parse')
      conflict.drafts[0]!.providerActual = { displayValue: '9.9%' }
      expect(repository.appendCollection({ ...batch('replay'), parseResult: conflict }))
        .toEqual({ state: 'unavailable', failureCode: 'collection-conflict' })
    } finally { database.close() }
  }, 120_000)
})

describe('retention converges without touching authoritative data', () => {
  it('removes expired samples, keeps official revisions, and leaves the archive alone', () => {
    const database = new DatabaseSync(':memory:')
    const archive = mkdtempSync(join(tmpdir(), 'mc-evidence-'))
    directories.push(archive)
    try {
      // A stand-in for the authoritative official line and for the audit trail.
      database.exec('create table mi_macro_calendar_revisions (revision_id text primary key, schema_version integer not null)')
      database.exec("insert into mi_macro_calendar_revisions values ('official-cpi', 1)")
      const { writeFileSync } = require('node:fs') as typeof import('node:fs')
      writeFileSync(join(archive, `${'b'.repeat(64)}.bin`), '{"archived":true}')
      const archiveHash = createHash('sha256').update(readFileSync(join(archive, `${'b'.repeat(64)}.bin`))).digest('hex')

      let current = '2026-01-01T00:00:00.000Z'
      const repository = repositoryOn(database, () => current)
      for (const [index, day] of ['2026-01-01', '2026-01-02', '2026-01-03'].entries()) {
        current = `${day}T00:00:00.000Z`
        const changed = parsedFixture()
        if (changed.state !== 'succeeded') throw new Error('fixture must parse')
        // Each day really changes a value, so each day is its own stored observation.
        for (const draft of changed.drafts) if (cpiNames.includes(draft.displayName)) draft.providerActual = { displayValue: `${index}%` }
        expect(repository.appendCollection({ ...batch(`old-${index}`), parseResult: changed })).toMatchObject({ state: 'succeeded' })
      }
      current = '2026-10-14T00:00:00.000Z'
      expect(repository.appendCollection(batch('recent'))).toMatchObject({ state: 'succeeded' })
      const before = Number(database.prepare('select count(*) as n from mi_macro_calendar_market_event_observations').get()?.n)

      const first = reclaimMarketCalendarStorage(database, { now: () => Date.parse('2026-10-14T12:00:00.000Z') })

      expect(first.expiredRows).toBeGreaterThan(0)
      expect(first.limited).toBe(false)
      expect(first.logicalBytesAfter).toBeLessThanOrEqual(first.logicalBytesBefore)
      // Expired samples are gone; the newest sample of every event and every official row stay.
      const after = Number(database.prepare('select count(*) as n from mi_macro_calendar_market_event_observations').get()?.n)
      expect(after).toBeLessThan(before)
      expect(database.prepare('select count(*) as n from mi_macro_calendar_market_event_observations where collection_id like ?').get('old-%')?.n).toBe(0)
      expect(database.prepare('select revision_id from mi_macro_calendar_revisions').all()).toEqual([{ revision_id: 'official-cpi' }])
      // The audit trail is a directory outside the database and is byte-identical afterwards.
      expect(createHash('sha256').update(readFileSync(join(archive, `${'b'.repeat(64)}.bin`))).digest('hex')).toBe(archiveHash)
      expect(readFileSync(join(archive, `${'b'.repeat(64)}.bin`), 'utf8')).toBe('{"archived":true}')

      // A second pass over the settled library has nothing left to remove.
      const second = reclaimMarketCalendarStorage(database, { now: () => Date.parse('2026-10-14T12:00:00.000Z') })
      expect(second.expiredRows).toBe(0)
      expect(Number(database.prepare('select count(*) as n from mi_macro_calendar_market_event_observations').get()?.n)).toBe(after)
    } finally { database.close(); rmSync(archive, { recursive: true, force: true }) }
  }, 120_000)

  it('bounds one pass and converges over repeated runs', () => {
    const database = new DatabaseSync(':memory:')
    try {
      let current = '2026-01-01T00:00:00.000Z'
      const repository = repositoryOn(database, () => current)
      for (let index = 0; index < 6; index++) {
        current = `2026-01-0${index + 1}T00:00:00.000Z`
        const changed = parsedFixture()
        if (changed.state !== 'succeeded') throw new Error('fixture must parse')
        for (const draft of changed.drafts) if (cpiNames.includes(draft.displayName)) draft.providerActual = { displayValue: `${index}%` }
        expect(repository.appendCollection({ ...batch(`bound-${index}`), parseResult: changed })).toMatchObject({ state: 'succeeded' })
      }
      const bounded = reclaimMarketCalendarStorage(database, { now: () => Date.parse('2026-10-14T12:00:00.000Z'), maximumRowsPerRun: 1 })
      expect(bounded.limited).toBe(true)
      expect(bounded.expiredRows).toBe(1)
      let passes = 1
      while (reclaimMarketCalendarStorage(database, { now: () => Date.parse('2026-10-14T12:00:00.000Z'), maximumRowsPerRun: 1 }).expiredRows > 0) passes++
      expect(passes).toBeGreaterThan(1)
      expect(reclaimMarketCalendarStorage(database, { now: () => Date.parse('2026-10-14T12:00:00.000Z') }).expiredRows).toBe(0)
    } finally { database.close() }
  }, 120_000)
})

describe('reading current state and accepting a batch after cleanup', () => {
  it('reads one row per event, follows the cursor, and accepts the real 0xRouter batch after reclaiming', () => {
    const database = new DatabaseSync(':memory:')
    try {
      let current = '2026-01-01T00:00:00.000Z'
      const repository = repositoryOn(database, () => current)
      for (let index = 0; index < 4; index++) {
        current = `2026-01-0${index + 1}T00:00:00.000Z`
        expect(repository.appendCollection(batch(`cycle-${index}`))).toMatchObject({ state: 'succeeded' })
      }
      // Four identical cycles stored one row per event, and the current-state read returns each
      // identity exactly once, following its own cursor.
      expect(Number(database.prepare('select count(*) as n from mi_macro_calendar_market_event_observations').get()?.n)).toBe(parsedFixture().drafts.length)
      const seen: string[] = []
      let cursor: string | undefined
      // One identity per page, so the walk needs one step per event identity.
      for (let page = 0; page < parsedFixture().drafts.length + 2; page++) {
        const result = repository.listObservationStates({ providerId: '0xrouter', descriptorId, locale: 'zh', month,
          asOf: '2026-10-14T16:00:00.000Z', limit: 1, ...(cursor ? { cursor } : {}) })
        expect(result.state).toBe('succeeded')
        if (result.state !== 'succeeded') break
        seen.push(...result.rows.map((row) => String(row.candidate_key)))
        cursor = result.nextCursor
        if (!cursor) break
      }
      expect(new Set(seen).size).toBe(parsedFixture().drafts.length)
      expect(seen).toHaveLength(parsedFixture().drafts.length)

      // After the cleanup, the same real response body still stores both September CPI actuals.
      reclaimMarketCalendarStorage(database, { now: () => Date.parse('2026-10-14T12:00:00.000Z') })
      current = '2026-10-14T15:34:00.000Z'
      expect(repository.appendCollection(batch(randomUUID()))).toMatchObject({ state: 'succeeded' })
      const cpi = database.prepare(`select source_event_id, provider_actual_json from mi_macro_calendar_market_event_observations
        where collection_id in (select collection_id from mi_macro_calendar_market_event_collections where detected_at = ?)
          and display_name in (?, ?)`).all('2026-10-14T15:34:00.000Z', ...cpiNames)
      expect(cpi).toHaveLength(2)
      const query = createMarketCalendarPublicQueryService({ repository })
      try {
        const events: string[] = []
        let next: string | undefined
        for (let page = 0; page < 10; page++) {
          const result = query.queryMonth({ month, locale: 'zh', asOf: '2026-10-14T16:00:00.000Z', ...(next ? { cursor: next } : {}) })
          expect(result.state).toBe('available')
          if (result.state !== 'available') break
          events.push(...result.events.filter((event) => cpiNames.includes(event.title)).map((event) => JSON.stringify(event.providerActual)))
          next = result.nextCursor
          if (!next) break
        }
        expect(events.sort()).toEqual(['{"displayValue":"2.6%"}', '{"displayValue":"3.7%"}'])
      } finally { query.dispose() }
    } finally { database.close() }
  }, 120_000)

  it('declares the retention window and the permanently retained classes in one place', () => {
    expect(marketCalendarRetentionPolicy.marketObservationRetentionMs).toBe(90 * 24 * 60 * 60 * 1000)
    expect(marketCalendarRetentionPolicy.defaultMaximumRowsPerRun).toBeGreaterThan(0)
    expect(readMarketCalendarBilling.name).toBe('readMarketCalendarBilling')
  })
})
