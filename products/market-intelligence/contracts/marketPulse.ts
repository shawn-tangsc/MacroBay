import type {
  CapitalConditionsSnapshotResult,
  FearGreedSnapshotResult,
  FundingRateHistoryResult
} from './intelligenceQueryContracts'

/**
 * The four readings the daily brief shows, flattened into six rows.
 *
 * A row is data, not copy: the state, the numbers, the window and the observation time. The
 * view layer owns formatting and language. `available` and `stale` keep their value; `unavailable`
 * and `source-disabled` never carry one — a missing reading must not look like zero.
 *
 * The thresholds are product decisions: the fear-greed index updates daily (36h tolerates one
 * missed publication), funding every eight hours (12h tolerates one missed tick), and ETF rows are
 * trading-day rows (96h tolerates a long weekend). The stablecoin snapshot is already bounded by
 * the query service's own six-hour gate, so this layer adds no second staleness rule for it.
 */
export const marketPulsePolicy = Object.freeze({
  fearGreedStaleAfterMs: 36 * 60 * 60 * 1_000,
  fundingStaleAfterMs: 12 * 60 * 60 * 1_000,
  fundingChangeWindowMs: 24 * 60 * 60 * 1_000,
  etfStaleAfterMs: 96 * 60 * 60 * 1_000,
  canonicalUtcMillisPattern: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
})

export type MarketPulseReadingId =
  | 'fear-greed'
  | 'funding-btc'
  | 'funding-eth'
  | 'stablecoin'
  | 'etf-btc'
  | 'etf-eth'

export type MarketPulseState = 'available' | 'stale' | 'unavailable' | 'source-disabled'

/** Why a readable row has no change value. */
export type MarketPulseChangeReason = 'no-baseline' | 'insufficient-window'

/** Why a row has no value at all. */
export type MarketPulseReason =
  | 'not-collected'
  | 'query-failed'
  | 'capital-gate'
  | 'etf-unavailable'

export type MarketPulseValueFormat = 'score' | 'percent' | 'usd' | 'flow-usd'
export type MarketPulseChangeUnit = 'pp' | 'percent' | 'usd'
export type MarketPulseWindow = 'latest' | '24h' | '1d' | 'trading-day'

export type MarketPulseRow = Readonly<{
  id: MarketPulseReadingId
  /** Stable key for the view's copy registry; never a localized string. */
  labelKey: string
  state: MarketPulseState
  value: Readonly<{ number: number; format: MarketPulseValueFormat }> | null
  change: Readonly<{
    value: number
    unit: MarketPulseChangeUnit
    window: MarketPulseWindow
  }> | null
  /** Present only when a readable row has no change value. */
  changeReason?: MarketPulseChangeReason
  /** Present only when the row has no value at all. */
  reason?: MarketPulseReason
  window: MarketPulseWindow
  observedAt: string | null
}>

export type MarketPulseInput = Readonly<{
  asOf: string
  /** The reader's switches, per source. Disabled wins over any stored value. */
  enabled: Readonly<{
    fearGreed: boolean
    funding: boolean
    stablecoin: boolean
    etf: boolean
  }>
  fearGreed: FearGreedSnapshotResult
  funding: FundingRateHistoryResult
  capital: CapitalConditionsSnapshotResult
}>

const LABEL_KEYS: Readonly<Record<MarketPulseReadingId, string>> = Object.freeze({
  'fear-greed': 'dailyBriefing.row.fearGreed',
  'funding-btc': 'dailyBriefing.row.fundingBtc',
  'funding-eth': 'dailyBriefing.row.fundingEth',
  stablecoin: 'dailyBriefing.row.stablecoin',
  'etf-btc': 'dailyBriefing.row.etfBtc',
  'etf-eth': 'dailyBriefing.row.etfEth'
})

export function buildMarketPulseRows(input: MarketPulseInput): readonly MarketPulseRow[] {
  return Object.freeze([
    fearGreedRow(input),
    ...fundingRows(input),
    stablecoinRow(input),
    ...etfRows(input)
  ])
}

function fearGreedRow(input: MarketPulseInput): MarketPulseRow {
  const base = rowBase('fear-greed', 'latest')
  if (!input.enabled.fearGreed) return disabled(base)
  const result = input.fearGreed
  if (result.state === 'empty') return empty(base)
  if (result.state === 'unavailable') return failed(base)
  const observedAt = result.observedAt
  return Object.freeze({
    ...base,
    state: age(input.asOf, observedAt) > marketPulsePolicy.fearGreedStaleAfterMs ? 'stale' : 'available',
    value: Object.freeze({ number: result.score, format: 'score' }),
    change: null,
    changeReason: 'no-baseline',
    observedAt
  })
}

function fundingRows(input: MarketPulseInput): readonly MarketPulseRow[] {
  const btc = rowBase('funding-btc', '24h')
  const eth = rowBase('funding-eth', '24h')
  if (!input.enabled.funding) return Object.freeze([disabled(btc), disabled(eth)])
  const result = input.funding
  if (result.state === 'empty') return Object.freeze([empty(btc), empty(eth)])
  if (result.state === 'unavailable') return Object.freeze([failed(btc), failed(eth)])
  const cutoff = Date.parse(input.asOf) - marketPulsePolicy.fundingChangeWindowMs
  return Object.freeze([
    fundingRow(btc, input.asOf, result.btc, cutoff),
    fundingRow(eth, input.asOf, result.eth, cutoff)
  ])
}

