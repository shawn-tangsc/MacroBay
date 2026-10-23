import { getPlatformFetch } from '@platform/network/platformFetch'

import type { FundingRateHistoryPoint } from '../store/fundingRateHistoryStore'
import { fundingRateCollectionWindowPolicy } from './fundingRateHistoryRefreshService'

export { fundingRateCollectionWindowPolicy } from './fundingRateHistoryRefreshService'

export function createBinanceFundingRateHistoryClient(deps: { platformFetch?: typeof fetch } = {}) {
  return {
    async requestHistory(input: { btc: typeof fundingRateCollectionWindowPolicy.assets.btc; eth: typeof fundingRateCollectionWindowPolicy.assets.eth }) {
      const [btc, eth] = await Promise.all([
        requestAsset(input.btc, deps.platformFetch),
        requestAsset(input.eth, deps.platformFetch)
      ])
      return btc && eth ? { state: 'available' as const, btc, eth } : { state: 'unavailable' as const }
    }
  }
}

async function requestAsset(input: { asset: 'btc' | 'eth'; symbol: string }, platformFetch?: typeof fetch): Promise<readonly FundingRateHistoryPoint[] | undefined> {
  const fetchImpl = platformFetch ?? getPlatformFetch()
  const url = `${fundingRateCollectionWindowPolicy.endpoint}?symbol=${input.symbol}&limit=${fundingRateCollectionWindowPolicy.limit}`
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), fundingRateCollectionWindowPolicy.timeoutMs)
  try {
    const response = await fetchImpl(url, { method: 'GET', redirect: 'error', signal: controller.signal, headers: { accept: 'application/json' } })
    if (response.status < 200 || response.status >= 300 || response.redirected || response.headers.get('content-type')?.split(';', 1)[0]?.toLowerCase() !== 'application/json') return undefined
    const body = await readBoundedBody(response.body)
    if (!body) return undefined
    return parseRows(JSON.parse(body), input)
  } catch {
    return undefined
  } finally { clearTimeout(timeout) }
}

async function readBoundedBody(body: ReadableStream<Uint8Array> | null): Promise<string | undefined> {
  if (!body) return undefined
  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const next = await reader.read()
      if (next.done) break
      if (!(next.value instanceof Uint8Array) || size + next.value.byteLength > fundingRateCollectionWindowPolicy.maximumResponseBytes) { await reader.cancel(); return undefined }
      chunks.push(next.value); size += next.value.byteLength
    }
    if (!size) return undefined
    const bytes = new Uint8Array(size)
    let offset = 0
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    await reader.cancel().catch(() => undefined)
    return undefined
  } finally { reader.releaseLock() }
}

function parseRows(payload: unknown, input: { asset: 'btc' | 'eth'; symbol: string }): readonly FundingRateHistoryPoint[] | undefined {
  if (!Array.isArray(payload) || payload.length === 0 || payload.length > fundingRateCollectionWindowPolicy.limit) return undefined
  const seen = new Set<number>()
  const rows: FundingRateHistoryPoint[] = []
  for (const value of payload) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
    const row = value as Record<string, unknown>
    if (row.symbol !== input.symbol || typeof row.fundingRate !== 'string' || !/^[-+]?\d+(?:\.\d+)?$/.test(row.fundingRate) || typeof row.fundingTime !== 'number' || !Number.isSafeInteger(row.fundingTime) || seen.has(row.fundingTime)) return undefined
    const rate = Number(row.fundingRate)
    if (!Number.isFinite(rate) || Math.abs(rate) > 1) return undefined
    seen.add(row.fundingTime)
    rows.push(Object.freeze({ asset: input.asset, fundingTimeMs: row.fundingTime, ratePercent: rate * 100 }))
  }
  return rows.sort((left, right) => left.fundingTimeMs - right.fundingTimeMs)
}
