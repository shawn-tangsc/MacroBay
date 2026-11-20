import { dirname } from 'node:path'
import { mkdirSync } from 'node:fs'
import { openSqliteDatabase } from '@platform/storage/sqlite/openSqliteDatabase'

import { etfCurrentStateWindowPolicy, etfWindowSource, type EtfCurrentStateWindow, type EtfDailyFlow } from '../etf/etfCurrentStateWindow'
import {
  etfCurrentStateStorePolicy, isCanonicalUtcMillis, isCanonicalWindow, isSafeState, isValidEtfCurrentState,
  migrateEtfCurrentState, windowFromHistoryEntry,
  type EtfCurrentState, type EtfCurrentStateHistoryEntry, type EtfCurrentStateStorage, type EtfHistoryRow
} from './etfCurrentStateSchema'

// 公开面不变：形状、策略、迁移与校验仍从这个模块拿（调用方与用例零改动，实现搬去了 schema 那一份）。
export {
  etfCurrentStateStorePolicy, isValidEtfCurrentState, migrateEtfCurrentState,
  type EtfCurrentState, type EtfCurrentStateHealth, type EtfCurrentStateHistoryEntry,
  type EtfCurrentStateStorage, type EtfHistoryRow
} from './etfCurrentStateSchema'

export type EtfCurrentStateStore = ReturnType<typeof createEtfCurrentStateStore>

export function createEtfCurrentStateStore(deps: { storage: EtfCurrentStateStorage }) {
  let cached: EtfCurrentState | undefined
  let readFailed = false

  async function current(): Promise<EtfCurrentState> {
    if (cached) return cached
    try {
      const persisted = await deps.storage.read()
      const migrated = persisted === null ? undefined : migrateEtfCurrentState(persisted)
      if (persisted !== null && !migrated) throw new Error('ETF current state is invalid')
      cached = migrated ?? emptyState()
      return cached
    } catch {
      readFailed = true
      return emptyState()
    }
  }

  async function persist(next: EtfCurrentState): Promise<boolean> {
    const trimmed = trimHistoryToBudget(next)
    if (readFailed || !isSafeState(trimmed)) return false
    try {
      await deps.storage.write(trimmed)
      cached = trimmed
      return true
    } catch {
      return false
    }
  }

  return {
    async replace(input: { window: EtfCurrentStateWindow; verifiedAt: string }): Promise<Readonly<{ state: 'updated' | 'unchanged' | 'unavailable' }>> {
      if (!isCanonicalWindow(input.window) || !isCanonicalUtcMillis(input.verifiedAt)) return unavailable()
      const previous = await current()
      const changed = !previous.snapshot || !sameWindow(previous.snapshot.window, input.window)
      if (changed && previous.snapshot && !mayReplaceRevision(previous.snapshot.window, input.window)) return unavailable()
      const next = Object.freeze({
        schemaVersion: etfCurrentStateStorePolicy.schemaVersion,
        snapshot: Object.freeze({ window: input.window, verifiedAt: input.verifiedAt }),
        // A state written before the archive existed still holds the last stored window; seeding it
        // keeps those rows answerable at their own instant instead of dropping them on the first
        // refresh after the upgrade.
        history: retainHistory([...(previous.history ?? (previous.snapshot ? [historyEntry(previous.snapshot.window, previous.snapshot.verifiedAt)] : [])), historyEntry(input.window, input.verifiedAt)], input.verifiedAt),
        health: Object.freeze({
          lastAttemptAt: input.verifiedAt,
          lastSuccessAt: input.verifiedAt,
          snapshotReplaceCount: increment(previous.health.snapshotReplaceCount, changed),
          snapshotNoWriteCount: increment(previous.health.snapshotNoWriteCount, !changed),
          rejectionCount: previous.health.rejectionCount
        })
      })
      return await persist(next) ? Object.freeze({ state: changed ? 'updated' as const : 'unchanged' as const }) : unavailable()
    },
    async read() {
      const state = await current()
      if (readFailed) throw new Error('ETF current state is unreadable')
      return state.snapshot ? state : null
    },
    async readAvailable(input: { asOf: string; allowStale?: boolean }): Promise<Readonly<{ state: 'available'; window: EtfCurrentStateWindow; verifiedAt: string }> | Readonly<{ state: 'unavailable' }>> {
      if (!isCanonicalUtcMillis(input.asOf)) return unavailable()
      const state = await current()
      const snapshot = state.snapshot
      if (readFailed || !snapshot) return unavailable()
      // The snapshot is the newest window; when the instant predates it, the archive holds the rows
      // that were current then. An archived entry is preferred because it dates itself honestly: its
      // rows were stored, not merely re-read, at or before the instant.
      if (input.asOf < snapshot.verifiedAt) {
        const archived = archivedAt(state.history, input.asOf)
        const archivedWindow = archived ? windowObservedBy(archived.window, input.asOf) : undefined
        if (archived && archivedWindow) {
          if (!input.allowStale && Date.parse(input.asOf) - Date.parse(archived.at) > etfCurrentStateStorePolicy.maximumSnapshotAgeMs) return unavailable()
          return Object.freeze({ state: 'available' as const, window: archivedWindow, verifiedAt: archived.at })
        }
      }
      const verifiedAt = snapshot.verifiedAt
      // A flow row is a fact only from its own observation time. Refreshing the window later does not
      // make the rows it contains known earlier, so this read keeps only the rows the provider had
      // already observed at the instant and drops the rest. The returned window ends at the last kept
      // trading day: a card built from it shows the as-of read, never today's refresh wearing the
      // cutoff's timestamp. When no row survives, the answer is a gap rather than the current window.
      const window = windowObservedBy(snapshot.window, input.asOf)
      if (!window) return unavailable()
      // A later refresh may still have been verified after the cutoff while all kept rows were
      // observed before it. The rows are the facts that existed then, so the answer is dated by the
      // newest kept observation: "known by" cannot be later than the instant being projected.
      const knownAt = Date.parse(verifiedAt) <= Date.parse(input.asOf)
        ? verifiedAt
        : newestObservation(window)
      if (!input.allowStale && Date.parse(input.asOf) - Date.parse(knownAt) > etfCurrentStateStorePolicy.maximumSnapshotAgeMs) return unavailable()
      return Object.freeze({ state: 'available' as const, window, verifiedAt: knownAt })
    }
  }
}

