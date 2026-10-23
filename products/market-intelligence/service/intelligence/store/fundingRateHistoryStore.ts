import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

export const fundingRateHistoryStoragePolicy = Object.freeze({
  fileName: 'funding-rate-history.sqlite',
  schemaVersion: 1,
  maximumPointsPerAsset: 22,
  assets: Object.freeze(['btc', 'eth'] as const)
})

export type FundingRateHistoryAsset = typeof fundingRateHistoryStoragePolicy.assets[number]
export type FundingRateHistoryPoint = Readonly<{ asset: FundingRateHistoryAsset; fundingTimeMs: number; ratePercent: number }>
export type FundingRateHistoryReadResult =
  | Readonly<{ state: 'available'; btc: readonly Readonly<{ observedAt: string; ratePercent: number }>[]; eth: readonly Readonly<{ observedAt: string; ratePercent: number }>[] }>
  | Readonly<{ state: 'empty' }>
  | Readonly<{ state: 'unavailable' }>

export type FundingRateHistoryStore = ReturnType<typeof createFundingRateHistorySqliteStore>

export function createFundingRateHistorySqliteStore(filePath: string) {
  mkdirSync(dirname(filePath), { recursive: true })
  const database = new DatabaseSync(filePath)
  database.exec('pragma journal_mode = wal; pragma synchronous = full;')
  database.exec('create table if not exists funding_rate_history (asset text not null check (asset in (\'btc\', \'eth\')), funding_time_ms integer not null, rate_percent real not null, collected_at text not null, primary key (asset, funding_time_ms))')

  return {
    async upsert(input: { btc: readonly FundingRateHistoryPoint[]; eth: readonly FundingRateHistoryPoint[]; collectedAt: string }): Promise<Readonly<{ state: 'updated' | 'unchanged' | 'unavailable' }>> {
      if (!isCanonicalUtc(input.collectedAt) || !validInputRows(input.btc, 'btc') || !validInputRows(input.eth, 'eth')) return { state: 'unavailable' }
      database.exec('begin immediate')
      try {
        const statement = database.prepare('insert into funding_rate_history (asset, funding_time_ms, rate_percent, collected_at) values (?, ?, ?, ?) on conflict(asset, funding_time_ms) do update set rate_percent=excluded.rate_percent, collected_at=excluded.collected_at where funding_rate_history.rate_percent is not excluded.rate_percent')
        let changed = false
        for (const row of [...input.btc, ...input.eth]) {
          changed = Number(statement.run(row.asset, row.fundingTimeMs, row.ratePercent, input.collectedAt).changes) > 0 || changed
        }
        database.exec('commit')
        return { state: changed ? 'updated' : 'unchanged' }
      } catch {
        try { database.exec('rollback') } catch { /* preserve original failure */ }
        return { state: 'unavailable' }
      }
    },
    async read(input: { asOf: string }): Promise<FundingRateHistoryReadResult> {
      if (!isCanonicalUtc(input.asOf)) return { state: 'unavailable' }
      try {
        const asOfMs = Date.parse(input.asOf)
        const readAsset = (asset: FundingRateHistoryAsset) => {
          const rows = database.prepare('select funding_time_ms, rate_percent from funding_rate_history where asset = ? and funding_time_ms <= ? order by funding_time_ms desc limit ?').all(asset, asOfMs, fundingRateHistoryStoragePolicy.maximumPointsPerAsset) as Array<{ funding_time_ms: number; rate_percent: number }>
          return rows.reverse().map((row) => {
            if (!Number.isSafeInteger(row.funding_time_ms) || !Number.isFinite(row.rate_percent)) throw new Error('invalid persisted funding row')
            return Object.freeze({ observedAt: new Date(row.funding_time_ms).toISOString(), ratePercent: Object.is(row.rate_percent, -0) ? 0 : row.rate_percent })
          })
        }
        const btc = readAsset('btc')
        const eth = readAsset('eth')
        return btc.length || eth.length ? { state: 'available', btc, eth } : { state: 'empty' }
      } catch {
        return { state: 'unavailable' }
      }
    }
  }
}

function validInputRows(rows: readonly FundingRateHistoryPoint[], asset: FundingRateHistoryAsset): boolean {
  if (!Array.isArray(rows) || rows.length > fundingRateHistoryStoragePolicy.maximumPointsPerAsset) return false
  const seen = new Set<number>()
  return rows.every((row) => {
    if (!row || row.asset !== asset || !Number.isSafeInteger(row.fundingTimeMs) || row.fundingTimeMs < 0 || !Number.isFinite(row.ratePercent) || Math.abs(row.ratePercent) > 100 || seen.has(row.fundingTimeMs)) return false
    seen.add(row.fundingTimeMs)
    return true
  })
}

function isCanonicalUtc(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value
}
