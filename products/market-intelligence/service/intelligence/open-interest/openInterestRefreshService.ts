import { batchesForSpan, openInterestBucketPolicy, openInterestHistoryPolicy } from '../../../contracts/openInterestHistory'
import type { OpenInterestClient } from './binanceOpenInterestClient'
import type { PerpetualPositioningStore, PositioningRow, PositioningVolumeRow } from '../store/perpetualPositioningStore'

export const openInterestCollectionPolicy = Object.freeze({
  bucketMs: openInterestBucketPolicy.storageBucketMs,
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
 * Collects the perpetual positioning series.
 *
 * Three rules here are not obvious:
 *
 * 1. `limit` on an incremental read is derived from how far the store has fallen behind, not from
 *    a fixed window. Polling at the bucket width with `limit=2` fetches one new bucket; after an
 *    outage the same formula asks for the gap, so there is no separate backfill path.
 * 2. A cold start pages **backwards**: each request asks for the newest page not yet seen and
 *    passes the previous page's oldest instant as `endTime`. Newest data decides whether a
 *    reading can be judged at all, and a late arrival fills the recent edge first.
 * 3. A failed page is not a failed round. Whatever was written stays written, the state stays
 *    `updated`/`unchanged`, and the next tick closes the gap from `readNewestMs`. The failure is
 *    logged with its page number so "one segment short" never passes for "nothing happened".
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

const COLD_START_SPAN_MS = 7 * 86_400_000

async function coldStart(client: OpenInterestRefreshDeps['client'], target: { asset: 'btc' | 'eth'; symbol: string }, collectedAt: string): Promise<SegmentWrite | undefined> {
  const caps = openInterestHistoryPolicy.requestLimit
  const bucketMs = openInterestCollectionPolicy.bucketMs
  const openInterestPages = Math.min(openInterestHistoryPolicy.maximumBatchesPerEndpoint, batchesForSpan(COLD_START_SPAN_MS, caps.openInterest, bucketMs))
  const klinePages = Math.min(openInterestHistoryPolicy.maximumBatchesPerEndpoint, batchesForSpan(COLD_START_SPAN_MS, caps.klines, bucketMs))
  const segments: PositioningRow[][] = []
  let openInterestEnd: number | undefined
  for (let page = 0; page < openInterestPages; page += 1) {
    const rows = await client.requestOpenInterest({
      asset: target.asset, symbol: target.symbol, limit: caps.openInterest,
      ...(openInterestEnd === undefined ? {} : { endTime: openInterestEnd })
    })
    // A failed page stops this asset's remaining pages: the endpoint already refused one request,
    // and hammering it for older data is how a rate limit becomes an outage.
    if (!rows || rows.length === 0) { logFailedSegment(target.asset, 'open-interest', page, openInterestPages); break }
    segments.push(rows.map(toOpenInterestRow))
    openInterestEnd = rows[0]!.observedMs - 1
  }
  // Not one usable page: this asset has nothing to write, and the caller counts it as failed.
  if (segments.length === 0) return undefined

  const klines: PositioningVolumeRow[] = []
  let klineEnd: number | undefined
  for (let page = 0; page < klinePages; page += 1) {
    const rows = await client.requestKlines({
      asset: target.asset, symbol: target.symbol, limit: caps.klines, nowMs: Date.parse(collectedAt),
      ...(klineEnd === undefined ? {} : { endTime: klineEnd })
    })
    if (!rows || rows.length === 0) { logFailedSegment(target.asset, 'klines', page, klinePages); break }
    klines.push(...rows.map(toKlineRow))
    klineEnd = rows[0]!.observedMs - 1
  }
  return { openInterest: segments, klines }
}

/** One line per failed page, with its position: a short round must be explainable from logs. */
function logFailedSegment(asset: string, endpoint: 'open-interest' | 'klines', page: number, pages: number): void {
  console.warn(`[open-interest] refresh segment failed: asset=${asset} endpoint=${endpoint} page=${page + 1}/${pages}`)
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
