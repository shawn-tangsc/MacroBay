import type {
  CapitalConditionsSnapshotResult,
  FundingRateHistoryResult
} from '../../../contracts/intelligenceQueryContracts'
import type { OpenInterestHistoryResult } from '../../../contracts/openInterestHistory'
import type { MarketIntelligencePublicQueryService } from './publicQueryService'

/**
 * The daily brief's historical backfill tool.
 *
 * A briefing is frozen at its 08:00 cutoff, but it is often *generated* hours later. Every read the
 * packet makes is as-of aware; this tool is the one way the editor can ask for a value that was
 * collected after the cutoff but describes an instant at or before it. It answers one question at a
 * time — `{source, metric, asOf}` — and it either returns a value with its observation time, source
 * and method, or a named gap. It never estimates, never synthesises, and never reaches past its own
 * cutoff: `asOf` is validated against the edition cutoff before any store is touched.
 *
 * The three sources whose only read path is a current snapshot answer `historical-as-of-unavailable`
 * rather than a plausible-looking number. That is deliberate: a 21:00 snapshot is not the 08:00
 * market, and a backfill that "fills" a gap with it would be exactly the masquerade this tool exists
 * to prevent.
 */

export const dailyBriefBackfillPolicy = Object.freeze({
  /** One selection round may ask for this many facts; a larger list is truncated in request order. */
  maximumRequestsPerRound: 4,
  canonicalUtcMillisPattern: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
})

export type DailyBriefBackfillSource =
  | 'stablecoin'
  | 'etf'
  | 'funding'
  | 'open-interest'
  | 'dxy'
  | 'gold'
  | 'treasury'

export type DailyBriefBackfillMetric =
  | 'core-stablecoin-supply-usd'
  | 'etf-net-flow-btc'
  | 'etf-net-flow-eth'
  | 'funding-rate-percent-btc'
  | 'funding-rate-percent-eth'
  | 'open-interest-usd-btc'
  | 'open-interest-usd-eth'
  | 'dxy-level'
  | 'gold-level-usd'
  | 'us10y-yield-percent'
  | 'us10y-real-yield-percent'

export type DailyBriefBackfillUnit = 'usd' | 'flow-usd' | 'percent' | 'level'

export type DailyBriefBackfillGapCode =
  | 'invalid-as-of'
  | 'future-as-of'
  | 'unknown-metric'
  | 'historical-as-of-unavailable'
  | 'not-visible-as-of'
  | 'query-unavailable'
  | 'value-unavailable'

export type DailyBriefBackfillRequest = Readonly<{
  source: string
  metric: string
  asOf: string
}>

export type DailyBriefBackfillFact = Readonly<{
  state: 'available'
  source: DailyBriefBackfillSource
  metric: DailyBriefBackfillMetric
  asOf: string
  value: number
  unit: DailyBriefBackfillUnit
  observedAt: string
  sourceUrl: string
  method: string
}>

export type DailyBriefBackfillGap = Readonly<{
  state: 'unavailable'
  source: string
  metric: string
  asOf: string
  gapCode: DailyBriefBackfillGapCode
  detail: string
}>

export type DailyBriefBackfillResult = DailyBriefBackfillFact | DailyBriefBackfillGap

export type DailyBriefBackfillDeps = Readonly<{
  /** The edition cutoff. An `asOf` after it is rejected before any reader runs. */
  cutoff: string
  capital: (input: Readonly<{ asOf: string; allowStale: true }>) => Promise<CapitalConditionsSnapshotResult>
  funding: (input: Readonly<{ asOf: string }>) => Promise<FundingRateHistoryResult>
  openInterest: (input: Readonly<{ asOf: string; window: '24h' }>) => Promise<OpenInterestHistoryResult>
  now?: () => string
}>

type Reader =
  | 'stablecoin'
  | 'etf-btc'
  | 'etf-eth'
  | 'funding-btc'
  | 'funding-eth'
  | 'open-interest-btc'
  | 'open-interest-eth'

