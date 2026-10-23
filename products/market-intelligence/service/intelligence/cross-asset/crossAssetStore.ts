import { mkdirSync, statSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import type { ClosedBar, StoredSymbol } from './binanceCrossAssetClient'
import { crossAssetPolicy } from './crossAssetPolicy'
import { barRetentionPolicy, type BarRetentionCutoffs } from '../retention/barRetention'

// Design 126: durable product history. Quota stops writes, never removes versions.
export const crossAssetStoragePolicy = Object.freeze({
  /**
   * Version 2 widens the symbol CHECK to hold the real Nasdaq 100 index beside its tokenised proxy.
   * The bump is not cosmetic: SQLite cannot alter a CHECK, so a version-1 file is rebuilt — see
   * `migrateSymbolSet`, which copies every stored row before dropping the old tables.
   */
  fileName: 'cross-asset-market.sqlite', schemaVersion: 2, maxVersionRows: 500_000,
  maxDatabaseBytes: 256 * 1024 ** 2, maxWalBytes: 16 * 1024 ** 2,
  batchLimit: 128, pageSize: 4096, checkpointPages: 1000,
  valueFields: Object.freeze(['open', 'high', 'low', 'close', 'volume'] as const),
  origins: Object.freeze(['rest', 'ws'] as const), queryTimingSamples: 30, queryPercentile: .95, sqliteFullCode: 13
})
const policy = crossAssetStoragePolicy
type Origin = typeof policy.origins[number]
type Query = { symbol: ClosedBar['symbol']; fromMs: number; toMs: number; asOfMs: number }
type Stored = { version_id: number; observed_at_ms: number; symbol: ClosedBar['symbol']; bar_open_ms: number } & Pick<ClosedBar, 'open' | 'high' | 'low' | 'close' | 'volume'>
type AppendResult = { state: 'updated' | 'unchanged' | 'limited' | 'unavailable' | 'invalid-input'; added: number }
const canonical = (value: string) => value.includes('.') ? value.replace(/0+$/, '').replace(/\.$/, '') : value
const same = (a: Pick<ClosedBar, 'open' | 'high' | 'low' | 'close' | 'volume'>, b: typeof a) =>
  policy.valueFields.every(field => canonical(a[field]) === canonical(b[field]))
/** Only the symbols the product admits may be written or read. Both index legs are admitted. */
const isStoredSymbol = (value: unknown): value is ClosedBar['symbol'] =>
  typeof value === 'string' && (crossAssetPolicy.storedSymbols as readonly string[]).includes(value)

const symbolList = crossAssetPolicy.storedSymbols.map(symbol => `'${symbol}'`).join(',')
const versionsTable = (name: string) => `CREATE TABLE IF NOT EXISTS ${name} (
  version_id INTEGER PRIMARY KEY, symbol TEXT NOT NULL CHECK(symbol IN (${symbolList})),
  bar_open_ms INTEGER NOT NULL CHECK(bar_open_ms >= 0 AND bar_open_ms % ${crossAssetPolicy.intervalMs} = 0),
  observed_at_ms INTEGER NOT NULL, open TEXT NOT NULL, high TEXT NOT NULL, low TEXT NOT NULL,
  close TEXT NOT NULL, volume TEXT NOT NULL, origin TEXT NOT NULL CHECK(origin IN ('rest','ws')))`
const currentTable = (name: string, versions: string) => `CREATE TABLE IF NOT EXISTS ${name} (
  symbol TEXT NOT NULL, bar_open_ms INTEGER NOT NULL,
  version_id INTEGER NOT NULL REFERENCES ${versions}(version_id), PRIMARY KEY(symbol,bar_open_ms))`
const lookupIndex = (versions: string) =>
  `CREATE INDEX IF NOT EXISTS cross_asset_bar_lookup ON ${versions}(symbol,bar_open_ms,observed_at_ms DESC,version_id DESC)`

/**
 * A version-1 file holds only the three Binance contracts, and its CHECK will not accept the real
 * index. SQLite cannot drop a CHECK, so the two tables are rebuilt around the widened symbol set and
 * every stored row is copied first — a migration that lost history would be worse than no migration.
 */
function migrateSymbolSet(db: DatabaseSync): void {
  // The transaction is opened and closed with separate `exec` calls on purpose: a `BEGIN … COMMIT`
  // pair inside one multi-statement string leaves the transaction *open* under `node:sqlite` — the
  // closing statement is never reached — and the next `wal_checkpoint` then fails with "database
  // table is locked" on the connection that is still holding it.
  db.exec('BEGIN IMMEDIATE')
  try {
    db.exec(`
      ALTER TABLE cross_asset_bar_current RENAME TO cross_asset_bar_current_v1;
      ALTER TABLE cross_asset_bar_versions RENAME TO cross_asset_bar_versions_v1;
      DROP INDEX IF EXISTS cross_asset_bar_lookup;
      ${versionsTable('cross_asset_bar_versions')};
      ${lookupIndex('cross_asset_bar_versions')};
      ${currentTable('cross_asset_bar_current', 'cross_asset_bar_versions')};
      INSERT INTO cross_asset_bar_versions SELECT * FROM cross_asset_bar_versions_v1;
      INSERT INTO cross_asset_bar_current SELECT * FROM cross_asset_bar_current_v1;
      DROP TABLE cross_asset_bar_current_v1;
      DROP TABLE cross_asset_bar_versions_v1;
      PRAGMA user_version=${policy.schemaVersion};`)
    db.exec('COMMIT')
  } catch (error) {
    try { db.exec('ROLLBACK') } catch { /* Preserve the migration failure: the caller closes the file. */ }
    throw error
  }
}

function validBar(bar: ClosedBar, at: number): boolean {
  if (!bar || !isStoredSymbol(bar.symbol) || !Number.isSafeInteger(bar.barOpenMs) ||
    bar.barOpenMs < 0 || bar.barOpenMs % crossAssetPolicy.intervalMs !== 0 ||
    bar.barEndMs !== bar.barOpenMs + crossAssetPolicy.intervalMs || bar.barEndMs > at) return false
  if (!policy.valueFields.every(field => typeof bar[field] === 'string' && bar[field].length <= crossAssetPolicy.decimalMaxLength &&
    crossAssetPolicy.decimalPattern.test(bar[field]) && Number.isFinite(Number(bar[field])) &&
    (field === 'volume' ? Number(bar[field]) >= 0 : Number(bar[field]) > 0))) return false
  return Number(bar.low) <= Math.min(Number(bar.open), Number(bar.close)) && Number(bar.high) >= Math.max(Number(bar.open), Number(bar.close))
}

export function createCrossAssetStore(filePath: string) {
  const startedAt = performance.now()
  mkdirSync(dirname(filePath), { recursive: true })
  const db = new DatabaseSync(filePath)
  try {
    const version = Number(db.prepare('PRAGMA user_version').get()?.user_version)
    const existing = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all()
    const fresh = version === 0 && existing.length === 0
    // A file this product did not write is never touched; a file it did write is migrated.
    if (!fresh && version !== policy.schemaVersion && version !== 1) throw new Error('storage-schema-unavailable')
    db.exec(`PRAGMA page_size=${policy.pageSize}; PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
      PRAGMA wal_autocheckpoint=${policy.checkpointPages};`)
    const pageSize = Number(db.prepare('PRAGMA page_size').get()?.page_size)
    const maxPages = Math.floor(policy.maxDatabaseBytes / pageSize)
    if (Number(db.prepare('PRAGMA page_count').get()?.page_count) > maxPages) throw new Error('storage-limited')
    db.exec(`PRAGMA max_page_count=${maxPages}`)
    if (!fresh && version === 1) migrateSymbolSet(db)
    else db.exec(`${versionsTable('cross_asset_bar_versions')};
      ${lookupIndex('cross_asset_bar_versions')};
      ${currentTable('cross_asset_bar_current', 'cross_asset_bar_versions')};
      PRAGMA user_version=${policy.schemaVersion};`)
    // The pass's own ledger. Additive and idempotent, so an older file gains it on its next open
    // without a schema migration: the retention pass has to be auditable, and this store owns its file.
    db.exec('create table if not exists cross_asset_meta(key text primary key, value text not null)')
    if (db.prepare('PRAGMA quick_check').get()?.quick_check !== 'ok') throw new Error('storage-unavailable')
  } catch { db.close(); throw new Error('storage-unavailable') }

  const initial = db.prepare('SELECT count(*) AS rows, coalesce(max(observed_at_ms),0) AS last FROM cross_asset_bar_versions').get()!
  let versionRows = Number(initial.rows)
  let lastObservedAt = Number(initial.last)
  let storeRevision = versionRows
  let rejectedWrites = 0
  let lastCheckpointAt: number | null = null
  let closed = false
  const queryTimings: number[] = []
  const startupMs = performance.now() - startedAt
  const current = db.prepare(`SELECT v.* FROM cross_asset_bar_current c JOIN cross_asset_bar_versions v ON c.version_id=v.version_id
    WHERE c.symbol=? AND c.bar_open_ms=?`)
  const insert = db.prepare(`INSERT INTO cross_asset_bar_versions (symbol,bar_open_ms,observed_at_ms,open,high,low,close,volume,origin)
    VALUES(?,?,?,?,?,?,?,?,?)`)
  const project = db.prepare(`INSERT INTO cross_asset_bar_current(symbol,bar_open_ms,version_id) VALUES(?,?,?)
    ON CONFLICT(symbol,bar_open_ms) DO UPDATE SET version_id=excluded.version_id`)
  const read = db.prepare(`SELECT v.* FROM cross_asset_bar_current c JOIN cross_asset_bar_versions v
    ON v.version_id=(SELECT x.version_id FROM cross_asset_bar_versions x
      WHERE x.symbol=c.symbol AND x.bar_open_ms=c.bar_open_ms AND x.observed_at_ms<=?
      ORDER BY x.observed_at_ms DESC,x.version_id DESC LIMIT 1)
    WHERE c.symbol=? AND c.bar_open_ms BETWEEN ? AND ? ORDER BY c.bar_open_ms LIMIT ?`)
  const walBytes = () => { try { return statSync(`${filePath}-wal`).size } catch { return 0 } }

  return {
    get revision() { return storeRevision },
    append(input: { bars: readonly ClosedBar[]; observedAtMs: number; origin: Origin }): AppendResult {
      if (closed) return { state: 'unavailable', added: 0 }
      if (!Number.isSafeInteger(input.observedAtMs) || input.observedAtMs < 0 || !policy.origins.includes(input.origin) ||
        !Array.isArray(input.bars) || input.bars.length > policy.batchLimit || !input.bars.every(bar => validBar(bar, input.observedAtMs))) {
        return { state: 'invalid-input', added: 0 }
      }
      const unique = new Map<string, ClosedBar>()
      for (const bar of input.bars) {
        const key = `${bar.symbol}:${bar.barOpenMs}`
        const previous = unique.get(key)
        if (previous && !same(previous, bar)) return { state: 'invalid-input', added: 0 }
        unique.set(key, bar)
      }
      let transaction = false
      try {
        db.exec('BEGIN IMMEDIATE'); transaction = true
        const changes = [...unique.values()].filter(bar => {
          const previous = current.get(bar.symbol, bar.barOpenMs) as Stored | undefined
          return !previous || !same(previous, bar)
        })
        if (changes.length && (versionRows + changes.length > policy.maxVersionRows || walBytes() >= policy.maxWalBytes)) {
          db.exec('ROLLBACK'); transaction = false; rejectedWrites++
          return { state: 'limited', added: 0 }
        }
        const observedAt = Math.max(input.observedAtMs, lastObservedAt)
        for (const bar of changes) {
          const result = insert.run(bar.symbol, bar.barOpenMs, observedAt, bar.open, bar.high, bar.low, bar.close, bar.volume, input.origin)
          project.run(bar.symbol, bar.barOpenMs, result.lastInsertRowid)
        }
        db.exec('COMMIT'); transaction = false
        versionRows += changes.length
        if (changes.length) { lastObservedAt = observedAt; storeRevision++ }
        return { state: changes.length ? 'updated' : 'unchanged', added: changes.length }
      } catch (error) {
        if (transaction) { try { db.exec('ROLLBACK') } catch { /* SQLite may have rolled back a full-disk transaction. */ } }
        rejectedWrites++
        const full = (error as { errcode?: number }).errcode === policy.sqliteFullCode
        return { state: full ? 'limited' : 'unavailable', added: 0 }
      }
    },
    queryAt(input: Query): ClosedBar[] {
      if (closed || !isStoredSymbol(input.symbol) ||
        ![input.fromMs, input.toMs, input.asOfMs].every(value => Number.isSafeInteger(value) && value >= 0) ||
        input.fromMs > input.toMs || input.toMs - input.fromMs >= crossAssetPolicy.historyMaxPoints * crossAssetPolicy.intervalMs) throw new Error('invalid-query')
      const start = performance.now()
      try {
        const rows = read.all(input.asOfMs, input.symbol, input.fromMs, Math.min(input.toMs, input.asOfMs - crossAssetPolicy.intervalMs),
          crossAssetPolicy.historyMaxPoints) as Stored[]
        return rows.map(row => {
          const bar = { symbol: row.symbol, barOpenMs: row.bar_open_ms, barEndMs: row.bar_open_ms + crossAssetPolicy.intervalMs,
            open: row.open, high: row.high, low: row.low, close: row.close, volume: row.volume }
          if (!validBar(bar, input.asOfMs)) throw new Error('storage-unavailable')
          return bar
        })
      } catch { throw new Error('storage-unavailable') }
      finally { queryTimings.push(performance.now() - start); if (queryTimings.length > policy.queryTimingSamples) queryTimings.shift() }
    },
    diagnostics() {
      const sorted = [...queryTimings].sort((a, b) => a - b)
      return { versionRows, currentRows: Number(db.prepare('SELECT count(*) AS rows FROM cross_asset_bar_current').get()?.rows),
        maxVersionRows: policy.maxVersionRows, maxDatabaseBytes: policy.maxDatabaseBytes,
        databaseBytes: Number(db.prepare('PRAGMA page_count').get()?.page_count) * Number(db.prepare('PRAGMA page_size').get()?.page_size),
        walBytes: walBytes(), rejectedWrites, lastCheckpointAt, startupMs,
        queryP95Ms: sorted[Math.max(0, Math.ceil(sorted.length * policy.queryPercentile) - 1)] ?? 0,
        ranges: db.prepare('SELECT symbol,min(bar_open_ms) AS oldest,max(bar_open_ms) AS newest FROM cross_asset_bar_current GROUP BY symbol').all() }
    },
    /**
     * One retention pass: fold the cold window to its hours, then drop what is past the cap.
     *
     * Two tables move together, pointers first. `cross_asset_bar_current` carries a foreign key into the
     * versions table and `foreign_keys=ON`, so dropping a version while a pointer names it is refused —
     * and a pass that skipped the pointers entirely would leave the dashboard quietly drawing one bar
     * fewer. The pointers are therefore selected *by the same version rows* the version statement is
     * about to delete, and the whole pass is one transaction: either both tables move or neither does.
     *
     * Bounded per statement so a pass over months of history never holds the write lock long enough for a
     * live tick to be refused, and idempotent by construction: the instant kept is the hour itself, so a
     * second pass finds nothing left to fold and nothing left to drop.
     */
    retention(cutoffs: BarRetentionCutoffs): Readonly<{ thinned: number; deleted: number; oldestKeptAtMs: number | null }> {
      const foldPointers = db.prepare(`DELETE FROM cross_asset_bar_current WHERE version_id IN (
        SELECT version_id FROM cross_asset_bar_versions
        WHERE bar_open_ms >= ? AND bar_open_ms < ? AND bar_open_ms % ? <> 0 LIMIT ?)`)
      const foldVersions = db.prepare(`DELETE FROM cross_asset_bar_versions WHERE version_id IN (
        SELECT version_id FROM cross_asset_bar_versions
        WHERE bar_open_ms >= ? AND bar_open_ms < ? AND bar_open_ms % ? <> 0 LIMIT ?)`)
      const dropPointers = db.prepare(`DELETE FROM cross_asset_bar_current WHERE version_id IN (
        SELECT version_id FROM cross_asset_bar_versions WHERE bar_open_ms < ? LIMIT ?)`)
      const dropVersions = db.prepare(`DELETE FROM cross_asset_bar_versions WHERE version_id IN (
        SELECT version_id FROM cross_asset_bar_versions WHERE bar_open_ms < ? LIMIT ?)`)
      const batch = crossAssetStoragePolicy.batchLimit
      let thinned = 0
      let deleted = 0
      db.exec('BEGIN')
      try {
        // Pointers first: `current.version_id` is the child of the versions table, so the child rows go
        // before their parents or the foreign key refuses the pass outright.
        for (;;) {
          foldPointers.run(cutoffs.deleteBeforeMs, cutoffs.thinBeforeMs, barRetentionPolicy.hourMs, batch)
          const folded = Number(foldVersions.run(cutoffs.deleteBeforeMs, cutoffs.thinBeforeMs, barRetentionPolicy.hourMs, batch).changes)
          if (folded === 0) break
          thinned += folded
          if (folded < batch) break
        }
        for (;;) {
          dropPointers.run(cutoffs.deleteBeforeMs, batch)
          const dropped = Number(dropVersions.run(cutoffs.deleteBeforeMs, batch).changes)
          if (dropped === 0) break
          deleted += dropped
          if (dropped < batch) break
        }
        db.exec('COMMIT')
      } catch (error) { db.exec('ROLLBACK'); throw error }
      const oldest = db.prepare('SELECT min(bar_open_ms) AS at_ms FROM cross_asset_bar_versions').get()
      return Object.freeze({ thinned, deleted, oldestKeptAtMs: oldest?.at_ms == null ? null : Number(oldest.at_ms) })
    },
    /** One line of the retention ledger: what the pass did, and where each series now begins. */
    note(key: string, value: string): void {
      db.prepare('INSERT INTO cross_asset_meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, value)
    },
    readNote(key: string): string | undefined {
      const row = db.prepare('SELECT value FROM cross_asset_meta WHERE key=?').get(key)
      return row?.value === undefined ? undefined : String(row.value)
    },
    close() {
      if (closed) return
      db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); lastCheckpointAt = Date.now()
      db.close(); closed = true
    }
  }
}
