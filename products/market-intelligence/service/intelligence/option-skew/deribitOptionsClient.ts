import {
  optionSkewPolicy,
  type DeribitOptionInstrument,
  type DeribitOptionQuote
} from './optionSkewPolicy'

/** The platform fetch is proxy-aware; this client never opens its own transport. */
export type OptionSkewFetch = (url: string, init: RequestInit) => Promise<Response>

export type OptionSkewFailureCode = 'connection-unavailable' | 'upstream-http-error' | 'upstream-shape-invalid'

export type DeribitChainSnapshot =
  | Readonly<{
    state: 'available'
    instruments: readonly DeribitOptionInstrument[]
    quotes: readonly DeribitOptionQuote[]
    /** When the two requests were made (the collector's clock), not the venue's. */
    observedAt: string
  }>
  | Readonly<{ state: 'unavailable'; failureCode: OptionSkewFailureCode }>

export type DeribitProbeResult =
  | Readonly<{ state: 'available' }>
  | Readonly<{ state: 'unavailable'; failureCode: OptionSkewFailureCode }>

export type DeribitOptionsClient = Readonly<{
  fetchChain: (nowMs: number) => Promise<DeribitChainSnapshot>
  /** One index-price call only: the settings page must not pull a whole chain to test a proxy. */
  probe: () => Promise<DeribitProbeResult>
}>

const REQUEST_TIMEOUT_MS = 30_000

/**
 * Two GETs per round: the listed contracts, then one summary per contract.
 *
 * Reading each contract's own ticker would be hundreds of requests a round and would get the app
 * throttled; the summary endpoint answers the whole chain at once. Field names and the unit of
 * `mark_iv` are the venue's own, verified against a real response before release (design §13.1).
 */
export function createDeribitOptionsClient(deps: { fetch?: OptionSkewFetch }): DeribitOptionsClient {
  const fetchImpl = deps.fetch

  async function getJson(url: string): Promise<{ state: 'ok'; payload: unknown } | { state: 'failed'; failureCode: OptionSkewFailureCode }> {
    if (!fetchImpl) return { state: 'failed', failureCode: 'connection-unavailable' }
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
    try {
      const response = await fetchImpl(url, { method: 'GET', signal: controller.signal })
      if (response.status !== 200) return { state: 'failed', failureCode: 'upstream-http-error' }
      const body = await response.text()
      try {
        return { state: 'ok', payload: JSON.parse(body) }
      } catch {
        return { state: 'failed', failureCode: 'upstream-shape-invalid' }
      }
    } catch {
      // A refused connection, a DNS failure through a dead proxy and our own timeout are one state
      // for the reader: "could not reach the venue". The proxy's own message is not our diagnosis.
      return { state: 'failed', failureCode: 'connection-unavailable' }
    } finally {
      clearTimeout(timer)
    }
  }

  return Object.freeze({
    async fetchChain(nowMs: number): Promise<DeribitChainSnapshot> {
      const base = optionSkewPolicy.baseUrl
      const currency = optionSkewPolicy.currency
      const instrumentsResult = await getJson(`${base}/get_instruments?currency=${currency}&kind=option&expired=false`)
      if (instrumentsResult.state === 'failed') return { state: 'unavailable', failureCode: instrumentsResult.failureCode }
      const instruments = readInstruments(instrumentsResult.payload)
      if (!instruments) return { state: 'unavailable', failureCode: 'upstream-shape-invalid' }

      const summaryResult = await getJson(`${base}/get_book_summary_by_currency?currency=${currency}&kind=option`)
      if (summaryResult.state === 'failed') return { state: 'unavailable', failureCode: summaryResult.failureCode }
      const quotes = readQuotes(summaryResult.payload)
      if (!quotes) return { state: 'unavailable', failureCode: 'upstream-shape-invalid' }

      return { state: 'available', instruments, quotes, observedAt: new Date(nowMs).toISOString() }
    },

    async probe(): Promise<DeribitProbeResult> {
      const result = await getJson(`${optionSkewPolicy.baseUrl}/get_index_price?index_name=btc_usd`)
      if (result.state === 'failed') return { state: 'unavailable', failureCode: result.failureCode }
      const price = readIndexPrice(result.payload)
      return price === undefined
        ? { state: 'unavailable', failureCode: 'upstream-shape-invalid' }
        : { state: 'available' }
    }
  })
}

/** The payload's own shape, read once. Anything that is not a usable contract is skipped. */
function readInstruments(payload: unknown): DeribitOptionInstrument[] | undefined {
  const result = (payload as { result?: unknown } | null)?.result
  if (!Array.isArray(result)) return undefined
  const instruments: DeribitOptionInstrument[] = []
  for (const entry of result) {
    const row = entry as Record<string, unknown>
    const name = row.instrument_name
    const expiry = row.expiration_timestamp
    const strike = row.strike
    const optionType = row.option_type
    if (typeof name !== 'string' || typeof expiry !== 'number' || typeof strike !== 'number') continue
    if (optionType !== 'call' && optionType !== 'put') continue
    if (!Number.isFinite(expiry) || !Number.isFinite(strike) || strike <= 0) continue
    instruments.push({ instrumentName: name, expiryMs: expiry, strike, optionType })
  }
  return instruments.length > 0 ? instruments : undefined
}

function readQuotes(payload: unknown): DeribitOptionQuote[] | undefined {
  const result = (payload as { result?: unknown } | null)?.result
  if (!Array.isArray(result)) return undefined
  const quotes: DeribitOptionQuote[] = []
  for (const entry of result) {
    const row = entry as Record<string, unknown>
    const name = row.instrument_name
    if (typeof name !== 'string') continue
    const markIv = Number(row.mark_iv)
    if (!Number.isFinite(markIv)) continue
    quotes.push({
      instrumentName: name,
      markIv,
      bidPrice: numberOrZero(row.bid_price),
      askPrice: numberOrZero(row.ask_price),
      openInterest: numberOrZero(row.open_interest),
      ...(Number.isFinite(Number(row.underlying_price)) && Number(row.underlying_price) > 0
        ? { underlyingPrice: Number(row.underlying_price) }
        : {})
    })
  }
  return quotes.length > 0 ? quotes : undefined
}

function readIndexPrice(payload: unknown): number | undefined {
  const result = (payload as { result?: unknown } | null)?.result
  if (!result || typeof result !== 'object') return undefined
  const price = Number((result as Record<string, unknown>).index_price)
  return Number.isFinite(price) && price > 0 ? price : undefined
}

function numberOrZero(value: unknown): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}