type MetricPolicy =
  | Readonly<{
      source: DailyBriefBackfillSource
      unit: DailyBriefBackfillUnit
      reader: Reader
      method: string
      sourceUrl: string
    }>
  | Readonly<{
      source: DailyBriefBackfillSource
      unit: DailyBriefBackfillUnit
      /** No as-of read path exists for this metric in this product. */
      reader: null
      unavailableReason: string
    }>

const METRIC_POLICY: Readonly<Record<DailyBriefBackfillMetric, MetricPolicy>> = Object.freeze({
  'core-stablecoin-supply-usd': Object.freeze({
    source: 'stablecoin', unit: 'usd', reader: 'stablecoin',
    method: 'capital-conditions-as-of-snapshot', sourceUrl: 'https://stablecoins.llama.fi/stablecoins'
  }),
  'etf-net-flow-btc': Object.freeze({
    source: 'etf', unit: 'flow-usd', reader: 'etf-btc',
    method: 'etf-current-state-as-of', sourceUrl: 'https://0xrouter.app/cexdata/etf/bitcoin/flow-history'
  }),
  'etf-net-flow-eth': Object.freeze({
    source: 'etf', unit: 'flow-usd', reader: 'etf-eth',
    method: 'etf-current-state-as-of', sourceUrl: 'https://0xrouter.app/cexdata/etf/ethereum/flow-history'
  }),
  'funding-rate-percent-btc': Object.freeze({
    source: 'funding', unit: 'percent', reader: 'funding-btc',
    method: 'funding-rate-history-as-of', sourceUrl: 'https://fapi.binance.com/fapi/v1/fundingRate'
  }),
  'funding-rate-percent-eth': Object.freeze({
    source: 'funding', unit: 'percent', reader: 'funding-eth',
    method: 'funding-rate-history-as-of', sourceUrl: 'https://fapi.binance.com/fapi/v1/fundingRate'
  }),
  'open-interest-usd-btc': Object.freeze({
    source: 'open-interest', unit: 'usd', reader: 'open-interest-btc',
    method: 'perpetual-positioning-as-of', sourceUrl: 'https://fapi.binance.com/futures/data/openInterestHist'
  }),
  'open-interest-usd-eth': Object.freeze({
    source: 'open-interest', unit: 'usd', reader: 'open-interest-eth',
    method: 'perpetual-positioning-as-of', sourceUrl: 'https://fapi.binance.com/futures/data/openInterestHist'
  }),
  // The dollar and gold are read from one in-memory current snapshot whose window returns are
  // computed at read time, and FRED's daily closes are published as the current snapshot only.
  // None of the three exposes a stored as-of series to this layer, so the honest answer is a gap.
  'dxy-level': Object.freeze({
    source: 'dxy', unit: 'level', reader: null,
    unavailableReason: 'the macro-market snapshot is a current read; no stored as-of series is exposed to the backfill tool.'
  }),
  'gold-level-usd': Object.freeze({
    source: 'gold', unit: 'level', reader: null,
    unavailableReason: 'the macro-market snapshot is a current read; no stored as-of series is exposed to the backfill tool.'
  }),
  'us10y-yield-percent': Object.freeze({
    source: 'treasury', unit: 'percent', reader: null,
    unavailableReason: 'FRED daily closes are published as the current rates snapshot; no stored as-of series is exposed to the backfill tool.'
  }),
  'us10y-real-yield-percent': Object.freeze({
    source: 'treasury', unit: 'percent', reader: null,
    unavailableReason: 'FRED daily closes are published as the current rates snapshot; no stored as-of series is exposed to the backfill tool.'
  })
})

export function listDailyBriefBackfillMetrics(): readonly Readonly<{ source: DailyBriefBackfillSource; metric: DailyBriefBackfillMetric }>[] {
  return Object.freeze((Object.keys(METRIC_POLICY) as DailyBriefBackfillMetric[])
    .map((metric) => Object.freeze({ source: METRIC_POLICY[metric].source, metric })))
}

export function isDailyBriefBackfillMetric(source: unknown, metric: unknown): metric is DailyBriefBackfillMetric {
  return typeof metric === 'string' && typeof source === 'string' &&
    Object.hasOwn(METRIC_POLICY, metric) && METRIC_POLICY[metric as DailyBriefBackfillMetric].source === source
}

