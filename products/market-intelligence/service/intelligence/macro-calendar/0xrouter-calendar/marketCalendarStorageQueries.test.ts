import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import { createMarketCalendarEventRepository } from './marketCalendarEventRepository'
import { createMarketCalendarStorageQueries } from './marketCalendarStorageQueries'
import { parseZeroXRouterEconomicData } from './zeroXRouterEconomicDataParser'

const cleanups: (() => void)[] = []
afterEach(() => { for (const cleanup of cleanups.splice(0).reverse()) cleanup() })
const scope = { providerId: '0xrouter', descriptorId: 'macro-calendar-0xrouter-economic-data', locale: 'zh', month: '2026-09' }
const asOf = '2026-09-08T00:00:00.000Z'
const key = Buffer.alloc(32, 8)
function open(filePath = ':memory:') {
  const database = new DatabaseSync(filePath)
  createMarketCalendarEventRepository({ database })
  return database
}
// Direct SQL is solely for derived storage boundary fixtures (not application writes).
function collection(database: DatabaseSync, id: string, detectedAt = asOf) {
  database.prepare(`insert into mi_macro_calendar_market_event_collections
    (collection_id, provider_id, descriptor_id, locale, window_start, window_end, detected_at, recorded_at,
     raw_record_id, evidence_hash, parser_version, input_count, skipped_count, skip_reasons_json, status)
    values (?, '0xrouter', ?, 'zh', '2026-09-01T00:00:00.000Z', '2026-09-30T23:59:59.999Z', ?, ?,
      'raw', ?, 'v1', 0, 0, '{}', 'success-empty')`).run(id, scope.descriptorId, detectedAt, asOf, 'a'.repeat(64))
}
const queries = (database: DatabaseSync) => createMarketCalendarStorageQueries(database, key, () => 0)

/**
 * A real writer plus its derived event batches. The writer is what makes "only a changed value
 * is stored" true: the later batches re-send every identity but store a row only for the ones
 * whose value actually changed.
 */
function harness(filePath = ':memory:') {
  const database = open(filePath)
  cleanups.push(() => database.close())
  let detectedAt = '2026-09-01T00:00:00.000Z'
  const repository = createMarketCalendarEventRepository({ database, cursorKey: key,
    resolveCollectionContext: () => ({ ...scope, detectedAt, evidence: { providerId: '0xrouter',
      descriptorId: scope.descriptorId, rawRecordId: 'raw', evidenceHash: 'b'.repeat(64) } }),
    now: () => '2026-09-01T00:00:01.000Z',
    readCapacity: () => ({ marketBytes: 0, walBytes: 0, freeBytes: 10 * 1024 ** 3, archiveAvailable: true }) })
  let minute = 0
  const append = (collectionId: string, identities: number[], actual: (identity: number) => string) => {
    detectedAt = new Date(Date.parse('2026-09-01T00:00:00.000Z') + minute++ * 60_000).toISOString()
    const data = identities.map((id) => ({ calendarId: 'derived', id, calendarName: `Derived ${id}`, locale: 'zh',
      star: 3, pubTimestamp: Date.parse('2026-09-09T12:00:00.000Z'), estimateValue: 0, preValue: null, pubValue: actual(id) }))
    const result = repository.appendCollection({ ...scope, collectionId, parserVersion: 'derived',
      parseResult: parseZeroXRouterEconomicData({ code: 200, msg: '', data }, 'zh') })
    if (result.state !== 'succeeded') throw new Error(`append failed: ${result.failureCode}`)
  }
  return { database, append }
}
function statePages(database: DatabaseSync, limit: number) {
  const rows: Record<string, unknown>[] = []
  let cursor: string | undefined
  for (let page = 0; page < 200; page++) {
    const result = queries(database).listObservationStates({ ...scope, asOf, limit, ...(cursor ? { cursor } : {}) })
    if (result.state !== 'succeeded') throw new Error(result.failureCode)
    rows.push(...result.rows)
    cursor = result.nextCursor
    if (!cursor) break
  }
  return rows
}

