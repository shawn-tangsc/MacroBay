import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, rmSync, statfsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createMarketCalendarEventRepository, ManualCalendarCapacityPolicy } from './marketCalendarEventRepository'
import { parseZeroXRouterEconomicData } from './zeroXRouterEconomicDataParser'
import { prepareMarketCollection, zeroXRouterCalendarStoragePolicy as policy } from './marketCalendarStorageValidation'

const databases: DatabaseSync[] = []
const descriptorId = 'macro-calendar-0xrouter-economic-data' as const
const scope = { providerId: '0xrouter' as const, descriptorId, locale: 'zh' as const, month: '2026-09' }
const detectedAt = '2026-09-08T00:00:00.000Z'
const evidence = { providerId: '0xrouter', descriptorId, rawRecordId: 'raw-one', evidenceHash: 'a'.repeat(64) }
// Derived contract inputs, not provider evidence fixtures.
function row(id = 1) {
  return { calendarId: 'candidate', id, calendarName: 'Derived event', locale: 'zh', star: 3,
    pubTimestamp: Date.parse('2026-09-09T12:00:00.000Z'), estimateValue: 0, preValue: '2', pubValue: '3' }
}
function batch(collectionId = 'collection-one', data: unknown[] = [row()]) {
  return { ...scope, collectionId, parserVersion: 'mc2-v1', parseResult: parseZeroXRouterEconomicData({ code: 200, msg: '', data }, 'zh') }
}
function setup(storage?: { directory: string }) {
  const database = storage ? new DatabaseSync(join(storage.directory, 'calendar.sqlite')) : new DatabaseSync(':memory:')
  databases.push(database)
  const context = { ...scope, detectedAt, evidence }
  const capacity = { marketBytes: 0, walBytes: 0, freeBytes: 10 * 1024 ** 3, archiveAvailable: true }
  const repository = createMarketCalendarEventRepository({ database,
    resolveCollectionContext: () => context, readCapacity: () => capacity,
    now: () => '2026-09-08T00:00:01.000Z', cursorKey: Buffer.alloc(32, 7) })
  return { database, repository, context, capacity }
}
const directories: string[] = []
function fileSetup(): ReturnType<typeof setup> {
  const directory = mkdtempSync(join(tmpdir(), 'mc-shared-ceiling-'))
  directories.push(directory)
  return setup({ directory })
}
function databaseBytes(database: DatabaseSync): number {
  return Number(database.prepare('pragma page_count').get()?.page_count) *
    Number(database.prepare('pragma page_size').get()?.page_size)
}
/**
 * Occupancy that fills the *shared* library up to `targetBytes` (never past it by more
 * than the final page).
 *
 * `official_pressure` stands in for the official/other product data the shared charge
 * also covers. Zeroblobs stream straight to the file, so a multi-GiB logical footprint
 * costs no RSS, and the table is created here rather than by `setup`.
 */
