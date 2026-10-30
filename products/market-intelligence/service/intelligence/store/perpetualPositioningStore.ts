import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { isCanonicalOpenInterestTime } from '../../../contracts/openInterestHistory'

/**
 * One row per asset per 15-minute bucket: notional open interest, contract volume and close,
 * because those three arrive together, are keyed by the same instant, and are read together.
 * Splitting them would add a join and a half-row state where open interest exists but the
 * K-line leg failed.
 */
export const perpetualPositioningStoragePolicy = Object.freeze({
  fileName: 'perpetual-positioning.sqlite',
  schemaVersion: 1,
  assets: Object.freeze(['btc', 'eth'] as const),
  /** Binance keeps 30 days; keeping 60 costs under a megabyte and allows a re-pull comparison. */
  retentionDays: 60
})

export type PositioningAsset = typeof perpetualPositioningStoragePolicy.assets[number]

export type PositioningRow = Readonly<{
  observedMs: number
  notionalUsd: number
}>

export type PositioningVolumeRow = Readonly<{
  observedMs: number
  volumeBase: number
  closePrice: number
}>

export type PositioningStoredBar = Readonly<{
  observedAt: string
  notionalUsd: number
  volumeBase: number | null
  closePrice: number | null
}>

export type PositioningReadResult =
  | Readonly<{ state: 'available'; btc: readonly PositioningStoredBar[]; eth: readonly PositioningStoredBar[] }>
  | Readonly<{ state: 'empty' }>
  | Readonly<{ state: 'unavailable' }>

export type PerpetualPositioningStore = ReturnType<typeof createPerpetualPositioningSqliteStore>

