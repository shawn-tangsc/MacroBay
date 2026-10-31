import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'

import { etfCurrentStateWindowPolicy, isValidEtfCurrentStateWindow, type EtfCurrentStateWindow, type EtfDailyFlow } from '../etf/etfCurrentStateWindow'
import { etfPublicSnapshotPolicy } from '../../../contracts/intelligenceQueryContracts'

export const etfCurrentStateStorePolicy = Object.freeze({
  schemaVersion: 1,
  maximumWindowBytes: 12 * 1024,
  maximumStateBytes: 20 * 1024,
  maximumAtomicDiskBytes: 40 * 1024,
  maximumSnapshotAgeMs: etfPublicSnapshotPolicy.maximumAgeMs,
  maximumCounter: Number.MAX_SAFE_INTEGER
})

export type EtfCurrentStateHealth = Readonly<{
  lastAttemptAt: string
  lastSuccessAt?: string
  snapshotReplaceCount: number
  snapshotNoWriteCount: number
  rejectionCount: number
}>

export type EtfCurrentState = Readonly<{
  schemaVersion: typeof etfCurrentStateStorePolicy.schemaVersion
  snapshot?: Readonly<{ window: EtfCurrentStateWindow; verifiedAt: string }>
  health: EtfCurrentStateHealth
}>

export type EtfCurrentStateStorage = {
  read: () => Promise<EtfCurrentState | null>
  write: (state: EtfCurrentState) => Promise<void>
}

export type EtfCurrentStateStore = ReturnType<typeof createEtfCurrentStateStore>

export function isValidEtfCurrentState(state: unknown): state is EtfCurrentState {
  if (!isPlainRecord(state) || !hasOnlyKeys(state, ['schemaVersion', 'snapshot', 'health']) || state.schemaVersion !== etfCurrentStateStorePolicy.schemaVersion || !isHealth(state.health)) return false
  if (state.snapshot === undefined) return true
  if (!isPlainRecord(state.snapshot) || !hasOnlyKeys(state.snapshot, ['window', 'verifiedAt']) || !isCanonicalUtcMillis(state.snapshot.verifiedAt) || !isCanonicalWindow(state.snapshot.window as EtfCurrentStateWindow)) return false
  return isSafeState(state as EtfCurrentState)
}