/**
 * The archived row set that was current at the instant, newest first.
 *
 * Its window is rebuilt from the material rows alone; the archive deliberately drops the provider
 * revision identity, which only guards replacement and never reaches a reading.
 */
function archivedAt(history: readonly EtfCurrentStateHistoryEntry[] | undefined, asOf: string): Readonly<{ at: string; window: EtfCurrentStateWindow }> | undefined {
  if (!history) return undefined
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const entry = history[index]!
    if (entry.at > asOf) continue
    const window = windowFromHistoryEntry(entry)
    if (window) return Object.freeze({ at: entry.at, window })
  }
  return undefined
}

function historyEntry(window: EtfCurrentStateWindow, at: string): EtfCurrentStateHistoryEntry {
  const rows = (flows: readonly EtfDailyFlow[]): readonly EtfHistoryRow[] =>
    flows.map((flow) => Object.freeze([flow.tradingDate, flow.netFlowUsd, flow.observedAt] as const))
  return Object.freeze({ at, source: etfWindowSource(window), btc: rows(window.btc), eth: rows(window.eth) })
}

/**
 * Archive retained by age instead of entry count.
 *
 * Every refresh inside the dense span is kept; older refreshes collapse to one per bucket, keeping
 * the latest one in it so the archive never ends before an instant it could answer. Overflowing
 * dense entries fall through to the bucketed layer instead of being discarded, which preserves
 * coverage. Entries without a canonical `at`, in the future, or older than the horizon are dropped.
 */
function retainHistory(history: readonly EtfCurrentStateHistoryEntry[], now: string): readonly EtfCurrentStateHistoryEntry[] {
  const nowMs = Date.parse(now)
  const seen = new Set<string>()
  const ascending = history
    .filter((entry) => {
      const at = Date.parse(entry.at)
      if (!Number.isFinite(at) || at > nowMs || nowMs - at > etfCurrentStateStorePolicy.historyCoverageMs + etfCurrentStateStorePolicy.historyThinningMs || seen.has(entry.at)) return false
      seen.add(entry.at)
      return true
    })
    .sort((left, right) => left.at.localeCompare(right.at))
  const denseFloor = nowMs - etfCurrentStateStorePolicy.historyDenseMs
  const buckets = new Set<number>()
  const retained: EtfCurrentStateHistoryEntry[] = []
  let denseCount = 0
  for (let index = ascending.length - 1; index >= 0; index -= 1) {
    const entry = ascending[index]!
    const at = Date.parse(entry.at)
    if (at >= denseFloor && denseCount < etfCurrentStateStorePolicy.historyDenseMaximumEntries) {
      denseCount += 1
      retained.push(entry)
      continue
    }
    const bucket = Math.floor(at / etfCurrentStateStorePolicy.historyThinningMs)
    if (buckets.has(bucket)) continue
    buckets.add(bucket)
    retained.push(entry)
  }
  retained.reverse()
  if (retained.length > etfCurrentStateStorePolicy.maximumHistoryEntries) {
    retained.splice(0, retained.length - etfCurrentStateStorePolicy.maximumHistoryEntries)
  }
  return Object.freeze(retained)
}

