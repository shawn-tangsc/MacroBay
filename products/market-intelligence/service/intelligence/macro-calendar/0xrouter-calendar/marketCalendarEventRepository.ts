import type { DatabaseSync } from 'node:sqlite'
import { calendarRecord } from './zeroXRouterCalendarContracts'
import { instant, marketCalendarEffectiveLogicalBytes, marketCalendarObservationStateFields, MarketStorageFailure,
  metadata, prepareMarketCollection, reject, zeroXRouterCalendarStoragePolicy as policy,
  type MarketCapacity, type MarketCollectionContext, type MarketRow } from './marketCalendarStorageValidation'
import { createMarketCalendarStorageQueries, operationGuard, type MarketOperationControl } from './marketCalendarStorageQueries'
import { captureMarketStorageSnapshot } from './marketCalendarStorageSnapshot'
import { ensureMarketCalendarObservationState, marketCalendarRetentionPolicy } from './marketCalendarStorageReclaim'

// MC-V1 design 122: conservative shared-calendar charge, not market attribution.
// Opted into only by the manual runtime; official writes remain unrestricted.
//
// 2 GiB since 2026-10-14 (product-accepted; was 256 MiB). The charge covers the
// whole shared library (effective pages x page_size, official tables included), so
// the old value was a *library* ceiling, not a market-attribution one. The live
// library reached 65520 x 4096 = 268369920 B, only 65536 B below it, and from
// 2026-10-14T02:45Z every collection that carried content — including the already
// released September US CPI — was refused here and rolled back, so the product kept
// showing a stale batch while the source kept publishing. The gate itself is
// unchanged: still fail-closed, no partial write, no silent drop, still reported as
// `storage-pressure`.
//
// Since 2026-10-15 the charge measures *effective* bytes, `(page_count - freelist_count)
// x page_size` (see `marketCalendarEffectiveLogicalBytes`). The old charge counted pages
// SQLite had already returned to its freelist, so a trimmed library stayed full until the
// file itself shrank — which, with `auto_vacuum = off`, never happened. Space that has
// been reclaimed is now immediately usable again, while an unreadable or inconsistent
// freelist reading still charges the full page count.
export const ManualCalendarCapacityPolicy = Object.freeze({ sharedLogicalBytes: 2 * 1024 ** 3 })