export function createEtfCurrentStateStore(deps: { storage: EtfCurrentStateStorage }) {
  let cached: EtfCurrentState | undefined
  let readFailed = false

  async function current(): Promise<EtfCurrentState> {
    if (cached) return cached
    try {
      const persisted = await deps.storage.read()
      if (persisted !== null && !isValidEtfCurrentState(persisted)) throw new Error('ETF current state is invalid')
      cached = persisted ?? emptyState()
      return cached
    } catch {
      readFailed = true
      return emptyState()
    }
  }

  async function persist(next: EtfCurrentState): Promise<boolean> {
    if (readFailed || !isSafeState(next)) return false
    try {
      await deps.storage.write(next)
      cached = next
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
      const verifiedAt = state.snapshot?.verifiedAt
      if (readFailed || !state.snapshot || !verifiedAt) return unavailable()
      // A flow row is a fact only from its own observation time. Refreshing the window later does not
      // make the rows it contains known earlier, so this read keeps only the rows the provider had
      // already observed at the instant and drops the rest. The returned window ends at the last kept
      // trading day: a card built from it shows the as-of read, never today's refresh wearing the
      // cutoff's timestamp. When no row survives, the answer is a gap rather than the current window.
      const window = windowObservedBy(state.snapshot.window, input.asOf)
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
  const database = new DatabaseSync(filePath)
  database.exec('pragma journal_mode = wal; pragma synchronous = full;')
  database.exec('create table if not exists etf_current_state (id integer primary key check (id = 1), schema_version integer not null, window_json text, verified_at text, last_attempt_at text not null, last_success_at text, snapshot_replace_count integer not null, snapshot_no_write_count integer not null, rejection_count integer not null)')
  return {
    async read() {
      const row = database.prepare('select schema_version, window_json, verified_at, last_attempt_at, last_success_at, snapshot_replace_count, snapshot_no_write_count, rejection_count from etf_current_state where id = 1').get() as SqliteStateRow | undefined
      if (row) {
        try {
          if ((row.window_json === null) !== (row.verified_at === null)) return null
          const state: EtfCurrentState = {
            schemaVersion: row.schema_version as 1,
            ...(row.window_json && row.verified_at ? { snapshot: { window: JSON.parse(row.window_json), verifiedAt: row.verified_at } } : {}),
            health: {
              lastAttemptAt: row.last_attempt_at,
              ...(row.last_success_at ? { lastSuccessAt: row.last_success_at } : {}),
              snapshotReplaceCount: row.snapshot_replace_count,
              snapshotNoWriteCount: row.snapshot_no_write_count,
              rejectionCount: row.rejection_count
            }
          }
          return isValidEtfCurrentState(state) ? state : null
        } catch { return null }
      }
      return null
    },
    async write(state) { await writeState(state) }
  }

  async function writeState(state: EtfCurrentState): Promise<void> {
    if (!isValidEtfCurrentState(state)) throw new Error('ETF current state is invalid')
    const snapshot = state.snapshot
    database.exec('begin immediate')
    try {
      database.prepare('insert into etf_current_state (id, schema_version, window_json, verified_at, last_attempt_at, last_success_at, snapshot_replace_count, snapshot_no_write_count, rejection_count) values (1, ?, ?, ?, ?, ?, ?, ?, ?) on conflict(id) do update set schema_version=excluded.schema_version, window_json=excluded.window_json, verified_at=excluded.verified_at, last_attempt_at=excluded.last_attempt_at, last_success_at=excluded.last_success_at, snapshot_replace_count=excluded.snapshot_replace_count, snapshot_no_write_count=excluded.snapshot_no_write_count, rejection_count=excluded.rejection_count').run(
        state.schemaVersion,
        snapshot ? JSON.stringify(snapshot.window) : null,
        snapshot?.verifiedAt ?? null,
        state.health.lastAttemptAt,
        state.health.lastSuccessAt ?? null,
        state.health.snapshotReplaceCount,
        state.health.snapshotNoWriteCount,
        state.health.rejectionCount
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
}

function isCanonicalWindow(window: EtfCurrentStateWindow): boolean {
  return isValidEtfCurrentStateWindow(window) && isSafeRevisionIdentity(window.revision)
}

function sameWindow(left: EtfCurrentStateWindow, right: EtfCurrentStateWindow): boolean {
  return JSON.stringify(materialWindow(left)) === JSON.stringify(materialWindow(right))
}

type MaterialEtfDailyFlow = Omit<EtfDailyFlow, 'fetchedAt'>
type MaterialEtfCurrentStateWindow = Omit<EtfCurrentStateWindow, 'btc' | 'eth'> & Readonly<{
  btc: readonly MaterialEtfDailyFlow[]
  eth: readonly MaterialEtfDailyFlow[]
}>

function materialWindow(window: EtfCurrentStateWindow): MaterialEtfCurrentStateWindow {
  return {
    ...window,
    btc: window.btc.map(({ fetchedAt: _fetchedAt, ...flow }) => flow),
    eth: window.eth.map(({ fetchedAt: _fetchedAt, ...flow }) => flow)
  }
}

function mayReplaceRevision(previous: EtfCurrentStateWindow, next: EtfCurrentStateWindow): boolean {
  return !!previous.revision && !!next.revision && previous.revision.providerCurrentStateId !== next.revision.providerCurrentStateId
}

function isSafeRevisionIdentity(value: EtfCurrentStateWindow['revision']): boolean {
  return value === undefined || (Object.keys(value).length === 1 && typeof value.providerCurrentStateId === 'string' && value.providerCurrentStateId.length > 0 && value.providerCurrentStateId.length <= 256 && !/[\u0000-\u001f\u007f]/.test(value.providerCurrentStateId))
}

function isSafeState(state: EtfCurrentState): boolean {
  const windowBytes = state.snapshot ? Buffer.byteLength(JSON.stringify(state.snapshot.window), 'utf8') : 0
  const stateBytes = Buffer.byteLength(JSON.stringify(state), 'utf8')
  return state.schemaVersion === etfCurrentStateStorePolicy.schemaVersion && windowBytes <= etfCurrentStateStorePolicy.maximumWindowBytes && stateBytes <= etfCurrentStateStorePolicy.maximumStateBytes && stateBytes * 2 <= etfCurrentStateStorePolicy.maximumAtomicDiskBytes
}

function isHealth(value: unknown): value is EtfCurrentStateHealth {
  if (!isPlainRecord(value) || !hasOnlyKeys(value, ['lastAttemptAt', 'lastSuccessAt', 'snapshotReplaceCount', 'snapshotNoWriteCount', 'rejectionCount'])) return false
  return isCanonicalUtcMillis(value.lastAttemptAt) && (value.lastSuccessAt === undefined || isCanonicalUtcMillis(value.lastSuccessAt)) &&
    [value.snapshotReplaceCount, value.snapshotNoWriteCount, value.rejectionCount].every((count) => typeof count === 'number' && Number.isSafeInteger(count) && count >= 0 && count <= etfCurrentStateStorePolicy.maximumCounter)
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype && Object.getOwnPropertySymbols(value).length === 0
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key))
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

function isCanonicalUtcMillis(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value
}

function unavailable(): Readonly<{ state: 'unavailable' }> {
  return Object.freeze({ state: 'unavailable' as const })
}