export function createPerpetualPositioningSqliteStore(filePath: string) {
  mkdirSync(dirname(filePath), { recursive: true })
  const database = new DatabaseSync(filePath)
  database.exec('pragma journal_mode = wal; pragma synchronous = full;')
  database.exec(`create table if not exists perpetual_positioning_15m (
    asset text not null check (asset in ('btc','eth')),
    observed_ms integer not null,
    notional_usd real not null check (notional_usd >= 0),
    volume_base real,
    close_price real,
    collected_at text not null,
    primary key (asset, observed_ms)
  )`)

  const prune = (olderThanMs: number): void => {
    if (!Number.isFinite(olderThanMs)) return
    try { database.prepare('delete from perpetual_positioning_15m where observed_ms < ?').run(olderThanMs) } catch { /* retention is best effort */ }
  }

  return {
    /**
     * Writes one asset's rows. Volume and close are merged rather than replaced: the open
     * interest and K-line legs are separate requests, so whichever arrives second must not
     * blank the other half of the row. A null therefore means "not known yet", never "zero".
     */
    async upsert(input: Readonly<{ asset: PositioningAsset; rows: readonly PositioningRow[]; collectedAt: string }>): Promise<Readonly<{ state: 'updated' | 'unchanged' | 'unavailable' }>> {
      if (!isCanonicalOpenInterestTime(input.collectedAt) || !validRows(input.rows)) return { state: 'unavailable' }
      if (input.rows.length === 0) return { state: 'unchanged' }
      database.exec('begin immediate')
      try {
        const statement = database.prepare(`insert into perpetual_positioning_15m (asset, observed_ms, notional_usd, collected_at)
          values (?, ?, ?, ?)
          on conflict(asset, observed_ms) do update set
            notional_usd = excluded.notional_usd,
            collected_at = excluded.collected_at
          where perpetual_positioning_15m.notional_usd is not excluded.notional_usd`)
        let changed = false
        for (const row of input.rows) {
          changed = Number(statement.run(input.asset, row.observedMs, row.notionalUsd, input.collectedAt).changes) > 0 || changed
        }
        database.exec('commit')
        prune(Date.parse(input.collectedAt) - perpetualPositioningStoragePolicy.retentionDays * 86_400_000)
        return { state: changed ? 'updated' : 'unchanged' }
      } catch {
        try { database.exec('rollback') } catch { /* preserve the original failure */ }
        return { state: 'unavailable' }
      }
    },

    /** The only input to the incremental limit: how far behind the newest stored bucket is. */
    async readNewestMs(input: Readonly<{ asset: PositioningAsset; asOf: number }>): Promise<number | undefined> {
      if (!Number.isSafeInteger(input.asOf) || input.asOf < 0) return undefined
      try {
        const row = database.prepare('select max(observed_ms) as newest from perpetual_positioning_15m where asset = ? and observed_ms <= ?').get(input.asset, input.asOf) as { newest: number | null } | undefined
        const newest = row?.newest
        return typeof newest === 'number' && Number.isSafeInteger(newest) ? newest : undefined
      } catch {
        return undefined
      }
    },

    /**
     * Decorates buckets that already exist with volume and close.
     *
     * The K-line leg can only add to a row, never create one: a row without notional open
     * interest is not a reading this product knows how to show. Rows that do not exist yet
     * are skipped and repaired by the next tick, because the open-interest leg visits the
     * same buckets.
     */
    async upsertVolume(input: Readonly<{ asset: PositioningAsset; rows: readonly PositioningVolumeRow[]; collectedAt: string }>): Promise<Readonly<{ state: 'updated' | 'unchanged' | 'unavailable' }>> {
      if (!isCanonicalOpenInterestTime(input.collectedAt) || !validVolumeRows(input.rows)) return { state: 'unavailable' }
      if (input.rows.length === 0) return { state: 'unchanged' }
      database.exec('begin immediate')
      try {
        const statement = database.prepare(`update perpetual_positioning_15m
          set volume_base = ?, close_price = ?, collected_at = ?
          where asset = ? and observed_ms = ?
            and (volume_base is not ? or close_price is not ?)`)
        let changed = false
        for (const row of input.rows) {
          changed = Number(statement.run(row.volumeBase, row.closePrice, input.collectedAt, input.asset, row.observedMs, row.volumeBase, row.closePrice).changes) > 0 || changed
        }
        database.exec('commit')
        return { state: changed ? 'updated' : 'unchanged' }
      } catch {
        try { database.exec('rollback') } catch { /* preserve the original failure */ }
        return { state: 'unavailable' }
      }
    },

    /** The newest `bars` buckets at or before `asOf`, ascending. */
    async read(input: Readonly<{ asOf: string; bars: number }>): Promise<PositioningReadResult> {
      if (!isCanonicalOpenInterestTime(input.asOf) || !Number.isSafeInteger(input.bars) || input.bars <= 0) return { state: 'unavailable' }
      try {
        const asOfMs = Date.parse(input.asOf)
        const readAsset = (asset: PositioningAsset): readonly PositioningStoredBar[] => {
          const rows = database.prepare('select observed_ms, notional_usd, volume_base, close_price from perpetual_positioning_15m where asset = ? and observed_ms <= ? order by observed_ms desc limit ?')
            .all(asset, asOfMs, input.bars) as Array<{ observed_ms: number; notional_usd: number; volume_base: number | null; close_price: number | null }>
          return rows.reverse().map((row) => {
            if (!Number.isSafeInteger(row.observed_ms) || !Number.isFinite(row.notional_usd)) throw new Error('invalid persisted positioning row')
            return Object.freeze({
              observedAt: new Date(row.observed_ms).toISOString(),
              notionalUsd: row.notional_usd,
              volumeBase: typeof row.volume_base === 'number' && Number.isFinite(row.volume_base) ? row.volume_base : null,
              closePrice: typeof row.close_price === 'number' && Number.isFinite(row.close_price) ? row.close_price : null
            })
          })
        }
        const btc = readAsset('btc')
        const eth = readAsset('eth')
        return btc.length || eth.length ? { state: 'available', btc, eth } : { state: 'empty' }
      } catch {
        return { state: 'unavailable' }
      }
    },

    prune,

    close(): void { database.close() }
  }
}

function validRows(rows: readonly PositioningRow[]): boolean {
  if (!Array.isArray(rows)) return false
  const seen = new Set<number>()
  return rows.every((row) => {
    if (!row || !Number.isSafeInteger(row.observedMs) || row.observedMs < 0) return false
    if (!Number.isFinite(row.notionalUsd) || row.notionalUsd < 0) return false
    if (seen.has(row.observedMs)) return false
    seen.add(row.observedMs)
    return true
  })
}

function validVolumeRows(rows: readonly PositioningVolumeRow[]): boolean {
  if (!Array.isArray(rows)) return false
  const seen = new Set<number>()
  return rows.every((row) => {
    if (!row || !Number.isSafeInteger(row.observedMs) || row.observedMs < 0) return false
    if (!Number.isFinite(row.volumeBase) || row.volumeBase < 0) return false
    if (!Number.isFinite(row.closePrice) || row.closePrice <= 0) return false
    if (seen.has(row.observedMs)) return false
    seen.add(row.observedMs)
    return true
  })
}
