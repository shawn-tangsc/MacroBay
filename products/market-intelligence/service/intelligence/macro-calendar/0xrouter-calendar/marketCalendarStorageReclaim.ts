import type { DatabaseSync } from 'node:sqlite'
import { marketCalendarObservationStateFields,
  marketCalendarEffectiveLogicalBytes } from './marketCalendarStorageValidation'

/**
 * Retention is defined once, per data class.
 *
 * - Market event samples: 90 days. The shared calendar is a *shared* library whose whole
 *   footprint is charged to one ceiling, and the provider re-publishes every event on every
 *   collection, so an unbounded sample history grows ~100 MB/day while the current month is
 *   the only window the calendar UI shows. 90 days keeps three full months of history —
 *   enough to still explain "what did we see before the release" — without paying for years
 *   of identical resamples. Configurable through the option, not by editing this constant.
 * - Official values and revisions (`mi_macro_calendar_revisions`) and the BLS/BEA/Fed
 *   official-release state are authoritative, permanently small, and are never deleted or
 *   deduplicated here.
 * - Evidence archive bodies (`macro-calendar-evidence/<sha256>.bin`) are the audit trail and
 *   live outside this database. This module never opens, moves, rewrites or deletes them.
 */
export const marketCalendarRetentionPolicy = Object.freeze({
  marketObservationRetentionMs: 90 * 24 * 60 * 60 * 1000,
  /** Rows one run may delete or update before it stops and reports `limited: true`. */
  defaultMaximumRowsPerRun: 40_000,
  /** Rows one run may read while deciding; reaching it reports `limited: true` instead of unbounded work. */
  maximumRowsExamined: 400_000,
  maintenanceIndex: 'idx_mi_calendar_market_observation_state',
  /** Supports reading one collection's observations in identity order. */
  collectionScanIndex: 'idx_mi_calendar_market_observation_collection',
  /**
   * Supports the current-state read: walking identities in `candidate_key` order and
   * looking up each identity's row in the collection that last stored one.
   */
  identityScanIndex: 'idx_mi_calendar_market_observation_identity',
  ledgerTable: 'mi_macro_calendar_market_observation_ledger',
})

export type MarketCalendarReclaimResult = Readonly<{
  /** Rows removed because an identical sample followed them (first and last of a run are kept). */
  deduplicatedRows: number
  /** Rows removed for being older than the retention window (oldest first, never a sole row per event). */
  expiredRows: number
  rowsExamined: number
  /** True when a per-run work bound stopped the pass; running again continues from the new state. */
  limited: boolean
  logicalBytesBefore: number
  logicalBytesAfter: number
  pageCountBefore: number
  pageCountAfter: number
  freelistCountBefore: number
  freelistCountAfter: number
}>

export function readMarketCalendarBilling(database: DatabaseSync) {
  const read = (pragma: string) => {
    try { return database.prepare(`pragma ${pragma}`).get()?.[pragma] } catch { return undefined }
  }
  const pageSize = read('page_size')
  const pageCount = read('page_count')
  const freelistCount = read('freelist_count')
  return { pageSize: Number(pageSize), pageCount: Number(pageCount), freelistCount: Number(freelistCount),
    logicalBytes: marketCalendarEffectiveLogicalBytes({ pageSize, pageCount, freelistCount }) }
}

// MC-V1 maintenance, product-owned. Manual-only: no timer and no automatic startup run.
export function reclaimMarketCalendarStorage(database: DatabaseSync,
  options: { now?: () => number; maximumRowsPerRun?: number } = {}): MarketCalendarReclaimResult {
  const now = options.now?.() ?? Date.now()
  const budget = options.maximumRowsPerRun ?? marketCalendarRetentionPolicy.defaultMaximumRowsPerRun
  const limit = Number.isSafeInteger(budget) && budget > 0 ? budget : marketCalendarRetentionPolicy.defaultMaximumRowsPerRun
  const before = readMarketCalendarBilling(database)
  const cutoff = new Date(now - marketCalendarRetentionPolicy.marketObservationRetentionMs).toISOString()
  database.exec(`create index if not exists ${marketCalendarRetentionPolicy.maintenanceIndex}
    on mi_macro_calendar_market_event_observations(candidate_key, last_seen_at desc)`)
  database.exec('begin immediate')
  try {
    const plan = planReclaim(database, cutoff, limit)
    apply(database, plan, limit)
    const after = readMarketCalendarBilling(database)
    database.exec('commit')
    return Object.freeze({ deduplicatedRows: plan.deduplicated, expiredRows: plan.expired,
      rowsExamined: plan.examined, limited: plan.limited,
      logicalBytesBefore: before.logicalBytes, logicalBytesAfter: after.logicalBytes,
      pageCountBefore: before.pageCount, pageCountAfter: after.pageCount,
      freelistCountBefore: before.freelistCount, freelistCountAfter: after.freelistCount })
  } catch (error) {
    database.exec('rollback')
    throw error
  }
}

/** Reclaiming file bytes is separate from billing: it needs exclusive access and a full copy. */
export function vacuumMarketCalendarStorage(database: DatabaseSync): void {
  database.exec('vacuum')
}

type StoredRow = { observation_id: string; fact_key: string; seen_at: string; sequence: number }
type Plan = { deleteIds: string[]; deduplicated: number; expired: number; examined: number; limited: boolean }
const stateOf = (row: Record<string, unknown>) => JSON.stringify(
  marketCalendarObservationStateFields.map((field) => row[field] === undefined || row[field] === null ? null : String(row[field])))

