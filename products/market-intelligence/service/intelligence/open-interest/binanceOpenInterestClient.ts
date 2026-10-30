import { getPlatformFetch } from '@platform/network/platformFetch'

import { openInterestHistoryPolicy } from '../../../contracts/openInterestHistory'

export type OpenInterestBarRow = Readonly<{ asset: 'btc' | 'eth'; observedMs: number; notionalUsd: number }>
export type KlineRow = Readonly<{ asset: 'btc' | 'eth'; observedMs: number; volumeBase: number; closePrice: number }>

export type OpenInterestClient = ReturnType<typeof createBinanceOpenInterestClient>

/**
 * Two endpoints, two shapes, two failure modes.
 *
 * `openInterestHist` answers a point in time — its newest bucket is the current open interest
 * and is usable as-is. `klines` answers a period: its newest row is still forming, so a row
 * whose close time is in the future carries a running volume and a last price rather than a
 * closed one, and must be dropped. Treating the two "newest rows" the same way is how a
 * liquidation read ends up comparing a partial bucket with a complete one.
 */
export function createBinanceOpenInterestClient(deps: { platformFetch?: typeof fetch } = {}) {
  return {
    async requestOpenInterest(input: Readonly<{ asset: 'btc' | 'eth'; symbol: string; limit: number; endTime?: number }>): Promise<readonly OpenInterestBarRow[] | undefined> {
      const url = `${openInterestHistoryPolicy.endpoint}?symbol=${input.symbol}&period=${openInterestHistoryPolicy.storedPeriod}&limit=${input.limit}${input.endTime === undefined ? '' : `&endTime=${input.endTime}`}`
      const body = await requestJson(url, deps.platformFetch)
      if (body === undefined) return undefined
      return parseOpenInterestRows(body, input)
    },

    async requestKlines(input: Readonly<{ asset: 'btc' | 'eth'; symbol: string; limit: number; nowMs: number }>): Promise<readonly KlineRow[] | undefined> {
      const url = `${openInterestHistoryPolicy.klinesEndpoint}?symbol=${input.symbol}&interval=${openInterestHistoryPolicy.storedPeriod}&limit=${input.limit}`
      const body = await requestJson(url, deps.platformFetch)
      if (body === undefined) return undefined
      return parseKlineRows(body, input)
    }
  }
}

async function requestJson(url: string, platformFetch?: typeof fetch): Promise<unknown> {
  const fetchImpl = platformFetch ?? getPlatformFetch()
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), openInterestHistoryPolicy.timeoutMs)
  try {
    const response = await fetchImpl(url, { method: 'GET', redirect: 'error', signal: controller.signal, headers: { accept: 'application/json' } })
    if (response.status < 200 || response.status >= 300 || response.redirected) return undefined
    if (response.headers.get('content-type')?.split(';', 1)[0]?.toLowerCase() !== 'application/json') return undefined
    const text = await readBoundedBody(response.body)
    if (text === undefined) return undefined
    return JSON.parse(text) as unknown
  } catch {
    return undefined
  } finally {
    clearTimeout(timeout)
  }
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
      if (!(next.value instanceof Uint8Array) || size + next.value.byteLength > openInterestHistoryPolicy.maximumResponseBytes) {
        await reader.cancel()
        return undefined
      }
      chunks.push(next.value)
      size += next.value.byteLength
    }
    if (!size) return undefined
    const bytes = new Uint8Array(size)
    let offset = 0
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    await reader.cancel().catch(() => undefined)
    return undefined
  } finally {
    reader.releaseLock()
  }
}

const decimal = /^-?\d+(?:\.\d+)?$/

function parseOpenInterestRows(payload: unknown, input: { asset: 'btc' | 'eth'; symbol: string; limit: number }): readonly OpenInterestBarRow[] | undefined {
  if (!Array.isArray(payload) || payload.length === 0 || payload.length > input.limit) return undefined
  const seen = new Set<number>()
  const rows: OpenInterestBarRow[] = []
  for (const value of payload) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
    const row = value as Record<string, unknown>
    if (row.symbol !== input.symbol) return undefined
    const notional = readNumber(row.sumOpenInterestValue)
    if (notional === undefined || notional < 0) return undefined
    if (typeof row.timestamp !== 'number' || !Number.isSafeInteger(row.timestamp) || seen.has(row.timestamp)) return undefined
    seen.add(row.timestamp)
    rows.push(Object.freeze({ asset: input.asset, observedMs: row.timestamp, notionalUsd: notional }))
  }
  return rows.sort((left, right) => left.observedMs - right.observedMs)
}

function parseKlineRows(payload: unknown, input: { asset: 'btc' | 'eth'; limit: number; nowMs: number }): readonly KlineRow[] | undefined {
  if (!Array.isArray(payload) || payload.length === 0 || payload.length > input.limit) return undefined
  const seen = new Set<number>()
  const rows: KlineRow[] = []
  for (const value of payload) {
    if (!Array.isArray(value) || value.length < 7) return undefined
    const [openTime, , , , close, volume, closeTime] = value as unknown[]
    if (typeof openTime !== 'number' || !Number.isSafeInteger(openTime) || seen.has(openTime)) return undefined
    if (typeof closeTime !== 'number' || !Number.isSafeInteger(closeTime)) return undefined
    seen.add(openTime)
    // The newest row is still forming: its volume is partial and its close is a live price.
    if (closeTime > input.nowMs) continue
    const closePrice = readNumber(close)
    const volumeBase = readNumber(volume)
    if (closePrice === undefined || closePrice <= 0 || volumeBase === undefined || volumeBase < 0) return undefined
    rows.push(Object.freeze({ asset: input.asset, observedMs: openTime, volumeBase, closePrice }))
  }
  return rows.sort((left, right) => left.observedMs - right.observedMs)
}

/** Binance sends these as decimal strings; a number is tolerated, anything else fails closed. */
function readNumber(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined
  if (typeof value !== 'string' || !decimal.test(value)) return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}