describe('market calendar bounded snapshot queries', () => {
  it('retains signed cursors and lossless 64-bit high-water across repository and database restart', () => {
    const directory = mkdtempSync(join(tmpdir(), 'mc3-restart-'))
    cleanups.push(() => rmSync(directory, { recursive: true, force: true }))
    const filePath = join(directory, 'isolated.sqlite')
    let database = open(filePath)
    cleanups.push(() => database.close())
    collection(database, 'c')
    database.prepare("update sqlite_sequence set seq = ? where name = 'mi_macro_calendar_market_event_collections'")
      .run(9007199254740992n)
    collection(database, 'b')
    const first = queries(database).listCollections({ ...scope, asOf, limit: 1 })
    expect(first).toMatchObject({ state: 'succeeded', highWater: '9007199254740993' })
    if (first.state !== 'succeeded') throw new Error('expected page')
    database.close()
    database = open(filePath)
    collection(database, 'a')
    const next = queries(database).listCollections({ ...scope, asOf, limit: 1, cursor: first.nextCursor })
    expect(next).toMatchObject({ state: 'succeeded', rows: [{ collection_id: 'b', collection_sequence: '9007199254740993' }] })
    expect(next.state === 'succeeded' && next.nextCursor).toBeUndefined()
  })

  it('truncates before byte budget without skipping the next row and refuses one overlarge row', () => {
    const database = open()
    cleanups.push(() => database.close())
    for (const id of ['a', 'b', 'c']) collection(database, id)
    database.prepare('update mi_macro_calendar_market_event_collections set skip_reasons_json = ?').run('x'.repeat(120_000))
    const first = queries(database).listCollections({ ...scope, asOf, limit: 100 })
    expect(first.state).toBe('succeeded')
    if (first.state !== 'succeeded') throw new Error('expected page')
    expect(first.rows.map((row) => row.collection_id)).toEqual(['c', 'b'])
    expect(Buffer.byteLength(JSON.stringify(first))).toBeLessThanOrEqual(256 * 1024)
    expect(queries(database).listCollections({ ...scope, asOf, cursor: first.nextCursor }))
      .toMatchObject({ state: 'succeeded', rows: [{ collection_id: 'a' }] })
    database.prepare('update mi_macro_calendar_market_event_collections set skip_reasons_json = ?').run('x'.repeat(300_000))
    expect(queries(database).listCollections({ ...scope, asOf })).toEqual({ state: 'unavailable', failureCode: 'row-too-large' })
  })

  it('fails closed at deadline and on unavailable signing context without holding a read transaction', () => {
    const database = open()
    cleanups.push(() => database.close())
    let elapsed = 0
    const expired = createMarketCalendarStorageQueries(database, key, () => { elapsed += 600; return elapsed })
    expect(expired.listCollections({ ...scope, asOf })).toEqual({ state: 'unavailable', failureCode: 'deadline-exceeded' })
    expect(database.isTransaction).toBe(false)
    expect(createMarketCalendarStorageQueries(database, undefined, () => 0).listCollections({ ...scope, asOf }))
      .toEqual({ state: 'unavailable', failureCode: 'context-unavailable' })
  })

  it('uses both scoped indexes without full historical sorting and returns an empty high-water of zero', () => {
    const database = open()
    cleanups.push(() => database.close())
    expect(queries(database).listCollections({ ...scope, asOf })).toEqual({ state: 'succeeded', rows: [], highWater: '0' })
    const predicate = "provider_id='0xrouter' and descriptor_id='macro-calendar-0xrouter-economic-data' and locale='zh' and window_start='start' and window_end='end'"
    for (const [sort, index] of [['collection_sequence desc', 'high_water'], ['detected_at desc, collection_id desc', 'asof']]) {
      const plan = database.prepare(`explain query plan select * from mi_macro_calendar_market_event_collections where ${predicate} order by ${sort} limit 21`).all()
      expect(plan.some((row) => String(row.detail).includes(`idx_mi_calendar_market_collection_${index}`))).toBe(true)
      expect(plan.some((row) => /SCAN|TEMP B-TREE/.test(String(row.detail)))).toBe(false)
    }
  })

  it('preserves old reads during a long WAL reader and safely refuses a busy writer', () => {
    const directory = mkdtempSync(join(tmpdir(), 'mc3-wal-reader-'))
    cleanups.push(() => rmSync(directory, { recursive: true, force: true }))
    const path = join(directory, 'isolated.sqlite')
    const writer = open(path)
    cleanups.push(() => writer.close())
    writer.exec('pragma journal_mode=wal')
    collection(writer, 'before')
    const reader = new DatabaseSync(path)
    cleanups.push(() => reader.close())
    reader.exec('begin')
    reader.prepare('select collection_id from mi_macro_calendar_market_event_collections').all()
    collection(writer, 'after')
    const started = performance.now()
    const checkpoint = writer.prepare('pragma wal_checkpoint(passive)').get()!
    expect(Number(checkpoint.log)).toBeGreaterThan(Number(checkpoint.checkpointed))
    expect(reader.prepare('select collection_id from mi_macro_calendar_market_event_collections').all()).toEqual([{ collection_id: 'before' }])
    console.info('MC3 bounded long-reader checkpoint', JSON.stringify({ elapsedMs: performance.now() - started,
      logFrames: checkpoint.log, checkpointedFrames: checkpoint.checkpointed }))
    reader.exec('rollback; begin immediate')
    const repository = createMarketCalendarEventRepository({ database: writer, now: () => asOf,
      resolveCollectionContext: () => ({ ...scope, detectedAt: asOf, evidence: { providerId: '0xrouter', descriptorId: scope.descriptorId,
        rawRecordId: 'raw', evidenceHash: 'a'.repeat(64) } }) })
    expect(repository.appendCollection({ ...scope, collectionId: 'busy', parserVersion: 'v1', parseResult: {
      state: 'succeeded', drafts: [], diagnostics: { inputRows: 0, skippedRows: 0,
        reasons: { 'invalid-identity': 0, 'invalid-date': 0, 'invalid-row': 0 } }
    } })).toEqual({ state: 'unavailable', failureCode: 'storage-unavailable' })
    reader.exec('rollback')
    expect(queries(writer).listCollections({ ...scope, asOf })).toMatchObject({ state: 'succeeded', rows: [
      { collection_id: 'before' }, { collection_id: 'after' }
    ] })
  })

  it('pages every identity whose newest stored row predates a run of change-only collections', () => {
    const { database, append } = harness()
    const identities = Array.from({ length: 20 }, (_, index) => index + 1)
    append('oldest', identities, () => '1')
    // Five later batches re-send all twenty identities; only the top three changed, so only
    // those three get a row in each of them. The other seventeen current rows stay in `oldest`.
    for (let batch = 0; batch < 5; batch++) {
      append(`newer-${batch}`, identities, (id) => id >= 18 ? String(2 + batch) : '1')
    }
    expect(database.prepare('select count(*) as n from mi_macro_calendar_market_event_observations where collection_id = ?')
      .get('oldest')?.n).toBe(20)
    for (let batch = 0; batch < 5; batch++) {
      expect(database.prepare('select count(*) as n from mi_macro_calendar_market_event_observations where collection_id = ?')
        .get(`newer-${batch}`)?.n).toBe(3)
    }
    const rows = statePages(database, 2)
    expect(rows).toHaveLength(20)
    expect(new Set(rows.map((row) => row.candidate_key)).size).toBe(20)
  })

  it('keeps advancing when every row in the lookahead belongs to an identity already emitted', () => {
    const { database, append } = harness()
    const identities = [1, 2, 3, 4, 5]
    append('oldest', identities, () => '1')
    for (let batch = 0; batch < 5; batch++) {
      append(`newer-${batch}`, identities, (id) => id === 5 ? String(2 + batch) : '1')
    }
    // Before the fix the first page sampled only the newer copies of identity 5, advanced the
    // cursor to it, and reported completion: identities 1-4 were permanently excluded.
    const rows = statePages(database, 1)
    expect(rows.map((row) => row.candidate_key)).toHaveLength(5)
    expect(new Set(rows.map((row) => row.candidate_key)).size).toBe(5)
  })

  it('partitions identities so every limit=1 page union equals one limit=100 read', () => {
    const { database, append } = harness()
    const identities = Array.from({ length: 100 }, (_, index) => index + 1)
    append('oldest', identities, () => '1')
    // Sparse later changes leave most current rows in `oldest`, which is the shape that broke
    // the old newest-first row window.
    append('newer', identities, (id) => id % 7 === 0 ? '2' : '1')
    const oneShot = queries(database).listObservationStates({ ...scope, asOf, limit: 100 })
    expect(oneShot.state).toBe('succeeded')
    if (oneShot.state !== 'succeeded') throw new Error('expected a page')
    expect(oneShot.rows).toHaveLength(100)
    expect(oneShot.nextCursor).toBeUndefined()
    const paged = statePages(database, 1)
    expect(paged.map((row) => row.candidate_key)).toEqual(oneShot.rows.map((row) => row.candidate_key))
    expect(new Set(paged.map((row) => row.candidate_key)).size).toBe(100)
  })

  it('resumes a signed current-state cursor on a fresh connection and still fails without a key', () => {
    const directory = mkdtempSync(join(tmpdir(), 'mc3-state-restart-'))
    cleanups.push(() => rmSync(directory, { recursive: true, force: true }))
    const path = join(directory, 'isolated.sqlite')
    const { database, append } = harness(path)
    append('oldest', [1, 2], () => '1')
    append('newer', [2], () => '2')
    const first = queries(database).listObservationStates({ ...scope, asOf, limit: 1 })
    expect(first).toMatchObject({ state: 'succeeded', highWater: '2' })
    if (first.state !== 'succeeded') throw new Error('expected a page')
    expect(first.rows.map((row) => row.candidate_key).length).toBe(1)
    expect(first.nextCursor).toBeDefined()
    const reopened = new DatabaseSync(path)
    cleanups.push(() => reopened.close())
    const next = createMarketCalendarStorageQueries(reopened, key, () => 0)
      .listObservationStates({ ...scope, asOf, limit: 1, cursor: first.nextCursor })
    expect(next.state).toBe('succeeded')
    if (next.state !== 'succeeded') throw new Error('expected a page')
    expect(next.rows).toHaveLength(1)
    expect(next.rows[0]!.candidate_key).not.toBe(first.rows[0]!.candidate_key)
    expect(next.nextCursor).toBeUndefined()
    expect(createMarketCalendarStorageQueries(reopened, undefined, () => 0).listObservationStates({ ...scope, asOf }))
      .toEqual({ state: 'unavailable', failureCode: 'context-unavailable' })
  })

  it('truncates an observation page at the byte budget without losing the tail and fails closed at deadline', () => {
    const { database, append } = harness()
    append('oldest', [1, 2], () => '1')
    database.prepare("update mi_macro_calendar_market_event_observations set display_name = ? where collection_id = 'oldest'")
      .run('x'.repeat(600_000))
    const first = queries(database).listObservationStates({ ...scope, asOf, limit: 2 })
    expect(first.state).toBe('succeeded')
    if (first.state !== 'succeeded') throw new Error('expected a page')
    expect(first.rows).toHaveLength(1)
    expect(first.nextCursor).toBeDefined()
    const rest = queries(database).listObservationStates({ ...scope, asOf, limit: 2, cursor: first.nextCursor })
    expect(rest).toMatchObject({ state: 'succeeded' })
    if (rest.state !== 'succeeded') throw new Error('expected a page')
    expect(rest.rows).toHaveLength(1)
    let elapsed = 0
    const expired = createMarketCalendarStorageQueries(database, key, () => { elapsed += 600; return elapsed })
    expect(expired.listObservationStates({ ...scope, asOf })).toEqual({ state: 'unavailable', failureCode: 'deadline-exceeded' })
    expect(database.isTransaction).toBe(false)
  })
})