/**
 * One pass over the stored rows, grouped by event identity in the order they were observed.
 *
 * Consecutive identical samples collapse to their first and last copy, so a reader keeps
 * both when the value was first and last seen while the resamples in between stop costing
 * pages. Retention then removes whatever is older than the window, oldest first, but never
 * the newest surviving row of an event: a current event must not disappear from the calendar
 * just because the collector stopped touching it.
 */
function planReclaim(database: DatabaseSync, cutoff: string, limit: number): Plan {
  // Grouped by the stable event identity, never by `candidate_key`: that one embeds the
  // collection id, so it would make every batch its own event and hide the duplicates this
  // whole pass exists to remove.
  const rows = database.prepare(`select o.observation_id, o.market_fact_key as fact_key,
      c.detected_at as seen_at, c.collection_sequence as sequence,
      o.scheduled_at, o.consensus_json, o.provider_previous_json, o.provider_actual_json, o.provider_impact_json, o.importance
    from mi_macro_calendar_market_event_observations as o
    join mi_macro_calendar_market_event_collections as c on c.collection_id = o.collection_id
    order by o.market_fact_key, c.collection_sequence, o.observation_id`)
    .all() as unknown as StoredRow[]
  const plan: Plan = { deleteIds: [], deduplicated: 0, expired: 0,
    examined: rows.length, limited: rows.length >= marketCalendarRetentionPolicy.maximumRowsExamined }
  const doomed = new Set<string>()

  const expire = (row: StoredRow, reason: 'deduplicated' | 'expired') => {
    if (doomed.has(row.observation_id)) return
    if (plan.deleteIds.length >= limit) { plan.limited = true; return }
    plan.deleteIds.push(row.observation_id)
    doomed.add(row.observation_id)
    if (reason === 'deduplicated') plan.deduplicated++
    else plan.expired++
  }
  let index = 0
  while (index < rows.length) {
    const key = rows[index]!.fact_key
    let end = index
    while (end + 1 < rows.length && rows[end + 1]!.fact_key === key) end++
    const group = rows.slice(index, end + 1)
    index = end + 1
    // 1. Consecutive identical samples collapse to their first and last copy, so the moment a
    //    value was first and last seen survives on the collapsed scale instead of one row per
    //    batch.
    const keep = new Set<string>([group[0]!.observation_id, group.at(-1)!.observation_id])
    for (let position = 1; position < group.length - 1; position++) {
      if (stateOf(group[position]!) !== stateOf(group[position - 1]!)) keep.add(group[position]!.observation_id)
    }
    for (const row of group) if (!keep.has(row.observation_id)) expire(row, 'deduplicated')
    // 2. Retention then removes every stored sample observed before the window. This includes
    //    the first copy step 1 kept: at this point that copy is only a timing record for a
    //    value the event's current row still carries, or for an event the provider has not
    //    mentioned in the retention window at all. A sample outside the window is not current
    //    state, so nothing that a reader needs disappears.
    for (const row of [...group].sort((left, right) => left.sequence - right.sequence)) {
      if (row.seen_at >= cutoff) continue
      expire(row, 'expired')
    }
  }
  return plan
}

/**
 * Applies the plan inside the caller's transaction. `last_seen_at` is deliberately left alone:
 * it records when the row's own observation was collected, and retention judges superseded
 * samples by their collection order. The last-seen ledger belongs to the write path only.
 */
function apply(database: DatabaseSync, plan: Plan, limit: number): void {
  const remove = database.prepare('delete from mi_macro_calendar_market_event_observations where observation_id = ?')
  for (const id of plan.deleteIds.slice(0, limit)) remove.run(id)
}

/**
 * The row column and its lookup index, added to a library that predates them.
 *
 * Backfill uses each observation's own collection time, which is the truth we already
 * stored; nothing is inferred from the clock at migration time.
 */
export function ensureMarketCalendarObservationState(database: DatabaseSync): boolean {
  const fields = database.prepare('pragma table_info(mi_macro_calendar_market_event_observations)')
    .all() as unknown as { name: string }[]
  const added = !fields.some((field) => field.name === 'last_seen_at')
  if (added) {
    database.exec('alter table mi_macro_calendar_market_event_observations add column last_seen_at text')
    database.exec(`update mi_macro_calendar_market_event_observations as o
      set last_seen_at = (select c.detected_at from mi_macro_calendar_market_event_collections as c
        where c.collection_id = o.collection_id)
      where o.last_seen_at is null`)
  }
  database.exec(`create table if not exists ${marketCalendarRetentionPolicy.ledgerTable} (
    candidate_key text primary key, last_seen_at text not null)`)
  database.exec(`create index if not exists ${marketCalendarRetentionPolicy.maintenanceIndex}
    on mi_macro_calendar_market_event_observations(candidate_key, last_seen_at desc)`)
  database.exec(`create index if not exists ${marketCalendarRetentionPolicy.collectionScanIndex}
    on mi_macro_calendar_market_event_observations(collection_id, candidate_key)`)
  // Current-state reads page by event identity, not by batch, so they need the identity
  // first: the planner walks this index in `candidate_key` order and, for each identity,
  // resolves the newest collection that stored a row. Without it that walk falls back to
  // scanning every row in scope for every page.
  database.exec(`create index if not exists ${marketCalendarRetentionPolicy.identityScanIndex}
    on mi_macro_calendar_market_event_observations(candidate_key, collection_id)`)
  return added
}
