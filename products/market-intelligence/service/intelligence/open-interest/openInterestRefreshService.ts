import { openInterestHistoryPolicy } from '../../../contracts/openInterestHistory'
import type { OpenInterestClient } from './binanceOpenInterestClient'
import type { PerpetualPositioningStore, PositioningRow, PositioningVolumeRow } from '../store/perpetualPositioningStore'

export const openInterestCollectionPolicy = Object.freeze({
  bucketMs: 900_000,
  assets: Object.freeze({
    btc: Object.freeze({ asset: 'btc' as const, symbol: 'BTCUSDT' }),
    eth: Object.freeze({ asset: 'eth' as const, symbol: 'ETHUSDT' })
  })
})

export type OpenInterestRefreshDeps = Readonly<{
  isEnabled: () => Promise<boolean>
  client: Pick<OpenInterestClient, 'requestOpenInterest' | 'requestKlines'>
  store: Pick<PerpetualPositioningStore, 'upsert' | 'upsertVolume' | 'readNewestMs'>
  now: () => string
}>

/**
 * Collects the 15-minute perpetual positioning series.
 *
 * Two rules here are not obvious:
 *
 * 1. `limit` is derived from how far the store has fallen behind, not from a fixed window.
 *    Polling every 15 minutes with `limit=2` fetches one new bucket; after an outage the same
 *    formula asks for the whole gap, so there is no separate backfill path.
 * 2. A cold start cannot ask for 7 days in one request: `openInterestHist` rejects limit > 500.
 *    It asks for 500, then for the 172 before them. A failed second segment is not a failed
 *    round — the next tick closes the gap by itself — which is why the write is per segment
 *    rather than per round.
 */
export function createOpenInterestRefreshService(deps: OpenInterestRefreshDeps) {
  return {
    async refresh(): Promise<Readonly<{ state: 'updated' | 'unchanged' | 'unavailable' }>> {
      try {
        if (!await deps.isEnabled()) return { state: 'unavailable' }
        const collectedAt = deps.now()
        if (!isCanonicalUtc(collectedAt)) return { state: 'unavailable' }
        const nowMs = Date.parse(collectedAt)

        let wrote = false
        let failed = 0
        for (const target of [openInterestCollectionPolicy.assets.btc, openInterestCollectionPolicy.assets.eth]) {
          const newest = await deps.store.readNewestMs({ asset: target.asset, asOf: nowMs })
          const gap = newest === undefined ? Number.POSITIVE_INFINITY : Math.max(1, Math.ceil((nowMs - newest) / openInterestCollectionPolicy.bucketMs))
          const openInterestLimit = clamp(gap + 2, 2, openInterestHistoryPolicy.requestLimit.openInterest)
          const writes = newest === undefined
            ? await coldStart(deps.client, target, collectedAt)
            : await appendTail(deps.client, target, openInterestLimit, collectedAt, nowMs)
          if (writes === undefined) { failed += 1; continue }
          for (const rows of writes.openInterest) {
            const result = await deps.store.upsert({ asset: target.asset, rows, collectedAt })
            if (result.state === 'unavailable') { failed += 1; break }
            if (result.state === 'updated') wrote = true
          }
          if (writes.klines) {
            const result = await deps.store.upsertVolume({ asset: target.asset, rows: writes.klines, collectedAt })
            if (result.state === 'unavailable') failed += 1
            if (result.state === 'updated') wrote = true
          }
        }

        if (wrote) return { state: 'updated' }
        return failed >= 2 ? { state: 'unavailable' } : { state: 'unchanged' }
      } catch {
        return { state: 'unavailable' }
      }
    }
  }
}

type SegmentWrite = Readonly<{ openInterest: readonly (readonly PositioningRow[])[]; klines?: readonly PositioningVolumeRow[] }>

async function coldStart(client: OpenInterestRefreshDeps['client'], target: { asset: 'btc' | 'eth'; symbol: string }, collectedAt: string): Promise<SegmentWrite | undefined> {
  const newest = await client.requestOpenInterest({ asset: target.asset, symbol: target.symbol, limit: openInterestHistoryPolicy.requestLimit.openInterest })
  if (!newest || newest.length === 0) return undefined
  const segments: PositioningRow[][] = [newest.map(toOpenInterestRow)]
  const oldest = newest[0]!.observedMs
  const older = await client.requestOpenInterest({
    asset: target.asset,
    symbol: target.symbol,
    limit: openInterestHistoryPolicy.requestLimit.klines - openInterestHistoryPolicy.requestLimit.openInterest,
    endTime: oldest - 1
  })
  if (older && older.length > 0) segments.push(older.map(toOpenInterestRow))
  const klines = await client.requestKlines({ asset: target.asset, symbol: target.symbol, limit: openInterestHistoryPolicy.requestLimit.klines, nowMs: Date.parse(collectedAt) })
  return { openInterest: segments, klines: klines?.map(toKlineRow) }
}

async function appendTail(client: OpenInterestRefreshDeps['client'], target: { asset: 'btc' | 'eth'; symbol: string }, limit: number, collectedAt: string, nowMs: number): Promise<SegmentWrite | undefined> {
  const rows = await client.requestOpenInterest({ asset: target.asset, symbol: target.symbol, limit })
  if (!rows || rows.length === 0) return undefined
  const klines = await client.requestKlines({ asset: target.asset, symbol: target.symbol, limit: Math.min(limit, openInterestHistoryPolicy.requestLimit.klines), nowMs })
  return { openInterest: [rows.map(toOpenInterestRow)], klines: klines?.map(toKlineRow) }
}

function toOpenInterestRow(row: { observedMs: number; notionalUsd: number }): PositioningRow {
  return Object.freeze({ observedMs: row.observedMs, notionalUsd: row.notionalUsd })
}

function toKlineRow(row: { observedMs: number; volumeBase: number; closePrice: number }): PositioningVolumeRow {
  return Object.freeze({ observedMs: row.observedMs, volumeBase: row.volumeBase, closePrice: row.closePrice })
}

function clamp(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) return maximum
  return Math.min(maximum, Math.max(minimum, value))
}

function isCanonicalUtc(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value
}