export function isCanonicalDailyBriefBackfillTime(value: unknown): value is string {
  return typeof value === 'string' && dailyBriefBackfillPolicy.canonicalUtcMillisPattern.test(value) &&
    Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value
}

/** Validates a result that crosses the executor boundary; an unknown shape is a gap, never a fact. */
export function isDailyBriefBackfillResult(value: unknown): value is DailyBriefBackfillResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  if (typeof record.source !== 'string' || typeof record.metric !== 'string' || !isCanonicalDailyBriefBackfillTime(record.asOf)) return false
  if (record.state === 'unavailable') {
    return typeof record.gapCode === 'string' && typeof record.detail === 'string' && record.detail.trim().length > 0
  }
  if (record.state !== 'available') return false
  return isDailyBriefBackfillMetric(record.source, record.metric) &&
    typeof record.value === 'number' && Number.isFinite(record.value) &&
    (record.unit === 'usd' || record.unit === 'flow-usd' || record.unit === 'percent' || record.unit === 'level') &&
    isCanonicalDailyBriefBackfillTime(record.observedAt) &&
    typeof record.sourceUrl === 'string' && record.sourceUrl.startsWith('https://') &&
    typeof record.method === 'string' && record.method.trim().length > 0
}

/**
 * Answers one backfill request. Pure of the clock except for the optional `now` guard, and pure of
 * the network: every reader is an already-collected store.
 */
export async function backfillDailyBriefFact(
  request: DailyBriefBackfillRequest,
  deps: DailyBriefBackfillDeps
): Promise<DailyBriefBackfillResult> {
  const asOf = typeof request.asOf === 'string' ? request.asOf.trim() : ''
  const requested = { source: String(request.source ?? ''), metric: String(request.metric ?? ''), asOf }
  if (!isCanonicalDailyBriefBackfillTime(asOf)) {
    return gap(requested, 'invalid-as-of', 'asOf must be a canonical UTC instant, for example 2026-10-30T00:00:00.000Z.')
  }
  if (!isCanonicalDailyBriefBackfillTime(deps.cutoff)) {
    return gap(requested, 'future-as-of', 'the edition cutoff is unreadable, so no backfill is allowed.')
  }
  if (asOf > deps.cutoff) {
    return gap(requested, 'future-as-of', `asOf is after the edition cutoff ${deps.cutoff}; a brief may not read the future it describes.`)
  }
  const now = deps.now?.()
  if (isCanonicalDailyBriefBackfillTime(now) && asOf > now) {
    return gap(requested, 'future-as-of', 'asOf is after the current time.')
  }
  if (!isDailyBriefBackfillMetric(requested.source, requested.metric)) {
    return gap(requested, 'unknown-metric', `no backfill source answers ${requested.source}:${requested.metric}.`)
  }
  const policy = METRIC_POLICY[requested.metric]
  if (!policy.reader) {
    return gap(requested, 'historical-as-of-unavailable', policy.unavailableReason)
  }
  try {
    const read = await readMetric(policy.reader, asOf, deps)
    if (read.state === 'unavailable') return gap(requested, read.gapCode, read.detail)
    const value = read.value
    if (!Number.isFinite(value)) return gap(requested, 'value-unavailable', 'the stored reading is not a finite number.')
    if (read.observedAt > asOf) {
      return gap(requested, 'not-visible-as-of', `the stored observation ${read.observedAt} is newer than the requested instant.`)
    }
    const fact: DailyBriefBackfillFact = Object.freeze({
      state: 'available',
      source: policy.source,
      metric: requested.metric,
      asOf,
      value,
      unit: policy.unit,
      observedAt: read.observedAt,
      sourceUrl: policy.sourceUrl,
      method: policy.method
    })
    return fact
  } catch {
    return gap(requested, 'query-unavailable', 'the stored series could not be read.')
  }
}