export function createMarketCalendarEventRepository(options: {
  database: DatabaseSync
  resolveCollectionContext?: (collectionId: string) => MarketCollectionContext | undefined
  readCapacity?: () => MarketCapacity
  now?: () => string
  cursorKey?: Uint8Array
  monotonicNow?: () => number
  manualCapacityAdmission?: true
}) {
  const database = options.database
  database.exec(`
    create table if not exists mi_macro_calendar_market_event_collections (
      collection_sequence integer primary key autoincrement,
      collection_id text not null unique,
      provider_id text not null, descriptor_id text not null, locale text not null,
      window_start text not null, window_end text not null,
      detected_at text not null, recorded_at text not null,
      raw_record_id text not null, evidence_hash text not null, parser_version text not null,
      input_count integer not null, skipped_count integer not null, skip_reasons_json text not null,
      status text not null check(status in ('success', 'success-empty', 'all-skipped', 'partial'))
    );
    create table if not exists mi_macro_calendar_market_event_observations (
      observation_id text primary key,
      collection_id text not null references mi_macro_calendar_market_event_collections(collection_id),
      provider_id text not null, descriptor_id text not null, locale text not null,
      source_event_id text not null, identity_state text not null check(identity_state = 'unverified'),
      market_fact_key text not null, indicator_id text, event_kind text not null,
      display_name text not null, country_code text, country_name text, importance text not null,
      scheduled_date text not null, scheduled_at text not null,
      consensus_json text, provider_previous_json text, provider_actual_json text,
      provider_impact_json text, provider_time_status text,
      business_snapshot_hash text not null, caveats_json text not null,
      schema_version integer not null, candidate_key text not null,
      last_seen_at text,
      unique(collection_id, candidate_key)
    );
    create index if not exists idx_mi_calendar_market_collection_asof
      on mi_macro_calendar_market_event_collections(
        provider_id, descriptor_id, locale, window_start, window_end, detected_at desc, collection_id desc);
    create index if not exists idx_mi_calendar_market_collection_high_water
      on mi_macro_calendar_market_event_collections(
        provider_id, descriptor_id, locale, window_start, window_end, collection_sequence desc);
    create table if not exists mi_macro_calendar_provider_indicator_links (
      provider_id text not null, descriptor_id text not null, source_indicator_id text not null,
      canonical_metric text not null, official_provider_id text not null, country_code text not null,
      unit text not null, period_kind text not null, release_variant text, expectation_shape text,
      evidence_hash text not null, admitted_at text not null, schema_version integer not null,
      primary key(provider_id, descriptor_id, source_indicator_id)
    );
  `)
  // A library written before the write model changed has no `last_seen_at` column and no
  // last-seen ledger; this adds them and backfills from each row's own collection time.
  ensureMarketCalendarObservationState(database)
  /**
   * The one shared admission charge: allocated pages minus pages SQLite already returned to
   * its freelist. Never a second copy of the formula, and never a credit when the freelist
   * reading is missing or inconsistent.
   */
  function readBilling() {
    const reading = (pragma: string) => {
      try { return database.prepare(`pragma ${pragma}`).get()?.[pragma] } catch { return undefined }
    }
    const pageSize = reading('page_size')
    const pageCount = reading('page_count')
    const freelistCount = reading('freelist_count')
    return { pageSize: Number(pageSize), effectiveBytes: marketCalendarEffectiveLogicalBytes({ pageSize, pageCount, freelistCount }) }
  }
  let previousState: ReturnType<typeof database.prepare> | undefined
  return {
    ...createMarketCalendarStorageQueries(database, options.cursorKey, options.monotonicNow ?? (() => performance.now())),
    appendCollection(input: unknown, control?: MarketOperationControl) {
      let transaction = false
      try {
        const check = operationGuard(control, options.monotonicNow ?? (() => performance.now()))
        check()
        input = captureMarketStorageSnapshot(input)
        const collectionId = calendarRecord(input)?.collectionId
        if (!metadata(collectionId)) reject('invalid-input')
        const context = captureMarketStorageSnapshot(options.resolveCollectionContext?.(collectionId), 'context') as MarketCollectionContext | undefined
        const prepared = prepareMarketCollection(input, context, check)
        check()
        database.exec('begin immediate')
        transaction = true
        const existingStatement = database.prepare('select * from mi_macro_calendar_market_event_collections where collection_id = ?')
        existingStatement.setReadBigInts(true)
        const existing = existingStatement.get(collectionId)
        if (existing) {
          const same = Object.entries(prepared.collection).every(([key, value]) => String(existing[key]) === String(value))
          if (!same) reject('collection-conflict')
          const count = database.prepare('select count(*) as count from mi_macro_calendar_market_event_observations where collection_id = ?').get(collectionId)
          const child = database.prepare('select * from mi_macro_calendar_market_event_observations where collection_id = ? and candidate_key = ?')
          // An exact retry of an accepted batch must replay the same decisions. A row is
          // present here exactly when it was not a duplicate of an *earlier* collection's
          // state, which is a function of stored content and collection order alone — never
          // of a clock reading.
          let expected = 0
          prepareMarketCollection(input, context, (row) => {
            check()
            const duplicate = previousObservationState(String(row.candidate_key), existing.collection_sequence, row)
            const stored = child.get(collectionId, row.candidate_key)
            if (Boolean(stored) === Boolean(duplicate)) reject('collection-conflict')
            if (stored && !sameObservationState(stored, row)) reject('collection-conflict')
            expected++
          }, String(existing.recorded_at))
          if (Number(count?.count) !== expected) reject('collection-conflict')
          check()
          database.exec('commit')
          transaction = false
          check()
          return { state: 'succeeded' as const, inserted: false, collectionId,
            sequence: String(existing.collection_sequence), recordedAt: String(existing.recorded_at) }
        }
        const recordedAt = options.now?.()
        if (!instant(recordedAt)) reject('context-unavailable')
        const capacity = options.readCapacity?.()
        const admission = readBilling()
        const pageSize = admission.pageSize
        const pagesBefore = Number(database.prepare('pragma page_count').get()?.page_count)
        const reserve = prepared.serializedBytes * policy.indexReserveMultiplier +
          policy.transactionReservePages * (pageSize + policy.walFrameHeaderBytes)
        if (options.manualCapacityAdmission &&
          (!Number.isSafeInteger(admission.effectiveBytes) || admission.effectiveBytes + reserve > ManualCalendarCapacityPolicy.sharedLogicalBytes)) reject('storage-pressure')
        if (!capacity || !capacity.archiveAvailable ||
          [capacity.marketBytes, capacity.walBytes, capacity.freeBytes].some((value) => !Number.isSafeInteger(value) || value < 0) ||
          capacity.marketBytes + reserve > policy.marketBytes || capacity.walBytes + reserve > policy.walBytes ||
          capacity.freeBytes < policy.minimumFreeBytes + reserve) reject('storage-pressure')
        check()
        const inserted = insert('mi_macro_calendar_market_event_collections', { ...prepared.collection, recorded_at: recordedAt })
        let statement: ReturnType<typeof prepareInsert> | undefined
        let previous: ReturnType<typeof database.prepare> | undefined
        let seen: ReturnType<typeof database.prepare> | undefined
        let skipped = 0
        prepareMarketCollection(input, context, (row) => {
          check()
          previous ??= database.prepare(`select o.scheduled_at, o.consensus_json, o.provider_previous_json, o.provider_actual_json,
              o.provider_impact_json, o.importance
            from mi_macro_calendar_market_event_observations as o
            join mi_macro_calendar_market_event_collections as c on c.collection_id = o.collection_id
            where o.candidate_key = ? and c.collection_sequence < ?
            order by c.collection_sequence desc limit 1`)
          // Only a real change of the business values becomes a new observation row. An
          // identical resample costs one ledger upsert instead of a row plus three index
          // entries, which is what kept this library at 232,479 rows for 3,938 distinct samples.
          const latest = previous.get(row.candidate_key, inserted.lastInsertRowid)
          if (sameObservationState(latest, row)) {
            skipped++
            seen ??= database.prepare(`insert into ${marketCalendarRetentionPolicy.ledgerTable}(candidate_key, last_seen_at)
              values (?, ?) on conflict(candidate_key) do update set last_seen_at = excluded.last_seen_at
              where excluded.last_seen_at > last_seen_at`)
            seen.run(row.candidate_key, recordedAt)
            return
          }
          statement ??= prepareInsert('mi_macro_calendar_market_event_observations', row)
          statement.run(...Object.values(row))
        }, recordedAt)
        const allocated = Math.max(0, Number(database.prepare('pragma page_count').get()?.page_count) - pagesBefore) * pageSize
        if (capacity.marketBytes + allocated > policy.marketBytes || capacity.freeBytes - allocated < policy.minimumFreeBytes) reject('storage-pressure')
        if (options.manualCapacityAdmission) {
          const current = options.readCapacity?.()
          const logicalBytes = readBilling().effectiveBytes
          if (!Number.isSafeInteger(logicalBytes) || logicalBytes > ManualCalendarCapacityPolicy.sharedLogicalBytes ||
            !current?.archiveAvailable || [current.marketBytes, current.walBytes, current.freeBytes].some(value => !Number.isSafeInteger(value) || value < 0) ||
            current.marketBytes > policy.marketBytes || current.walBytes + reserve > policy.walBytes ||
            current.freeBytes < policy.minimumFreeBytes + reserve) reject('storage-pressure')
        }
        check()
        database.exec('commit')
        transaction = false
        // A synchronous commit cannot be interrupted. An overdue committed batch
        // is still durable; retrying its same trusted context is idempotent.
        check()
        return { state: 'succeeded' as const, inserted: true, collectionId,
          sequence: String(inserted.lastInsertRowid), recordedAt }
      } catch (error) {
        if (transaction) database.exec('rollback')
        return { state: 'unavailable' as const,
          failureCode: error instanceof MarketStorageFailure ? error.failureCode : 'storage-unavailable' as const }
      }
    }
  }

  function insert(table: string, row: MarketRow) {
    return prepareInsert(table, row).run(...Object.values(row))
  }
  function prepareInsert(table: string, row: MarketRow) {
    const statement = database.prepare(`insert into ${table} (${Object.keys(row).join(',')}) values (${Object.keys(row).map(() => '?').join(',')})`)
    statement.setReadBigInts(true)
    return statement
  }
  /** True when `row` carries the same business values as the latest stored sample. */
  function sameObservationState(stored: unknown, row: MarketRow): boolean {
    if (!stored || typeof stored !== 'object') return false
    const record = stored as Record<string, unknown>
    return marketCalendarObservationStateFields.every((field) => {
      const expected = row[field]
      return record[field] === (expected === undefined ? null : expected)
    })
  }
  /**
   * True when `row` duplicates the business values stored for one event identity by an
   * *earlier* collection than `sequence`. Content plus collection order decide it, so a
   * replay of an accepted batch reproduces the same answer. The statement is cached because
   * a replay compares one row per prepared observation.
   */
  function previousObservationState(candidateKey: string, sequence: unknown, row: MarketRow): boolean {
    previousState ??= database.prepare(`select o.scheduled_at, o.consensus_json, o.provider_previous_json, o.provider_actual_json,
        o.provider_impact_json, o.importance
      from mi_macro_calendar_market_event_observations as o
      join mi_macro_calendar_market_event_collections as c on c.collection_id = o.collection_id
      where o.candidate_key = ? and c.collection_sequence < ?
      order by c.collection_sequence desc limit 1`)
    return sameObservationState(previousState.get(candidateKey, sequence as bigint), row)
  }
}