/** Drop the oldest archived row sets until the encoded state fits the history budget. */
function trimHistoryToBudget(state: EtfCurrentState): EtfCurrentState {
  const history = state.history
  if (!history || history.length === 0) return state
  const costs = history.map((entry) => Buffer.byteLength(JSON.stringify(entry), 'utf8') + 1)
  let total = Buffer.byteLength(JSON.stringify({ ...state, history: [] }), 'utf8') + costs.reduce((sum, cost) => sum + cost, 0)
  let keepFrom = 0
  while (keepFrom < costs.length && total > etfCurrentStateStorePolicy.historyByteBudget) {
    total -= costs[keepFrom]!
    keepFrom += 1
  }
  if (keepFrom === 0) return state
  return Object.freeze({ ...state, history: Object.freeze(history.slice(keepFrom)) })
}

/**
 * The window restricted to rows each observed at or before the instant.
 *
 * A row may only answer for instants at or after its own observation; older rows stay valid because
 * they were known then. Both assets have to keep the same trading days or the public DTO would
 * describe two different windows, and the remaining window ends at its newest kept day.
 */
function windowObservedBy(window: EtfCurrentStateWindow, asOf: string): EtfCurrentStateWindow | undefined {
  const cutoffDate = asOf.slice(0, 10)
  const observedBy = (row: EtfCurrentStateWindow['btc'][number]) => row.observedAt <= asOf && row.tradingDate <= cutoffDate
  const btc = window.btc.filter(observedBy)
  const eth = window.eth.filter(observedBy)
  if (btc.length === 0 || eth.length === 0) return undefined
  const sameDays = btc.length === eth.length && btc.every((row, index) => row.tradingDate === eth[index]?.tradingDate)
  if (!sameDays) return undefined
  const windowEnd = btc.at(-1)!.tradingDate
  const capitalConclusionDates = btc.slice(-etfCurrentStateWindowPolicy.capitalConclusionRows).map((row) => row.tradingDate)
  return Object.freeze({
    btc: Object.freeze(btc.map((row) => Object.freeze({ ...row }))),
    eth: Object.freeze(eth.map((row) => Object.freeze({ ...row }))),
    windowEnd,
    capitalConclusionDates: Object.freeze(capitalConclusionDates),
    ...(window.revision ? { revision: Object.freeze({ ...window.revision }) } : {})
  })
}

function newestObservation(window: EtfCurrentStateWindow): string {
  return [...window.btc, ...window.eth].reduce((newest, row) => row.observedAt > newest ? row.observedAt : newest, '1970-01-01T00:00:00.000Z')
}

export function createInMemoryEtfCurrentStateStorage(initial?: EtfCurrentState): EtfCurrentStateStorage {
  let state = initial ? structuredClone(initial) : null
  return {
    async read() { return state ? structuredClone(state) : null },
    async write(next) { state = structuredClone(next) }
  }
}

