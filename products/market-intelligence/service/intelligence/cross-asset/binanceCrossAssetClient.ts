import { SourceRequestGovernanceError, type createSourceRequestGovernanceQueue } from '../application/sourceRequestGovernance'
import { crossAssetPolicy as policy } from './crossAssetPolicy'

/** The Binance contracts this client may read: the tokenised proxy and the two crypto ones. */
export type BinanceAsset = keyof typeof policy.binanceAssets
/** Every symbol the product's store admits, both index legs included. */
export type StoredSymbol = typeof policy.storedSymbols[number]
export type ClosedBar = Readonly<{
  symbol: StoredSymbol; barOpenMs: number; barEndMs: number
  open: string; high: string; low: string; close: string; volume: string
}>
type Input = { asset: BinanceAsset; endMs: number; limit: number }
type RequestControl = { signal?: AbortSignal; intent?: 'automatic' | 'user' }
type Failure = 'invalid-request' | 'dependency-unavailable' | 'invalid-response' | 'response-too-large' | 'response-unavailable' | 'request-timeout' | 'request-cancelled' | 'rate-limited' | 'request-banned'
export class CrossAssetClientError extends Error {
  constructor(readonly code: Failure, readonly retryAfterMs?: number) { super(code) }
}
function reject(code: Failure): never { throw new CrossAssetClientError(code) }

export function createBinanceCrossAssetClient(deps: {
  platformFetch: (input: string, init?: RequestInit) => Promise<Response>
  requestGovernanceQueue: ReturnType<typeof createSourceRequestGovernanceQueue>
}) {
  async function requestJson(path: string, maxBytes: number, control?: RequestControl): Promise<unknown> {
    if (!deps.requestGovernanceQueue || !deps.platformFetch) reject('dependency-unavailable')
    const controller = new AbortController()
    const cancel = () => controller.abort()
    const signal = controller.signal
    let timer: ReturnType<typeof setTimeout> | undefined
    let onAbort: (() => void) | undefined
    let timedOut = false
    control?.signal?.addEventListener('abort', cancel, { once: true })
    if (control?.signal?.aborted) cancel()
    try {
      const interrupted = new Promise<never>((_, fail) => {
        onAbort = () => fail(new CrossAssetClientError(timedOut ? 'request-timeout' : 'request-cancelled'))
        signal.addEventListener('abort', onAbort, { once: true })
        if (signal.aborted) onAbort()
      })
      const operation = deps.requestGovernanceQueue.enqueue({
        sourceId: policy.sourceId, policy: policy.governance, intent: control?.intent ?? policy.productionIntent, signal,
        run: async () => {
          timer = setTimeout(() => { timedOut = true; controller.abort() }, policy.timeoutMs)
          const response = await deps.platformFetch(`${policy.baseUrl}${path}`, { method: 'GET', redirect: 'error', signal })
          if (signal.aborted) { await response.body?.cancel(); reject('request-cancelled') }
          return readJson(response, maxBytes, signal)
        }
      })
      return await Promise.race([operation, interrupted])
    } catch (error) {
      if (error instanceof CrossAssetClientError) throw error
      if (error instanceof SourceRequestGovernanceError && error.code === 'request-cancelled') reject('request-cancelled')
      reject('response-unavailable')
    } finally {
      clearTimeout(timer)
      control?.signal?.removeEventListener('abort', cancel)
      if (onAbort) signal.removeEventListener('abort', onAbort)
    }
  }
  const client = {
    async *fetchHistory(value: Omit<Input, 'limit'>, control?: RequestControl): AsyncGenerator<readonly ClosedBar[]> {
      if (!isDataRecord(value, policy.historyInputFields)) reject('invalid-request')
      const input = readInput({ ...value, limit: policy.maxLimit })
      if (!input) reject('invalid-request')
      const earliestOpen = Math.max(0, input.endMs - policy.historyMaxPoints * policy.intervalMs)
      let cursor = input.endMs
      let remaining = policy.historyMaxPoints
      for (let page = 0; page < policy.historyMaxPages && remaining > 0 && cursor > earliestOpen; page++) {
        const bars = await client.fetchClosedBars({ asset: input.asset, endMs: cursor, limit: Math.min(remaining, policy.maxLimit) }, control)
        if (!bars.length) return
        const bounded = bars.filter(bar => bar.barOpenMs >= earliestOpen)
        if (bounded.length) yield bounded
        cursor = bars[0].barOpenMs
        remaining -= bars.length
      }
    },
    async fetchMetadata(control?: RequestControl) {
      const payload = await requestJson(policy.metadataPath, policy.metadataMaxBytes, control)
      const rows = (payload as { symbols?: unknown[] } | null)?.symbols
      if (!Array.isArray(rows)) reject('invalid-response')
      return (Object.keys(policy.binanceAssets) as BinanceAsset[]).map(asset => {
        const symbol = policy.binanceAssets[asset]
        const matches = rows.filter(value => value && typeof value === 'object' && (value as { symbol?: unknown }).symbol === symbol)
        const row = matches[0] as Record<string, unknown> | undefined
        const identity = policy.identities[asset]
        const filters = Array.isArray(row?.filters) ? row.filters.filter(value => value?.filterType === policy.priceFilter) : []
        const tickSize = filters[0]?.tickSize
        if (matches.length !== 1 || row?.baseAsset !== identity.baseAsset || row.contractType !== identity.contractType ||
          row.status !== policy.tradingStatus || row.quoteAsset !== policy.quoteAsset || row.marginAsset !== policy.quoteAsset ||
          filters.length !== 1 || !decimal(tickSize)) return { asset, symbol, state: 'unavailable' as const }
        return { asset, symbol, state: 'admitted' as const, tickSize, priceDecimals: (tickSize.split('.')[1] ?? '').replace(/0+$/, '').length }
      })
    },
    async fetchClosedBars(value: Input, control?: RequestControl): Promise<readonly ClosedBar[]> {
      const input = readInput(value)
      if (!input) reject('invalid-request')
      const symbol = policy.binanceAssets[input.asset]
      const path = `${policy.historyPath}?symbol=${symbol}&interval=${policy.interval}&endTime=${input.endMs - 1}&limit=${input.limit}`
      const rows = await requestJson(path, policy.maxBodyBytes, control)
      if (!Array.isArray(rows) || rows.length > input.limit) reject('invalid-response')
      const bars = rows.map(row => readBar(row, symbol, input.endMs))
      if (bars.some((bar, index) => index > 0 && bar.barOpenMs <= bars[index - 1].barOpenMs)) reject('invalid-response')
      return bars
    }
  }
  return client
}