/** Binds the tool to one edition cutoff and to the public query service's existing as-of reads. */
export function createDailyBriefBackfillExecutor(input: Readonly<{
  cutoff: string
  publicQuery: Pick<MarketIntelligencePublicQueryService,
    'queryCapitalConditionsSnapshot' | 'queryFundingRateHistory' | 'queryOpenInterestHistory'>
  now?: () => string
}>): (request: DailyBriefBackfillRequest) => Promise<DailyBriefBackfillResult> {
  const deps: DailyBriefBackfillDeps = {
    cutoff: input.cutoff,
    capital: (query) => input.publicQuery.queryCapitalConditionsSnapshot(query),
    funding: (query) => input.publicQuery.queryFundingRateHistory(query),
    openInterest: (query) => input.publicQuery.queryOpenInterestHistory(query),
    ...(input.now ? { now: input.now } : {})
  }
  return (request) => backfillDailyBriefFact(request, deps)
}

type ReadResult =
  | Readonly<{ state: 'available'; value: number; observedAt: string }>
  | Readonly<{ state: 'unavailable'; gapCode: DailyBriefBackfillGapCode; detail: string }>

async function readMetric(reader: Reader, asOf: string, deps: DailyBriefBackfillDeps): Promise<ReadResult> {
  switch (reader) {
    case 'stablecoin': {
      const result = await deps.capital({ asOf, allowStale: true })
      if (result.state === 'empty') return missing('the capital store holds no snapshot at or before this instant.')
      if (result.state !== 'available') return unavailable('query-unavailable', 'the capital conditions query answered unavailable.')
      return { state: 'available', value: result.coreStablecoins.currentUsd, observedAt: result.coreStablecoins.observedAt }
    }
    case 'etf-btc':
    case 'etf-eth': {
      const result = await deps.capital({ asOf, allowStale: true })
      if (result.state === 'empty') return missing('the capital store holds no snapshot at or before this instant.')
      if (result.state !== 'available') return unavailable('query-unavailable', 'the capital conditions query answered unavailable.')
      if (result.etf.state !== 'available') return missing('the ETF current-state snapshot was not visible at this instant.')
      const rows = (reader === 'etf-btc' ? result.etf.btc.rows : result.etf.eth.rows)
        .filter((row) => row.tradingDate <= asOf.slice(0, 10) && row.observedAt <= asOf)
        .sort((left, right) => left.tradingDate.localeCompare(right.tradingDate))
      const latest = rows.at(-1)
      return latest
        ? { state: 'available', value: latest.netFlowUsd, observedAt: latest.observedAt }
        : missing('no ETF flow row was observed at or before this instant.')
    }
    case 'funding-btc':
    case 'funding-eth': {
      const result = await deps.funding({ asOf })
      if (result.state === 'empty') return missing('the funding history holds no point at or before this instant.')
      if (result.state !== 'available') return unavailable('query-unavailable', 'the funding history query answered unavailable.')
      const points = (reader === 'funding-btc' ? result.btc : result.eth).filter((point) => point.observedAt <= asOf)
      const latest = points.at(-1)
      return latest
        ? { state: 'available', value: latest.ratePercent, observedAt: latest.observedAt }
        : missing('no funding point was observed at or before this instant.')
    }
    case 'open-interest-btc':
    case 'open-interest-eth': {
      const result = await deps.openInterest({ asOf, window: '24h' })
      if (result.state === 'empty') return missing('the positioning store holds no bar at or before this instant.')
      if (result.state !== 'available') return unavailable('query-unavailable', 'the open-interest history query answered unavailable.')
      const points = (reader === 'open-interest-btc' ? result.btc : result.eth).filter((point) => point.observedAt <= asOf)
      const latest = points.at(-1)
      return latest
        ? { state: 'available', value: latest.notionalUsd, observedAt: latest.observedAt }
        : missing('no open-interest bar was observed at or before this instant.')
    }
  }
}

function gap(
  request: Readonly<{ source: string; metric: string; asOf: string }>,
  gapCode: DailyBriefBackfillGapCode,
  detail: string
): DailyBriefBackfillGap {
  return Object.freeze({
    state: 'unavailable' as const,
    source: request.source,
    metric: request.metric,
    asOf: request.asOf,
    gapCode,
    detail
  })
}

function unavailable(gapCode: DailyBriefBackfillGapCode, detail: string): ReadResult {
  return Object.freeze({ state: 'unavailable' as const, gapCode, detail })
}

function missing(detail: string): ReadResult {
  return unavailable('not-visible-as-of', detail)
}