export function createEtfCurrentStateSqliteStorage(filePath: string): EtfCurrentStateStorage {
  mkdirSync(dirname(filePath), { recursive: true })
  const database = openSqliteDatabase(filePath)
  database.exec('pragma synchronous = full;')
  database.exec('create table if not exists etf_current_state (id integer primary key check (id = 1), schema_version integer not null, window_json text, verified_at text, last_attempt_at text not null, last_success_at text, snapshot_replace_count integer not null, snapshot_no_write_count integer not null, rejection_count integer not null, history_json text)')
  // A state written before the archive existed has no history column. Adding it in place keeps the
  // stored snapshot readable as the old behaviour rather than discarding the file.
  const columns = database.prepare('pragma table_info(etf_current_state)').all() as readonly Record<string, unknown>[]
  if (!columns.some((column) => column.name === 'history_json')) {
    database.exec('alter table etf_current_state add column history_json text')
  }
  return {
    async read() {
      const row = database.prepare('select schema_version, window_json, verified_at, last_attempt_at, last_success_at, snapshot_replace_count, snapshot_no_write_count, rejection_count, history_json from etf_current_state where id = 1').get() as SqliteStateRow | undefined
      if (row) {
        try {
          if ((row.window_json === null) !== (row.verified_at === null)) return null
          const history = row.history_json ? JSON.parse(row.history_json) : undefined
          const raw = {
            schemaVersion: row.schema_version,
            ...(row.window_json && row.verified_at ? { snapshot: { window: JSON.parse(row.window_json), verifiedAt: row.verified_at } } : {}),
            ...(history === undefined ? {} : { history }),
            health: {
              lastAttemptAt: row.last_attempt_at,
              ...(row.last_success_at ? { lastSuccessAt: row.last_success_at } : {}),
              snapshotReplaceCount: row.snapshot_replace_count,
              snapshotNoWriteCount: row.snapshot_no_write_count,
              rejectionCount: row.rejection_count
            }
          }
          return migrateEtfCurrentState(raw) ?? null
        } catch { return null }
      }
      return null
    },
    async write(state) { await writeState(state) }
  }

  async function writeState(state: EtfCurrentState): Promise<void> {
    if (!isValidEtfCurrentState(state)) throw new Error('ETF current state is invalid')
    const snapshot = state.snapshot
    const history = state.history && state.history.length > 0 ? JSON.stringify(state.history) : null
    database.exec('begin immediate')
    try {
      database.prepare('insert into etf_current_state (id, schema_version, window_json, verified_at, last_attempt_at, last_success_at, snapshot_replace_count, snapshot_no_write_count, rejection_count, history_json) values (1, ?, ?, ?, ?, ?, ?, ?, ?, ?) on conflict(id) do update set schema_version=excluded.schema_version, window_json=excluded.window_json, verified_at=excluded.verified_at, last_attempt_at=excluded.last_attempt_at, last_success_at=excluded.last_success_at, snapshot_replace_count=excluded.snapshot_replace_count, snapshot_no_write_count=excluded.snapshot_no_write_count, rejection_count=excluded.rejection_count, history_json=excluded.history_json').run(
        state.schemaVersion,
        snapshot ? JSON.stringify(snapshot.window) : null,
        snapshot?.verifiedAt ?? null,
        state.health.lastAttemptAt,
        state.health.lastSuccessAt ?? null,
        state.health.snapshotReplaceCount,
        state.health.snapshotNoWriteCount,
        state.health.rejectionCount,
        history
      )
      database.exec('commit')
    } catch (error) {
      try { database.exec('rollback') } catch { /* preserve original write failure */ }
      throw error
    }
  }
}

type SqliteStateRow = {
  schema_version: number
  window_json: string | null
  verified_at: string | null
  last_attempt_at: string
  last_success_at: string | null
  snapshot_replace_count: number
  snapshot_no_write_count: number
  rejection_count: number
  history_json: string | null
}

function sameWindow(left: EtfCurrentStateWindow, right: EtfCurrentStateWindow): boolean {
  return JSON.stringify(materialWindow(left)) === JSON.stringify(materialWindow(right))
}

/**
 * 材料行 = 提供方给的事实。`fetchedAt`（这一轮抓取的时刻）与 `firstSeenAt`（第一次进库的时刻）
 * 都是记账，不是事实：它们一变就当成「数据变了」，会撞上「定稿后不许改」的闸门，
 * 而 revision 又不覆盖它们——结果是永远写不进去。所以两者一起从比较里剥掉。
 */
type MaterialEtfDailyFlow = Omit<EtfDailyFlow, 'fetchedAt' | 'firstSeenAt'>
type MaterialEtfCurrentStateWindow = Omit<EtfCurrentStateWindow, 'btc' | 'eth'> & Readonly<{
  btc: readonly MaterialEtfDailyFlow[]
  eth: readonly MaterialEtfDailyFlow[]
}>

function materialWindow(window: EtfCurrentStateWindow): MaterialEtfCurrentStateWindow {
  return {
    ...window,
    btc: window.btc.map(({ fetchedAt: _fetchedAt, firstSeenAt: _firstSeenAt, ...flow }) => flow),
    eth: window.eth.map(({ fetchedAt: _fetchedAt, firstSeenAt: _firstSeenAt, ...flow }) => flow)
  }
}

function mayReplaceRevision(previous: EtfCurrentStateWindow, next: EtfCurrentStateWindow): boolean {
  return !!previous.revision && !!next.revision && previous.revision.providerCurrentStateId !== next.revision.providerCurrentStateId
}

function emptyState(): EtfCurrentState {
  return Object.freeze({
    schemaVersion: etfCurrentStateStorePolicy.schemaVersion,
    health: Object.freeze({ lastAttemptAt: '1970-01-01T00:00:00.000Z', snapshotReplaceCount: 0, snapshotNoWriteCount: 0, rejectionCount: 0 })
  })
}

function increment(value: number, shouldIncrement: boolean): number {
  return shouldIncrement ? Math.min(value + 1, etfCurrentStateStorePolicy.maximumCounter) : value
}

function unavailable(): Readonly<{ state: 'unavailable' }> {
  return Object.freeze({ state: 'unavailable' as const })
}