function fundingRow(
  base: MarketPulseRow,
  asOf: string,
  points: readonly { observedAt: string; ratePercent: number }[],
  cutoff: number
): MarketPulseRow {
  const latest = points.at(-1)
  if (!latest) return empty(base)
  const stale = age(asOf, latest.observedAt) > marketPulsePolicy.fundingStaleAfterMs
  const anchor = [...points].reverse().find((point) => Date.parse(point.observedAt) <= cutoff)
  const change = anchor && anchor.observedAt < latest.observedAt
    ? Object.freeze({
      value: normalize(latest.ratePercent - anchor.ratePercent),
      unit: 'pp' as const,
      window: '24h' as const
    })
    : null
  return Object.freeze({
    ...base,
    state: stale ? 'stale' : 'available',
    value: Object.freeze({ number: normalize(latest.ratePercent), format: 'percent' }),
    change,
    ...(change ? {} : { changeReason: 'insufficient-window' as const }),
    observedAt: latest.observedAt
  })
}

function stablecoinRow(input: MarketPulseInput): MarketPulseRow {
  const base = rowBase('stablecoin', '1d')
  if (!input.enabled.stablecoin) return disabled(base)
  const result = input.capital
  if (result.state === 'empty') return empty(base)
  if (result.state === 'unavailable') return failed(base)
  const core = result.coreStablecoins
  return Object.freeze({
    ...base,
    state: 'available',
    value: Object.freeze({ number: normalize(core.currentUsd), format: 'usd' }),
    change: Object.freeze({
      value: normalize(core.change1dPercent),
      unit: 'percent' as const,
      window: '1d' as const
    }),
    observedAt: core.observedAt
  })
}

function etfRows(input: MarketPulseInput): readonly MarketPulseRow[] {
  const btc = rowBase('etf-btc', 'trading-day')
  const eth = rowBase('etf-eth', 'trading-day')
  if (!input.enabled.etf) return Object.freeze([disabled(btc), disabled(eth)])
  const result = input.capital
  if (result.state !== 'available') {
    // The capital query gates ETF: a missing stablecoin snapshot takes the ETF rows with it.
    // This is not "ETF source disabled" — the source may be on.
    return Object.freeze([gated(btc), gated(eth)])
  }
  if (result.etf.state !== 'available') {
    return Object.freeze([
      Object.freeze({ ...btc, state: 'unavailable' as const, reason: 'etf-unavailable' as const }),
      Object.freeze({ ...eth, state: 'unavailable' as const, reason: 'etf-unavailable' as const })
    ])
  }
  return Object.freeze([
    etfRow(btc, input.asOf, result.etf.btc.rows.at(-1)),
    etfRow(eth, input.asOf, result.etf.eth.rows.at(-1))
  ])
}

function etfRow(
  base: MarketPulseRow,
  asOf: string,
  latest: { tradingDate: string; netFlowUsd: number; observedAt: string } | undefined
): MarketPulseRow {
  if (!latest) return empty(base)
  const tradingDay = Date.parse(`${latest.tradingDate}T00:00:00.000Z`)
  const stale = !Number.isFinite(tradingDay) || Date.parse(asOf) - tradingDay > marketPulsePolicy.etfStaleAfterMs
  return Object.freeze({
    ...base,
    state: stale ? 'stale' : 'available',
    value: Object.freeze({ number: normalize(latest.netFlowUsd), format: 'flow-usd' }),
    change: null,
    observedAt: latest.observedAt
  })
}

function rowBase(id: MarketPulseReadingId, window: MarketPulseWindow): MarketPulseRow {
  return Object.freeze({
    id,
    labelKey: LABEL_KEYS[id],
    state: 'unavailable' as const,
    value: null,
    change: null,
    window,
    observedAt: null
  })
}

function disabled(row: MarketPulseRow): MarketPulseRow {
  return Object.freeze({ ...row, state: 'source-disabled' as const })
}

function empty(row: MarketPulseRow): MarketPulseRow {
  return Object.freeze({ ...row, state: 'unavailable' as const, reason: 'not-collected' as const })
}

function failed(row: MarketPulseRow): MarketPulseRow {
  return Object.freeze({ ...row, state: 'unavailable' as const, reason: 'query-failed' as const })
}

function gated(row: MarketPulseRow): MarketPulseRow {
  return Object.freeze({ ...row, state: 'unavailable' as const, reason: 'capital-gate' as const })
}

function age(asOf: string, observedAt: string): number {
  const now = Date.parse(asOf)
  const then = Date.parse(observedAt)
  return Number.isFinite(now) && Number.isFinite(then) ? now - then : Number.POSITIVE_INFINITY
}

function normalize(value: number): number {
  return Object.is(value, -0) ? 0 : value
}