function isDataRecord(value: unknown, fields: readonly string[]): boolean {
  try {
    return !!value && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype &&
      Object.getOwnPropertyNames(value).length === fields.length && Object.getOwnPropertySymbols(value).length === 0 &&
      fields.every(field => Object.hasOwn(value, field) && 'value' in Object.getOwnPropertyDescriptor(value, field)!)
  } catch { return false }
}

function readInput(value: unknown): Input | undefined {
  try {
    if (!isDataRecord(value, policy.inputFields)) return
    const { asset, endMs, limit } = value as Input
    if (typeof asset !== 'string' || !Object.hasOwn(policy.binanceAssets, asset) || !Number.isSafeInteger(endMs) || endMs <= 0 ||
      endMs % policy.intervalMs !== 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > policy.maxLimit) return
    return { asset, endMs, limit }
  } catch { return }
}

async function readJson(response: Response, maxBytes: number, signal: AbortSignal): Promise<unknown> {
  if (response.status === policy.http.rateLimited || response.status === policy.http.banned) {
    await response.body?.cancel()
    if (response.status === policy.http.banned) reject('request-banned')
    const value = response.headers.get('retry-after') ?? ''
    const duration = policy.http.deltaSeconds.test(value) ? Number(value) * policy.http.millisecondsPerSecond :
      policy.http.httpDate.test(value) ? Date.parse(value) - Date.now() : NaN
    const retryAfterMs = Number.isSafeInteger(duration) && duration >= 0 ? duration : policy.http.retryFallbackMs
    throw new CrossAssetClientError('rate-limited', retryAfterMs)
  }
  if (!response.ok || response.redirected || response.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase() !== policy.mime) {
    await response.body?.cancel(); reject('response-unavailable')
  }
  if (Number(response.headers.get('content-length')) > maxBytes) {
    await response.body?.cancel(); reject('response-too-large')
  }
  const reader = response.body?.getReader()
  if (!reader) reject('invalid-response')
  const chunks: Uint8Array[] = []
  let bytes = 0
  const cancel = () => { void reader.cancel().catch(() => undefined) }
  signal.addEventListener('abort', cancel, { once: true })
  try {
    for (;;) {
      const part = await reader.read()
      if (part.done) break
      bytes += part.value.byteLength
      if (bytes > maxBytes) { await reader.cancel(); reject('response-too-large') }
      chunks.push(part.value)
    }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { reject('invalid-response') }
  } finally { signal.removeEventListener('abort', cancel); reader.releaseLock() }
}

function decimal(value: unknown, allowZero = false): value is string {
  return typeof value === 'string' && value.length <= policy.decimalMaxLength && policy.decimalPattern.test(value) &&
    Number.isFinite(Number(value)) && (allowZero ? Number(value) >= 0 : Number(value) > 0)
}

function readBar(value: unknown, symbol: StoredSymbol, endMs: number): ClosedBar {
  if (!Array.isArray(value)) reject('invalid-response')
  const [barOpenMs, open, high, low, close, volume, closeTime] = value
  if (!Number.isSafeInteger(barOpenMs) || barOpenMs < 0 || barOpenMs % policy.intervalMs !== 0 ||
    closeTime !== barOpenMs + policy.intervalMs - 1 || closeTime >= endMs ||
    !decimal(open) || !decimal(high) || !decimal(low) || !decimal(close) || !decimal(volume, true) ||
    Number(low) > Math.min(Number(open), Number(close)) || Number(high) < Math.max(Number(open), Number(close))) reject('invalid-response')
  return { symbol, barOpenMs, barEndMs: closeTime + 1, open, high, low, close, volume }
}
