import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { barRetentionPolicy, type BarRetentionCutoffs } from '../retention/barRetention'

/** Durable history for the macro-market series. Levels are all this needs: every fact is a level
 *  or a difference of levels, and storing OHLC the provider cannot be trusted to keep consistent
 *  would invite per-field reconciliation nobody asked for. */
export const macroMarketStoragePolicy = Object.freeze({
  fileName: 'macro-market.sqlite', schemaVersion: 1, maxPoints: 400_000, batchLimit: 256
} as const)

export type MacroMarketPoint = Readonly<{ series: string; atMs: number; value: number; observedAtMs: number }>
export type MacroMarketAppendResult = Readonly<{ state: 'stored' | 'unchanged' | 'invalid-input'; added: number }>

const canonical = (value: number): string => {
  const text = String(value)
  return text.includes('.') ? text.replace(/0+$/, '').replace(/\.$/, '') : text
}

export function createMacroMarketStore(filePath: string) {
  mkdirSync(dirname(filePath), { recursive: true })
  const database = new DatabaseSync(filePath)
  database.exec(`create table if not exists macro_market_points (
    series text not null, at_ms integer not null, value text not null, observed_at_ms integer not null,
    primary key(series, at_ms))`)
  database.exec('create index if not exists macro_market_points_at on macro_market_points(at_ms)')
  database.exec(`create table if not exists macro_market_meta(key text primary key, value text not null)`)
  const insert = database.prepare('insert or ignore into macro_market_points(series, at_ms, value, observed_at_ms) values(?, ?, ?, ?)')

  function append(points: readonly MacroMarketPoint[]): MacroMarketAppendResult {
    if (points.length === 0) return { state: 'unchanged', added: 0 }
    const valid = points.every(point => point.series.length > 0 && Number.isSafeInteger(point.atMs) && point.atMs >= 0 &&
      Number.isFinite(point.value) && Number.isSafeInteger(point.observedAtMs))
    if (!valid) return { state: 'invalid-input', added: 0 }
    let added = 0
    database.exec('begin')
    try {
      // Chunked, never truncated. A backfill writes six hundred points in one call, and the first
      // version of this loop took the first `batchLimit` of them — silently dropping the rest and
      // still reporting success, which is how a basket arrived with three of its six currencies and
      // no synthetic index at all.
      for (let offset = 0; offset < points.length; offset += macroMarketStoragePolicy.batchLimit) {
        for (const point of points.slice(offset, offset + macroMarketStoragePolicy.batchLimit)) {
          added += Number(insert.run(point.series, point.atMs, canonical(point.value), point.observedAtMs).changes)
        }
      }
      database.exec('commit')
    } catch (error) { database.exec('rollback'); throw error }
    return { state: added > 0 ? 'stored' : 'unchanged', added }
  }

  function series(seriesId: string, fromMs: number, toMs: number): readonly Readonly<{ atMs: number; value: number }>[] {
    const rows = database.prepare('select at_ms, value from macro_market_points where series = ? and at_ms >= ? and at_ms <= ? order by at_ms')
      .all(seriesId, fromMs, toMs) as { at_ms: number; value: string }[]
    return rows.map(row => ({ atMs: Number(row.at_ms), value: Number(row.value) }))
  }
  function latest(seriesId: string): Readonly<{ atMs: number; value: number }> | undefined {
    const row = database.prepare('select at_ms, value from macro_market_points where series = ? order by at_ms desc limit 1').get(seriesId) as
      { at_ms: number; value: string } | undefined
    return row ? { atMs: Number(row.at_ms), value: Number(row.value) } : undefined
  }
  /**
   * The newest point at or before an instant — the one read a historical projection makes.
   *
   * It is deliberately a store query rather than "read the newest and compare": the newest point is
   * usually *after* the instant being projected, so a caller holding only `latest` can only answer the
   * present. `at_ms <=` is inclusive because a bar is stamped on its close, and a bar closing exactly
   * at the instant is what a reader at that instant knows.
   */
  function latestAt(seriesId: string, atOrBeforeMs: number): Readonly<{ atMs: number; value: number }> | undefined {
    const row = database.prepare('select at_ms, value from macro_market_points where series = ? and at_ms <= ? order by at_ms desc limit 1')
      .get(seriesId, atOrBeforeMs) as { at_ms: number; value: string } | undefined
    return row ? { atMs: Number(row.at_ms), value: Number(row.value) } : undefined
  }
  function count(seriesId?: string): number {
    const row = seriesId
      ? database.prepare('select count(*) as n from macro_market_points where series = ?').get(seriesId)
      : database.prepare('select count(*) as n from macro_market_points').get()
    return Number((row as { n: number }).n)
  }
  /** The oldest stored point, so a caller can ask how much history a series actually spans. */
  function earliest(seriesId: string): Readonly<{ atMs: number; value: number }> | undefined {
    const row = database.prepare('select at_ms, value from macro_market_points where series = ? order by at_ms asc limit 1').get(seriesId) as
      { at_ms: number; value: string } | undefined
    return row ? { atMs: Number(row.at_ms), value: Number(row.value) } : undefined
  }
  function note(key: string, value: string): void {
    database.prepare('insert into macro_market_meta(key, value) values(?, ?) on conflict(key) do update set value = excluded.value').run(key, value)
  }
  function readNote(key: string): string | undefined {
    const row = database.prepare('select value from macro_market_meta where key = ?').get(key) as { value: string } | undefined
    return row?.value
  }
  /**
   * One retention pass: thin the hours, then drop what is beyond the cap, in that order.
   *
   * Order matters — deleting first would take the five-minute bars the thinning pass was going to fold
   * into an hour's close — and both halves are bounded per statement, so a pass over a year of history
   * never holds the write lock long enough for a tick to miss its slot. Idempotent by construction: the
   * kept instant is the hour itself, so a second pass finds nothing left to fold, and a delete that
   * matches no row is a no-op rather than an error.
   */
  function retention(cutoffs: BarRetentionCutoffs): MacroMarketRetentionResult {
    let thinned = 0
    let deleted = 0
    database.exec('begin')
    try {
      const fold = database.prepare(`delete from macro_market_points where rowid in (
        select rowid from macro_market_points
        where at_ms >= ? and at_ms < ? and at_ms % ? <> 0 limit ?)`)
      for (;;) {
        const changes = Number(fold.run(cutoffs.deleteBeforeMs, cutoffs.thinBeforeMs, barRetentionPolicy.hourMs, barRetentionPolicy.batchSize).changes)
        thinned += changes
        if (changes < barRetentionPolicy.batchSize) break
      }
      const drop = database.prepare(`delete from macro_market_points where rowid in (
        select rowid from macro_market_points where at_ms < ? limit ?)`)
      for (;;) {
        const changes = Number(drop.run(cutoffs.deleteBeforeMs, barRetentionPolicy.batchSize).changes)
        deleted += changes
        if (changes < barRetentionPolicy.batchSize) break
      }
      database.exec('commit')
    } catch (error) { database.exec('rollback'); throw error }
    const oldest = database.prepare('select min(at_ms) as at_ms from macro_market_points').get() as { at_ms: number | null }
    return Object.freeze({ thinned, deleted, oldestKeptAtMs: oldest.at_ms ?? null })
  }

  return { append, series, latest, latestAt, earliest, count, note, readNote, retention, close: () => database.close() }
}
export type MacroMarketStore = ReturnType<typeof createMacroMarketStore>

/** What a retention pass did, and where the series now begins: written down so it can be audited. */
export type MacroMarketRetentionResult = Readonly<{ thinned: number; deleted: number; oldestKeptAtMs: number | null }>
