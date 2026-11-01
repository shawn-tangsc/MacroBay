import {
  leadingOutcome, normalizeOutcomes, type PolicyPathObservation, type PolicyPathOutcome
} from '../../../contracts/policyPath'

/**
 * Reads the implied odds for one meeting from the public market payload.
 *
 * The payload is a list of five binary markets, one per bucket, each carrying its own quote. Two
 * quirks are load-bearing: `outcomePrices` arrives as a JSON **string** inside the JSON document,
 * and the five prices sum to slightly more than one (the venue's overround), so they are normalised
 * rather than reported as-is.
 */
export const policyPathMarketPolicy = {
  endpoint: 'https://gamma-api.polymarket.com',
  venue: 'polymarket',
  /** Venue bucket label → contract outcome. Unknown labels are ignored, never guessed. */
  buckets: {
    'No change': 'no-change',
    '25 bps increase': 'hike-25',
    '50+ bps increase': 'hike-50-plus',
    '25 bps decrease': 'cut-25',
    '50+ bps decrease': 'cut-50-plus'
  } as Record<string, PolicyPathOutcome>
} as const

export type PolicyPathMarketResponse = Readonly<{ ok: boolean; status: number; body: string }>

export type PolicyPathMarketSource = Readonly<{
  /** `slug` is the venue's event identifier, carried by the market link the reader can open. */
  fetchMeeting: (input: { slug: string; at: string }) => Promise<PolicyPathObservation | undefined>
}>

export function createPolicyPathMarketSource(deps: {
  request: (url: string) => Promise<PolicyPathMarketResponse>
}): PolicyPathMarketSource {
  return Object.freeze({
    async fetchMeeting({ slug, at }) {
      if (!slug.trim()) return undefined
      const response = await deps.request(`${policyPathMarketPolicy.endpoint}/events?slug=${encodeURIComponent(slug)}`)
      if (!response.ok || response.status < 200 || response.status >= 300) return undefined
      return parsePolicyPathMarketPayload(response.body, at)
    }
  })
}

export function parsePolicyPathMarketPayload(body: string, at: string): PolicyPathObservation | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch {
    return undefined
  }
  const event = Array.isArray(parsed) ? parsed[0] : parsed
  const markets = (event as { markets?: unknown })?.markets
  if (!Array.isArray(markets) || markets.length === 0) return undefined

  const raw: Partial<Record<PolicyPathOutcome, number>> = {}
  const quotes = new Map<PolicyPathOutcome, { bid: number; ask: number }>()
  for (const market of markets) {
    const bucket = market as { groupItemTitle?: unknown; outcomePrices?: unknown; bestBid?: unknown; bestAsk?: unknown }
    const outcome = typeof bucket.groupItemTitle === 'string' ? policyPathMarketPolicy.buckets[bucket.groupItemTitle] : undefined
    if (!outcome) continue
    const price = leadingPrice(bucket.outcomePrices)
    if (price === undefined) return undefined
    raw[outcome] = price
    if (typeof bucket.bestBid === 'number' && typeof bucket.bestAsk === 'number' &&
      bucket.bestBid >= 0 && bucket.bestAsk <= 1 && bucket.bestBid <= bucket.bestAsk) {
      quotes.set(outcome, { bid: bucket.bestBid, ask: bucket.bestAsk })
    }
  }
  const values = normalizeOutcomes(raw)
  if (!values) return undefined
  // The quote belongs to the bucket the row leads with; a tighter spread on a 1% tail bucket is
  // not the price a reader is looking at.
  const quote = quotes.get(leadingOutcome(values).outcome)
  return { at, values, ...(quote ? { quote } : {}) }
}

/** `outcomePrices` is a JSON-encoded `["Yes","No"]` pair of strings; the Yes leg is the bucket. */
function leadingPrice(value: unknown): number | undefined {
  if (typeof value !== 'string') return undefined
  try {
    const parsed: unknown = JSON.parse(value)
    const first = Array.isArray(parsed) ? parsed[0] : undefined
    const price = typeof first === 'string' ? Number(first) : typeof first === 'number' ? first : Number.NaN
    return Number.isFinite(price) && price >= 0 && price <= 1 ? price : undefined
  } catch {
    return undefined
  }
}