function occupySharedLibrary(database: DatabaseSync, targetBytes: number): void {
  database.exec('create table official_pressure(payload blob)')
  const insert = database.prepare('insert into official_pressure values (zeroblob(?))')
  const step = 64 * 1024 * 1024
  while (databaseBytes(database) + step <= targetBytes) insert.run(step)
  const remaining = targetBytes - databaseBytes(database)
  if (remaining > 0) insert.run(remaining)
}
afterEach(() => {
  for (const database of databases.splice(0)) database.close()
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('market calendar independent observations', () => {
  it('measures manual reads, append and reopen at the accepted 256MiB measurement footprint', async () => {
    const { createMarketCalendarPublicQueryService } = await import('./marketCalendarPublicQueryService')
    const directory = mkdtempSync(join(tmpdir(), 'mc-v1-near-cap-'))
    const path = join(directory, 'calendar.sqlite')
    let database = new DatabaseSync(path)
    database.exec('pragma journal_mode=wal; pragma foreign_keys=on')
    // Design 122 §7 accepted this footprint as the always-on measurement point; the accepted
    // full-ceiling run stays the explicit opt-in harness. The shared admission ceiling is now
    // 2 GiB, so this footprint must be *accepted*: it is what must not be refused any more.
    const measurementBytes = 256 * 1024 ** 2
    const context = { ...scope, detectedAt, evidence }
    const probe = () => {
      const volume = statfsSync(directory)
      return { marketBytes: Number(database.prepare('pragma page_count').get()?.page_count) * Number(database.prepare('pragma page_size').get()?.page_size),
        walBytes: (() => { try { return statSync(path + '-wal').size } catch { return 0 } })(),
        freeBytes: volume.bavail * volume.bsize, archiveAvailable: true }
    }
    const openRepository = () => createMarketCalendarEventRepository({ database, manualCapacityAdmission: true,
      resolveCollectionContext: () => context, readCapacity: probe, now: () => detectedAt, cursorKey: Buffer.alloc(32, 7) })
    let repository = openRepository()
    const readings: number[] = [], appends: number[] = [], startups: number[] = []
    const baselineRss = process.memoryUsage().rss
    let peakRss = baselineRss
    let sequence = 0
    // Derived schema/row mix, not production evidence. Full 8192-byte boundary is tested separately.
    const mixed = (offset: number) => Array.from({ length: 500 }, (_, i) => ({ ...row(offset + i + 1), ...(i % 2 ? {} : {
      calendarName: 'é'.repeat(512), countryName: 'é'.repeat(512), estimateValue: 'é'.repeat(512),
      preValue: 'é'.repeat(512), pubValue: 'é'.repeat(512), dataEffect: 'é'.repeat(512), dataEffectCode: 'é'.repeat(400) }) }))
    // Each batch carries its own event identities: repeating one identity set would now be a
    // deduplicated resample, and the footprint must grow from genuinely new observations.
    const input = () => batch(`near-${String(++sequence).padStart(6, '0')}`, mixed(sequence * 100_000))
    const largest = Math.max(...prepareMarketCollection(input(), context).observations.map(value => Buffer.byteLength(JSON.stringify(value))))
    expect(largest).toBeGreaterThan(7900)
    expect(largest).toBeLessThanOrEqual(8192)
    try {
      while (probe().marketBytes < measurementBytes * .95) {
        const current = input()
        const start = performance.now()
        expect(repository.appendCollection(current)).toMatchObject({ state: 'succeeded' })
        appends.push(performance.now() - start)
        database.exec('pragma wal_checkpoint(truncate)')
        peakRss = Math.max(peakRss, process.memoryUsage().rss)
        expect(sequence).toBeLessThan(300)
      }
      const logicalBytes = probe().marketBytes
      expect(logicalBytes).toBeGreaterThanOrEqual(measurementBytes * .9)
      expect(logicalBytes).toBeLessThan(measurementBytes)
      expect(logicalBytes).toBeLessThan(ManualCalendarCapacityPolicy.sharedLogicalBytes)
      const service = createMarketCalendarPublicQueryService({ repository })
      const query = { month: scope.month, locale: 'zh', asOf: detectedAt }
      for (let i = 0; i < 20; i++) {
        const start = performance.now()
        const page = service.queryMonth(query)
        readings.push(performance.now() - start)
        expect(page.state).toBe('available')
        if (page.state === 'available') expect(page.events.length).toBeGreaterThan(0)
      }
      service.dispose()
      const countBefore = database.prepare('select count(*) as n from mi_macro_calendar_market_event_collections').get()?.n
      // A bounded temporary allocation leaves free pages without removing any observation.
      database.exec('create table derived_free_page_probe(payload blob); insert into derived_free_page_probe values(zeroblob(1048576)); drop table derived_free_page_probe')
      expect(Number(database.prepare('pragma freelist_count').get()?.freelist_count)).toBeGreaterThan(0)
      const beforeReuse = probe().marketBytes
      expect(repository.appendCollection(batch('reuse-free-pages', mixed(1_000_000)))).toMatchObject({ state: 'succeeded' })
      expect(probe().marketBytes).toBe(beforeReuse)
      // Official/other shared occupancy now fills the rest of the library, past the ceiling: the
      // gate must still fail closed and must not drop the already accepted observations.
      occupySharedLibrary(database, ManualCalendarCapacityPolicy.sharedLogicalBytes + 1)
      expect(databaseBytes(database)).toBeGreaterThan(ManualCalendarCapacityPolicy.sharedLogicalBytes)
      const countAtCeiling = database.prepare('select count(*) as n from mi_macro_calendar_market_event_collections').get()?.n
      const large = mixed(2_000_000)
      expect(repository.appendCollection(batch('rejected-near-cap', large))).toEqual({ state: 'unavailable', failureCode: 'storage-pressure' })
      expect(database.prepare('select count(*) as n from mi_macro_calendar_market_event_collections').get()?.n).toBe(countAtCeiling)
      expect(database.isTransaction).toBe(false)
      for (let i = 0; i < 20; i++) {
        database.close()
        const start = performance.now()
        database = new DatabaseSync(path)
        repository = openRepository()
        startups.push(performance.now() - start)
        expect(repository.listCollections({ ...scope, asOf: detectedAt, limit: 1 }).state).toBe('succeeded')
        peakRss = Math.max(peakRss, process.memoryUsage().rss)
      }
      const p95 = (values: number[]) => values.toSorted((a, b) => a - b)[Math.ceil(values.length * .95) - 1]!
      const metrics = { logicalBytes, largestRowBytes: largest, collections: countBefore, queryP95Ms: p95(readings),
        appendP95Ms: p95(appends), startupP95Ms: p95(startups), incrementalRssBytes: peakRss - baselineRss }
      process.stdout.write(`MC-V1 derived near-capacity (no forced GC or cold-cache claim): ${JSON.stringify(metrics)}\n`)
      expect(metrics.queryP95Ms).toBeLessThanOrEqual(200)
      expect(metrics.appendP95Ms).toBeLessThanOrEqual(500)
      expect(metrics.startupP95Ms).toBeLessThanOrEqual(100)
      expect(metrics.incrementalRssBytes).toBeLessThanOrEqual(192 * 1024 ** 2)
    } finally { database.close(); rmSync(directory, { recursive: true, force: true }) }
  }, 180_000)
  it('charges shared logical pages before manual writes without restricting official writes', () => {
    const { database, context, capacity } = fileSetup()
    // Official/other shared occupancy, not market attribution: it is charged in full and it
    // must survive a refused market write untouched.
    occupySharedLibrary(database, ManualCalendarCapacityPolicy.sharedLogicalBytes + 1)
    const repository = createMarketCalendarEventRepository({ database, manualCapacityAdmission: true,
      resolveCollectionContext: () => context, readCapacity: () => capacity, now: () => detectedAt })
    expect(repository.appendCollection(batch())).toEqual({ state: 'unavailable', failureCode: 'storage-pressure' })
    expect(database.prepare('select collection_id from mi_macro_calendar_market_event_collections').all()).toEqual([])
    const occupied = database.prepare('select count(*) as count from official_pressure').get()?.count as number
    expect(occupied).toBeGreaterThan(0)
    database.exec('insert into official_pressure values (zeroblob(1))')
    expect(database.prepare('select count(*) as count from official_pressure').get()?.count).toBe(occupied + 1)
  }, 120_000)

  it('rechecks manual capacity before commit and rolls back if the volume becomes constrained', () => {
    const { database, context, capacity } = setup()
    let reads = 0
    const repository = createMarketCalendarEventRepository({ database, manualCapacityAdmission: true,
      resolveCollectionContext: () => context, now: () => detectedAt,
      readCapacity: () => ++reads === 1 ? capacity : { ...capacity, freeBytes: 0 } })
    expect(repository.appendCollection(batch())).toEqual({ state: 'unavailable', failureCode: 'storage-pressure' })
    expect(reads).toBe(2)
    expect(database.prepare('select collection_id from mi_macro_calendar_market_event_collections').all()).toEqual([])
  })

  it('rolls back real shared page growth beyond the manual cap before commit', () => {
    const { database, context, capacity } = fileSetup()
    // Start below the ceiling so the pre-check passes; the write itself must then cross it.
    occupySharedLibrary(database, ManualCalendarCapacityPolicy.sharedLogicalBytes - 8 * 1024 ** 2)
    expect(databaseBytes(database)).toBeLessThan(ManualCalendarCapacityPolicy.sharedLogicalBytes)
    const occupied = database.prepare('select count(*) as count from official_pressure').get()?.count
    database.exec(`create trigger manual_growth after insert on mi_macro_calendar_market_event_collections
      begin insert into official_pressure values(zeroblob(16777216)); end`)
    const repository = createMarketCalendarEventRepository({ database, manualCapacityAdmission: true,
      resolveCollectionContext: () => context, now: () => detectedAt, readCapacity: () => capacity })
    expect(repository.appendCollection(batch())).toEqual({ state: 'unavailable', failureCode: 'storage-pressure' })
    expect(database.prepare('select collection_id from mi_macro_calendar_market_event_collections').all()).toEqual([])
    expect(database.prepare('select count(*) as count from official_pressure').get()?.count).toBe(occupied)
    expect(database.isTransaction).toBe(false)
  }, 120_000)
  it('stores an 8KiB boundary mix and atomically rejects a row one byte over', () => {
    const { database, repository, context } = setup()
    const make = (codeLength: number, id = 'mixed') => batch(id, [row(), {
      ...row(2), calendarName: 'é'.repeat(512), countryName: 'é'.repeat(512),
      estimateValue: 'é'.repeat(512), preValue: 'é'.repeat(512), pubValue: 'é'.repeat(512),
      dataEffect: 'é'.repeat(512), dataEffectCode: 'é'.repeat(400) + 'c'.repeat(codeLength)
    }])
    let exactInput: ReturnType<typeof batch> | undefined
    let length = 0
    for (length = 1; length <= 112; length++) {
      const candidate = make(length)
      try {
        const rows = prepareMarketCollection(candidate, context).observations
        if (Buffer.byteLength(JSON.stringify(rows[1])) === policy.observationBytes) { exactInput = candidate; break }
      } catch { break }
    }
    expect(exactInput, 'derived mixed fixture must reach the exact 8192-byte boundary').toBeDefined()
    expect(repository.appendCollection(exactInput)).toMatchObject({ state: 'succeeded' })
    expect(database.prepare('select count(*) as count from mi_macro_calendar_market_event_observations').get()?.count).toBe(2)
    expect(repository.appendCollection(make(length + 1, 'other'))).toEqual({ state: 'unavailable', failureCode: 'row-too-large' })
    expect(database.prepare('select count(*) as count from mi_macro_calendar_market_event_collections').get()?.count).toBe(1)
  })

  it('uses file-backed capacity probes and rolls back real page growth at a simulated cap', () => {
    const directory = mkdtempSync(join(tmpdir(), 'mc3-capacity-contract-'))
    const path = join(directory, 'test.sqlite')
    const database = new DatabaseSync(path)
    try {
      database.exec('pragma journal_mode=wal; pragma foreign_keys=on')
      const context = { ...scope, detectedAt, evidence: { ...evidence } }
      const probe = () => {
        const volume = statfsSync(directory)
        let walBytes = 0
        try { walBytes = statSync(path + '-wal').size } catch {}
        return { marketBytes: Number(database.prepare('pragma page_count').get()?.page_count) *
          Number(database.prepare('pragma page_size').get()?.page_size), walBytes,
          freeBytes: volume.bavail * volume.bsize, archiveAvailable: true }
      }
      let offset = 0
      const repository = createMarketCalendarEventRepository({ database, resolveCollectionContext: () => context,
        now: () => detectedAt, readCapacity: () => { const actual = probe(); return { ...actual, marketBytes: actual.marketBytes + offset } } })
      const input = batch('cap')
      const pageSize = Number(database.prepare('pragma page_size').get()?.page_size)
      const reserve = prepareMarketCollection(input, context).serializedBytes * policy.indexReserveMultiplier +
        policy.transactionReservePages * (pageSize + policy.walFrameHeaderBytes)
      offset = policy.marketBytes - probe().marketBytes - reserve + 1
      expect(repository.appendCollection(input)).toEqual({ state: 'unavailable', failureCode: 'storage-pressure' })
      offset--
      expect(repository.appendCollection(input)).toMatchObject({ state: 'succeeded' })
      // Test-only capacity offset, not a claim about near-20GiB performance.
      database.exec(`create table test_growth(payload blob);
        create trigger grow_during_insert after insert on mi_macro_calendar_market_event_observations
        begin insert into test_growth values (zeroblob(1048576)); end`)
      offset = policy.marketBytes - probe().marketBytes - reserve
      // Distinct event identities, so the batch really inserts observations and the trigger fires.
      const distinct = Array.from({ length: 2 }, (_, index) => row(3_000_000 + index))
      expect(repository.appendCollection(batch('new', distinct))).toEqual({ state: 'unavailable', failureCode: 'storage-pressure' })
      expect(database.prepare('select * from test_growth').all()).toEqual([])
      expect(database.prepare('select collection_id from mi_macro_calendar_market_event_collections').all()).toEqual([{ collection_id: 'cap' }])
      expect(database.isTransaction).toBe(false)
    } finally { database.close(); rmSync(directory, { recursive: true, force: true }) }
  })

  it('captures input before resolver, and context before clock/capacity callbacks, without freezing callers', () => {
    const { database, capacity, context } = setup()
    const input = batch()
    const original = structuredClone(input)
    const repository = createMarketCalendarEventRepository({ database,
      resolveCollectionContext: () => {
        if (input.parseResult.state === 'succeeded') input.parseResult.drafts[0] = { ...input.parseResult.drafts[0], displayName: 'Changed by resolver' }
        return context
      },
      now: () => { context.evidence = { ...evidence, rawRecordId: 'changed-by-clock' }; return detectedAt },
      readCapacity: () => { input.collectionId = 'changed-by-capacity'; return capacity }
    })
    expect(repository.appendCollection(input)).toMatchObject({ state: 'succeeded', collectionId: 'collection-one' })
    expect(database.prepare('select display_name from mi_macro_calendar_market_event_observations').get())
      .toEqual({ display_name: 'Derived event' })
    expect(database.prepare('select raw_record_id from mi_macro_calendar_market_event_collections').get())
      .toEqual({ raw_record_id: 'raw-one' })
    expect(input).not.toEqual(original)
    expect(Object.isFrozen(input)).toBe(false)
    expect(Object.isFrozen(context)).toBe(false)
  })

  it('rejects a collectionId getter before invoking it or the trusted resolver', () => {
    const { database } = setup()
    let getters = 0
    let resolvers = 0
    const input = batch()
    Object.defineProperty(input, 'collectionId', { enumerable: true, get() { getters++; return 'one' } })
    const repository = createMarketCalendarEventRepository({ database,
      resolveCollectionContext: () => { resolvers++; return { ...scope, detectedAt, evidence } } })
    expect(repository.appendCollection(input)).toEqual({ state: 'unavailable', failureCode: 'invalid-input' })
    expect({ getters, resolvers }).toEqual({ getters: 0, resolvers: 0 })
  })

  it('rejects proxy inputs and context without running traps', () => {
    const { database, repository } = setup()
    let calls = 0
    const proxy = new Proxy({}, { get() { calls++; return undefined }, ownKeys() { calls++; return [] },
      getPrototypeOf() { calls++; return Object.prototype } })
    expect(repository.appendCollection(proxy)).toEqual({ state: 'unavailable', failureCode: 'invalid-input' })
    const badContext = createMarketCalendarEventRepository({ database, resolveCollectionContext: () => proxy as any })
    expect(badContext.appendCollection(batch())).toEqual({ state: 'unavailable', failureCode: 'invalid-input' })
    expect(calls).toBe(0)
  })

  it('uses the same private values even if an SQLite callback mutates callers during pass two', () => {
    const { database, context, capacity } = setup()
    const input = batch('one', [row(), row(2)])
    database.function('mutate_caller', () => {
      input.collectionId = 'changed'
      if (input.parseResult.state === 'succeeded') (input.parseResult.drafts as unknown[]).splice(0)
      context.detectedAt = 'changed'
      return 0
    })
    database.exec(`create trigger mutate_after_parent after insert on mi_macro_calendar_market_event_collections
      begin select mutate_caller(); end`)
    const repository = createMarketCalendarEventRepository({ database, resolveCollectionContext: () => context,
      readCapacity: () => capacity, now: () => detectedAt })
    expect(repository.appendCollection(input)).toMatchObject({ state: 'succeeded', collectionId: 'one' })
    expect(database.prepare('select collection_id, display_name from mi_macro_calendar_market_event_observations').all())
      .toEqual([{ collection_id: 'one', display_name: 'Derived event' }, { collection_id: 'one', display_name: 'Derived event' }])
  })

  it('compares replay by indexed candidate reads without materializing stored rows', () => {
    const { database, repository } = setup()
    const input = batch('one', [row(), row(2)])
    const first = repository.appendCollection(input)
    const statement = database.prepare('select 1')
    const prototype = Object.getPrototypeOf(statement)
    const all = vi.spyOn(prototype, 'all')
    try {
      expect(repository.appendCollection(input)).toEqual({ ...first, inserted: false })
      expect(all).not.toHaveBeenCalled()
    } finally { all.mockRestore() }
  })

  it.each([
    (context: any) => { context.unknown = 'not-admitted' },
    (context: any) => { Object.defineProperty(context, 'hidden', { value: 'not-admitted' }) },
    (context: any) => { context[Symbol('unknown')] = 'not-admitted' },
    (context: any) => { context.unknown = Array.from({ length: 64257 }, () => 0) },
    (context: any) => { context.evidence.unknown = NaN },
    (context: any) => { context.evidence.unknown = Infinity },
    (context: any) => { context.evidence.unknown = -Infinity }
  ])('rejects non-contract context data before any write %#', (mutate) => {
    const { database, repository, context } = setup()
    context.evidence = { ...evidence }
    mutate(context)
    expect(repository.appendCollection(batch())).toEqual({ state: 'unavailable', failureCode: 'invalid-input' })
    expect(database.prepare('select * from mi_macro_calendar_market_event_collections').all()).toEqual([])
  })

  it('rejects array holes and extra properties rather than silently ignoring them', () => {
    const { repository } = setup()
    for (const hole of [true, false]) {
      const input = batch()
      if (input.parseResult.state !== 'succeeded') throw new Error('derived input failed')
      if (hole) delete (input.parseResult.drafts as unknown[])[0]
      else Object.defineProperty(input.parseResult.drafts, 'extra', { value: 'ignored' })
      expect(repository.appendCollection(input)).toEqual({ state: 'unavailable', failureCode: 'invalid-input' })
    }
  })

  it('creates the market structures, the last-seen ledger and nothing else', () => {
    const database = new DatabaseSync(':memory:')
    databases.push(database)
    database.exec("create table official_sentinel(value text); insert into official_sentinel values ('unchanged')")
    createMarketCalendarEventRepository({ database })
    const names = database.prepare("select name from sqlite_master where type='table' and name like 'mi_macro_calendar_%' order by name").all()
    expect(names.map((row) => row.name)).toEqual([
      'mi_macro_calendar_market_event_collections',
      'mi_macro_calendar_market_event_observations',
      'mi_macro_calendar_market_observation_ledger',
      'mi_macro_calendar_provider_indicator_links'
    ])
    expect(database.prepare('select * from official_sentinel').all()).toEqual([{ value: 'unchanged' }])
    for (const { name } of names) expect(database.prepare(`select * from ${name}`).all()).toEqual([])
    // The ledger carries only the deduplication bookkeeping, never provider content.
    expect(database.prepare('pragma table_info(mi_macro_calendar_market_observation_ledger)').all()
      .map((column) => (column as { name: string }).name)).toEqual(['candidate_key', 'last_seen_at'])
  })

  it.each([
    [[], 'success-empty', 0, 0], [[{}], 'all-skipped', 1, 1],
    [[row(), {}], 'partial', 2, 1], [[row()], 'success', 1, 0]
  ])('persists exact successful parser state %#', (data, status, input, skipped) => {
    const { database, repository } = setup()
    expect(repository.appendCollection(batch('one', data as unknown[]))).toMatchObject({ state: 'succeeded', inserted: true })
    expect(database.prepare('select status, input_count, skipped_count from mi_macro_calendar_market_event_collections').get())
      .toEqual({ status, input_count: input, skipped_count: skipped })
  })

  it('keeps display-only three values, zero, NULL country and disabled identity independently', () => {
    const { database, repository } = setup()
    expect(repository.appendCollection(batch())).toMatchObject({ state: 'succeeded' })
    const stored = database.prepare('select * from mi_macro_calendar_market_event_observations').get()!
    expect(JSON.parse(String(stored.consensus_json))).toEqual({ displayValue: '0' })
    expect(JSON.parse(String(stored.provider_previous_json))).toEqual({ displayValue: '2' })
    expect(JSON.parse(String(stored.provider_actual_json))).toEqual({ displayValue: '3' })
    expect(stored.country_code).toBeNull()
    expect(stored.identity_state).toBe('unverified')
    expect(stored.scheduled_at).toBe('2026-09-09T12:00:00.000Z')
  })

  it('replays only the complete identical batch and rejects conflicts without updating its clock or sequence', () => {
    const { database, repository } = setup()
    const first = repository.appendCollection(batch())
    expect(first).toMatchObject({ state: 'succeeded', inserted: true })
    expect(repository.appendCollection(batch())).toEqual({ ...first, inserted: false })
    expect(repository.appendCollection(batch('collection-one', [{ ...row(), estimateValue: 4 }]))).toEqual({ state: 'unavailable', failureCode: 'collection-conflict' })
    expect(database.prepare('select collection_sequence, recorded_at from mi_macro_calendar_market_event_collections').all())
      .toEqual([{ collection_sequence: 1, recorded_at: '2026-09-08T00:00:01.000Z' }])
  })

  it('stores new collections while an unchanged resample writes no second observation row', () => {
    const { database, repository, context } = setup()
    repository.appendCollection(batch('one'))
    context.detectedAt = '2026-09-08T00:00:02.000Z'
    // The batch is a settled resample: same candidate, same hash, same archived evidence.
    expect(repository.appendCollection(batch('two'))).toMatchObject({ state: 'succeeded', inserted: true })
    const observations = database.prepare('select collection_id, business_snapshot_hash from mi_macro_calendar_market_event_observations').all()
    expect(observations).toEqual([{ collection_id: 'one', business_snapshot_hash: observations[0]!.business_snapshot_hash }])
    // Both batches are still recorded, in order, with their own observation times.
    expect(database.prepare('select detected_at from mi_macro_calendar_market_event_collections order by collection_sequence').all())
      .toEqual([{ detected_at: detectedAt }, { detected_at: context.detectedAt }])
    // The last-seen ledger is what remembers the resample, at one row per event.
    const ledger = database.prepare('select candidate_key, last_seen_at from mi_macro_calendar_market_observation_ledger').all()
    expect(ledger).toHaveLength(1)
    expect(ledger[0]?.last_seen_at).toBe('2026-09-08T00:00:01.000Z')
    expect(String(ledger[0]?.candidate_key)).toContain('"0xrouter"')
  })

  it('appends exactly one observation row when a business value really changes', () => {
    const { database, repository, context } = setup()
    repository.appendCollection(batch('one'))
    context.detectedAt = '2026-09-08T00:00:02.000Z'
    repository.appendCollection(batch('two', [{ ...row(), pubValue: '4' }]))
    const rows = database.prepare('select collection_id, provider_actual_json, last_seen_at from mi_macro_calendar_market_event_observations order by collection_id').all()
    expect(rows).toEqual([
      { collection_id: 'one', provider_actual_json: '{"displayValue":"3"}', last_seen_at: '2026-09-08T00:00:01.000Z' },
      { collection_id: 'two', provider_actual_json: '{"displayValue":"4"}', last_seen_at: '2026-09-08T00:00:01.000Z' }
    ])
    // A resample of the new value is not a third row, and it does not rewrite the second one.
    context.detectedAt = '2026-09-08T00:00:03.000Z'
    repository.appendCollection(batch('three', [{ ...row(), pubValue: '4' }]))
    expect(database.prepare('select count(*) as n from mi_macro_calendar_market_event_observations').get()?.n).toBe(2)
    expect(database.prepare('select last_seen_at from mi_macro_calendar_market_observation_ledger').all())
      .toEqual([{ last_seen_at: '2026-09-08T00:00:01.000Z' }])
  })

  it('rolls back the entire parent and all children after a real SQLite insert failure', () => {
    const { database, repository } = setup()
    database.exec(`create trigger fail_second before insert on mi_macro_calendar_market_event_observations
      when new.source_event_id = '["candidate",2]' begin select raise(abort, 'private failure'); end`)
    expect(repository.appendCollection(batch('one', [row(), row(2)]))).toEqual({ state: 'unavailable', failureCode: 'storage-unavailable' })
    expect(database.prepare('select * from mi_macro_calendar_market_event_collections').all()).toEqual([])
    expect(database.prepare('select * from mi_macro_calendar_market_event_observations').all()).toEqual([])
  })

  it.each([
    (input: any) => { input.providerId = 'unknown' },
    (input: any) => { input.descriptorId = 'unknown' },
    (input: any) => { input.month = '2026-13' },
    (input: any) => { input.locale = 'fr' },
    (input: any) => { input.parseResult = { state: 'unavailable', failureCode: 'invalid-payload' } },
    (input: any) => { input.parseResult.diagnostics.inputRows = 1001 },
    (input: any) => { input.parseResult.diagnostics.reasons['invalid-row'] = 1 },
    (input: any) => { input.parseResult.drafts[0].locale = 'en' },
    (input: any) => { input.parseResult.drafts[0].kind = 'financial-event' },
    (input: any) => { input.parseResult.drafts[0].marketFactKey = 'forged' },
    (input: any) => { input.parseResult.drafts[0].countryCode = 'ZZ' },
    (input: any) => { input.parseResult.drafts[0].consensus.numericValue = 0 },
    (input: any) => { input.parseResult.drafts[0].scheduledAt = 'invalid' }
  ])('rejects mismatched or unsafe input atomically %#', (mutate) => {
    const { database, repository } = setup()
    const input = batch()
    mutate(input)
    expect(repository.appendCollection(input)).toEqual({ state: 'unavailable', failureCode: 'invalid-input' })
    expect(database.prepare('select * from mi_macro_calendar_market_event_collections').all()).toEqual([])
  })

  it.each(['marketBytes', 'walBytes', 'freeBytes', 'archiveAvailable'] as const)('fails closed under %s pressure but permits exact replay', (key) => {
    const { database, repository, capacity } = setup()
    const first = repository.appendCollection(batch('one'))
    Object.assign(capacity, { [key]: key === 'marketBytes' ? 20 * 1024 ** 3 : key === 'walBytes' ? 256 * 1024 ** 2 : key === 'freeBytes' ? 0 : false })
    expect(repository.appendCollection(batch('two'))).toEqual({ state: 'unavailable', failureCode: 'storage-pressure' })
    expect(repository.appendCollection(batch('one'))).toEqual({ ...first, inserted: false })
    expect(database.prepare('select collection_id from mi_macro_calendar_market_event_collections').all()).toEqual([{ collection_id: 'one' }])
  })

  it('rejects missing trusted context and mismatched evidence without fabricating clocks', () => {
    const { database } = setup()
    const missing = createMarketCalendarEventRepository({ database })
    expect(missing.appendCollection(batch())).toEqual({ state: 'unavailable', failureCode: 'context-unavailable' })
    const { repository, context } = setup()
    context.evidence = { ...evidence, descriptorId: 'forged' } as typeof evidence
    expect(repository.appendCollection(batch())).toEqual({ state: 'unavailable', failureCode: 'invalid-input' })
  })

  it('freezes a sequence high-water excluding same-time, backdated and late new collections', () => {
    const { repository, context } = setup()
    repository.appendCollection(batch('b'))
    repository.appendCollection(batch('a'))
    const query = { ...scope, asOf: '2026-09-30T00:00:00.000Z', limit: 1 }
    const first = repository.listCollections(query)
    expect(first.state).toBe('succeeded')
    if (first.state !== 'succeeded') throw new Error('expected first page')
    expect(first.rows.map((row) => row.collection_id)).toEqual(['b'])
    repository.appendCollection(batch('ab'))
    context.detectedAt = '2026-09-01T00:00:00.000Z'
    repository.appendCollection(batch('late'))
    const second = repository.listCollections({ ...query, cursor: first.nextCursor })
    expect(second).toMatchObject({ state: 'succeeded', rows: [{ collection_id: 'a' }] })
    expect(second.state === 'succeeded' && second.nextCursor).toBeUndefined()
    expect(repository.listCollections({ ...query, locale: 'en', cursor: first.nextCursor }))
      .toEqual({ state: 'unavailable', failureCode: 'invalid-cursor' })
    const changed = `${first.nextCursor!.slice(0, -1)}!`
    expect(repository.listCollections({ ...query, cursor: changed })).toEqual({ state: 'unavailable', failureCode: 'invalid-cursor' })
  })

  it('paginates one collection only with source/asOf enforcement and zero distinct from missing', () => {
    const { repository } = setup()
    repository.appendCollection(batch('one', [row(2), { ...row(1), estimateValue: null }]))
    const query = { ...scope, collectionId: 'one', asOf: detectedAt, limit: 1 }
    const first = repository.listObservations(query)
    expect(first.state).toBe('succeeded')
    if (first.state !== 'succeeded') throw new Error('expected page')
    expect(first.rows[0]?.source_event_id).toBe('["candidate",1]')
    expect(first.rows[0]?.consensus_json).toBeNull()
    const second = repository.listObservations({ ...query, cursor: first.nextCursor })
    expect(second).toMatchObject({ state: 'succeeded', rows: [{ source_event_id: '["candidate",2]', consensus_json: '{"displayValue":"0"}' }] })
    expect(repository.listObservations({ ...query, locale: 'en' })).toEqual({ state: 'unavailable', failureCode: 'invalid-input' })
    expect(repository.listObservations({ ...query, asOf: '2026-09-07T00:00:00.000Z' })).toEqual({ state: 'unavailable', failureCode: 'invalid-input' })
  })

  it('bounds page input and checks cancellation at call boundaries', () => {
    const { repository } = setup()
    const query = { ...scope, asOf: detectedAt }
    for (const limit of [0, 101, 1.5]) expect(repository.listCollections({ ...query, limit }))
      .toEqual({ state: 'unavailable', failureCode: 'invalid-input' })
    expect(repository.listCollections({ ...query, url: 'forbidden' })).toEqual({ state: 'unavailable', failureCode: 'invalid-input' })
    expect(repository.listCollections(query, { signal: AbortSignal.abort() })).toEqual({ state: 'unavailable', failureCode: 'cancelled' })
  })

  it('accounts for allocated SQLite pages rather than trusting serialized-byte estimates', () => {
    const { database, capacity, repository } = setup()
    // A sparse batch dirties several pages even though its JSON is much smaller.
    capacity.marketBytes = 20 * 1024 ** 3 - 4096
    expect(repository.appendCollection(batch('one', []))).toEqual({ state: 'unavailable', failureCode: 'storage-pressure' })
    expect(database.prepare('select * from mi_macro_calendar_market_event_collections').all()).toEqual([])
  })

  it('preserves the exact old reservation boundary including escaping and multibyte fields', () => {
    const { database, repository, capacity, context } = setup()
    const input = batch('reserve', [{ ...row(), calendarName: 'Quoted "value" \\ 中文 😀 \ud800' }])
    const prepared = prepareMarketCollection(input, context)
    const pageSize = Number(database.prepare('pragma page_size').get()?.page_size)
    const reserve = Buffer.byteLength(JSON.stringify({ collection: prepared.collection, observations: prepared.observations })) *
      policy.indexReserveMultiplier + policy.transactionReservePages * (pageSize + policy.walFrameHeaderBytes)
    capacity.freeBytes = policy.minimumFreeBytes + reserve - 1
    expect(repository.appendCollection(input)).toEqual({ state: 'unavailable', failureCode: 'storage-pressure' })
    capacity.freeBytes += 1
    expect(repository.appendCollection(input)).toMatchObject({ state: 'succeeded', inserted: true })
  })

  it('cancels during a real transaction and leaves no parent or observations', () => {
    const { database } = setup()
    const abort = new AbortController()
    database.function('cancel_market_write', () => { abort.abort(); return 0 })
    database.exec(`create trigger cancel_insert after insert on mi_macro_calendar_market_event_observations
      begin select cancel_market_write(); end`)
    const repository = createMarketCalendarEventRepository({ database, cursorKey: Buffer.alloc(32),
      resolveCollectionContext: () => ({ ...scope, detectedAt, evidence }),
      readCapacity: () => ({ marketBytes: 0, walBytes: 0, freeBytes: 10 * 1024 ** 3, archiveAvailable: true }), now: () => detectedAt })
    expect(repository.appendCollection(batch('one', [row(), row(2)]), { signal: abort.signal }))
      .toEqual({ state: 'unavailable', failureCode: 'cancelled' })
    expect(database.prepare('select * from mi_macro_calendar_market_event_collections').all()).toEqual([])
    expect(database.prepare('select * from mi_macro_calendar_market_event_observations').all()).toEqual([])
    expect(database.isTransaction).toBe(false)
  })

  it('bounds native prepared statements per batch instead of allocating one per observation', () => {
    const { database, repository } = setup()
    const prepare = vi.spyOn(database, 'prepare')
    expect(repository.appendCollection(batch('one', Array.from({ length: 1000 }, (_, index) => row(index + 1)))).state).toBe('succeeded')
    expect(prepare.mock.calls.length).toBeLessThanOrEqual(10)
    prepare.mockRestore()
  })

  it('reports a post-commit deadline safely and permits an exact retry without duplicate writes', () => {
    const { database } = setup()
    let elapsed = 0
    const original = database.exec.bind(database)
    vi.spyOn(database, 'exec').mockImplementation((sql) => { original(sql); if (sql === 'commit') elapsed = 2000 })
    const repository = createMarketCalendarEventRepository({ database, monotonicNow: () => elapsed,
      resolveCollectionContext: () => ({ ...scope, detectedAt, evidence }), now: () => detectedAt,
      readCapacity: () => ({ marketBytes: 0, walBytes: 0, freeBytes: 10 * 1024 ** 3, archiveAvailable: true }) })
    expect(repository.appendCollection(batch())).toEqual({ state: 'unavailable', failureCode: 'deadline-exceeded' })
    vi.mocked(database.exec).mockRestore()
    expect(repository.appendCollection(batch())).toMatchObject({ state: 'succeeded', inserted: false })
    expect(database.prepare('select collection_id from mi_macro_calendar_market_event_collections').all()).toHaveLength(1)
  })
})
