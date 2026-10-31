import type {
  CapitalConditionsSnapshotResult,
  FundingRateHistoryResult
} from '../../../contracts/intelligenceQueryContracts'
import type { OpenInterestHistoryResult } from '../../../contracts/openInterestHistory'
import type { EtfHistoryAsOfResult, EtfHistoryAsset } from './etfHistoryAsOf'
import type {
  MacroHistoryAsOfGapCode,
  MacroHistoryAsOfResult,
  MacroHistoryAsOfSeries
} from './macroHistoryAsOf'
import type { MarketIntelligencePublicQueryService } from './publicQueryService'
import type { StablecoinHistoryAsOfResult } from './stablecoinHistoryAsOf'

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
 * Where each whitelisted metric reads from:
 *
 * - the crypto facts read stores that already answer as-of instants directly (capital conditions,
 *   funding history, open-interest history);
 * - the dollar, gold and the two 10-year yields read the product's stored history through
 *   `macroHistory` — the macro-market points and FRED's stored daily closes. That reader answers
 *   `historical-as-of-unavailable` whenever no stored observation exists at or before the instant,
 *   including when no historical reader is wired at all. It never falls back to the current
 *   snapshot: a 21:00 figure is not the 08:00 market, and a backfill that "filled" a gap with it
 *   would be exactly the masquerade this tool exists to prevent.
 *
 * The ETF flows have a second read path, used only when the local store holds no flow row at or
 * before the instant: 0xRouter's own daily flow history, because a briefing frozen at its cutoff may
 * be generated hours later, on a machine that was not awake for the cutoff. That reader only runs
 * when the local snapshot answered `empty` (or held no row for the instant), it validates `asOf`
 * against the cutoff and the clock before any request, and an unavailable or failed interface is a
 * named gap — never a number. A stored row always wins, and a disabled or broken store is not read
 * around.
 *
 * The stablecoin level has a second read path too, but only for its own metric: the USDT+USDC
 * *core* supply the funds card shows is read from DefiLlama's per-asset histories
 * (`/stablecoin/1`, `/stablecoin/2`) and summed. It is never answered from `stablecoincharts/all`,
 * which is every USD-pegged asset and therefore a wider, different metric. Both assets must answer;
 * one missing asset stays a named `historical-api-unavailable` gap rather than half a number.
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
  /** No public history interface is wired for this fact, so there is nothing to ask. */
  | 'historical-api-unavailable'
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
  /**
   * The stored macro history: what the dollar, gold and the two 10-year yields said at an instant.
   * `undefined` means no such read path is wired in this build, which is a gap rather than a value.
   */
  macroHistory: (input: Readonly<{ series: MacroHistoryAsOfSeries; asOf: string }>) => Promise<MacroHistoryAsOfResult | undefined>
  /**
   * The ETF provider's public daily flow history, asked only after the capital store answered
   * `empty` or held no flow row at the instant. `undefined` means no interface is wired, which is
   * `historical-api-unavailable`, not a fallback to any current snapshot.
   */
  etfHistory?: (input: Readonly<{ asset: EtfHistoryAsset; asOf: string }>) => Promise<EtfHistoryAsOfResult>
  /**
   * DefiLlama's two per-asset daily histories (USDT and USDC), asked only after the capital store
   * answered `empty`. The reader itself refuses to answer unless both assets produced a completed
   * point, so this tool never sees a half-core value. `undefined` means no interface is wired,
   * which is `historical-api-unavailable`.
   */
  stablecoinHistory?: (input: Readonly<{ asOf: string }>) => Promise<StablecoinHistoryAsOfResult>
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
  | MacroReader

type MacroReader = 'macro-dxy' | 'macro-gold' | 'macro-us10y' | 'macro-us10y-real'

type MetricPolicy = Readonly<{
  source: DailyBriefBackfillSource
  unit: DailyBriefBackfillUnit
  reader: Reader
}>

const METRIC_POLICY: Readonly<Record<DailyBriefBackfillMetric, MetricPolicy>> = Object.freeze({
  'core-stablecoin-supply-usd': Object.freeze({ source: 'stablecoin', unit: 'usd', reader: 'stablecoin' }),
  'etf-net-flow-btc': Object.freeze({ source: 'etf', unit: 'flow-usd', reader: 'etf-btc' }),
  'etf-net-flow-eth': Object.freeze({ source: 'etf', unit: 'flow-usd', reader: 'etf-eth' }),
  'funding-rate-percent-btc': Object.freeze({ source: 'funding', unit: 'percent', reader: 'funding-btc' }),
  'funding-rate-percent-eth': Object.freeze({ source: 'funding', unit: 'percent', reader: 'funding-eth' }),
  'open-interest-usd-btc': Object.freeze({ source: 'open-interest', unit: 'usd', reader: 'open-interest-btc' }),
  'open-interest-usd-eth': Object.freeze({ source: 'open-interest', unit: 'usd', reader: 'open-interest-eth' }),
  // The four macro facts project stored history rather than the current snapshot: the macro-market
  // store keeps five-minute points for the newest eight days and hourly ones to thirty, and FRED's
  // daily closes accumulate in the metric-event store, so an earlier instant of the same edition is
  // answerable without a single new request.
  'dxy-level': Object.freeze({ source: 'dxy', unit: 'level', reader: 'macro-dxy' }),
  'gold-level-usd': Object.freeze({ source: 'gold', unit: 'level', reader: 'macro-gold' }),
  'us10y-yield-percent': Object.freeze({ source: 'treasury', unit: 'percent', reader: 'macro-us10y' }),
  'us10y-real-yield-percent': Object.freeze({ source: 'treasury', unit: 'percent', reader: 'macro-us10y-real' })
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
 * Answers one backfill request. Pure of the clock except for the optional `now` guard. The stored
 * readers never touch the network; the two capital facts fall back to a public history reader only
 * when the store holds nothing at the instant, and that fallback is what `historical-*` gaps name.
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
      sourceUrl: read.sourceUrl,
      method: read.method
    })
    return fact
  } catch {
    return gap(requested, 'query-unavailable', 'the stored series or its public history could not be read.')
  }
}

/** Binds the tool to one edition cutoff and to the public query service's existing as-of reads. */
export function createDailyBriefBackfillExecutor(input: Readonly<{
  cutoff: string
  publicQuery: Pick<MarketIntelligencePublicQueryService,
    'queryCapitalConditionsSnapshot' | 'queryFundingRateHistory' | 'queryOpenInterestHistory' | 'queryMacroHistoryAsOf'>
  /** The ETF provider's public daily flow history, asked only when the store holds nothing. */
  etfHistory?: (request: Readonly<{ asset: EtfHistoryAsset; asOf: string }>) => Promise<EtfHistoryAsOfResult>
  /** DefiLlama's per-asset USDT+USDC histories, asked only when the store holds nothing. */
  stablecoinHistory?: (request: Readonly<{ asOf: string }>) => Promise<StablecoinHistoryAsOfResult>
  now?: () => string
}>): (request: DailyBriefBackfillRequest) => Promise<DailyBriefBackfillResult> {
  const deps: DailyBriefBackfillDeps = {
    cutoff: input.cutoff,
    capital: (query) => input.publicQuery.queryCapitalConditionsSnapshot(query),
    funding: (query) => input.publicQuery.queryFundingRateHistory(query),
    openInterest: (query) => input.publicQuery.queryOpenInterestHistory(query),
    macroHistory: async (query) => input.publicQuery.queryMacroHistoryAsOf(query),
    ...(input.etfHistory ? { etfHistory: input.etfHistory } : {}),
    ...(input.stablecoinHistory ? { stablecoinHistory: input.stablecoinHistory } : {}),
    ...(input.now ? { now: input.now } : {})
  }
  return (request) => backfillDailyBriefFact(request, deps)
}

type ReadResult =
  | Readonly<{ state: 'available'; value: number; observedAt: string; method: string; sourceUrl: string }>
  | Readonly<{ state: 'unavailable'; gapCode: DailyBriefBackfillGapCode; detail: string }>

/**
 * How a reader describes itself in the answer. The tool prints these beside the value, so a fact's
 * provenance is written by the reader that actually read it rather than by the metric list.
 */
const READER_PROVENANCE = Object.freeze({
  stablecoin: Object.freeze({
    method: 'capital-conditions-as-of-snapshot', sourceUrl: 'https://stablecoins.llama.fi/stablecoins'
  }),
  etfBtc: Object.freeze({
    method: 'etf-current-state-as-of', sourceUrl: 'https://0xrouter.app/cexdata/etf/bitcoin/flow-history'
  }),
  etfEth: Object.freeze({
    method: 'etf-current-state-as-of', sourceUrl: 'https://0xrouter.app/cexdata/etf/ethereum/flow-history'
  }),
  funding: Object.freeze({
    method: 'funding-rate-history-as-of', sourceUrl: 'https://fapi.binance.com/fapi/v1/fundingRate'
  }),
  openInterest: Object.freeze({
    method: 'perpetual-positioning-as-of', sourceUrl: 'https://fapi.binance.com/futures/data/openInterestHist'
  })
})

const MACRO_SERIES: Readonly<Record<MacroReader, MacroHistoryAsOfSeries>> = Object.freeze({
  'macro-dxy': 'dxy', 'macro-gold': 'gold', 'macro-us10y': 'us10y', 'macro-us10y-real': 'us10y-real'
})

/**
 * The historical reader's gap vocabulary, mapped onto this tool's. Its `unknown-series` cannot occur
 * from a whitelisted metric; it is mapped rather than passed through so no unrecognised code reaches
 * the editor.
 */
const MACRO_GAP_CODES: Readonly<Record<MacroHistoryAsOfGapCode, DailyBriefBackfillGapCode>> = Object.freeze({
  'invalid-as-of': 'invalid-as-of',
  'future-as-of': 'future-as-of',
  'unknown-series': 'unknown-metric',
  'historical-as-of-unavailable': 'historical-as-of-unavailable',
  'query-unavailable': 'query-unavailable'
})

/**
 * The public-history readers' gap vocabulary, mapped onto this tool's. `unknown-asset` cannot occur
 * from a whitelisted ETF metric; it is mapped rather than passed through so no unrecognised code
 * reaches the editor.
 */
const HISTORICAL_API_GAP_CODES: Readonly<Record<string, DailyBriefBackfillGapCode>> = Object.freeze({
  'invalid-as-of': 'invalid-as-of',
  'future-as-of': 'future-as-of',
  'unknown-asset': 'unknown-metric',
  'historical-api-unavailable': 'historical-api-unavailable',
  'historical-as-of-unavailable': 'historical-as-of-unavailable',
  'query-unavailable': 'query-unavailable'
})

async function readMetric(reader: Reader, asOf: string, deps: DailyBriefBackfillDeps): Promise<ReadResult> {
  switch (reader) {
    case 'stablecoin': {
      const result = await deps.capital({ asOf, allowStale: true })
      if (result.state === 'available') {
        return {
          state: 'available', value: result.coreStablecoins.currentUsd, observedAt: result.coreStablecoins.observedAt,
          ...READER_PROVENANCE.stablecoin
        }
      }
      if (result.state === 'unavailable') return unavailable('query-unavailable', 'the capital conditions query answered unavailable.')
      // The store holds nothing at or before the instant; the two per-asset public series might.
      // This reader returns a value only when USDT and USDC both answered, so the core metric is
      // never rebuilt from one asset, from a zero, or from the wider aggregate series.
      return readStablecoinHistory(asOf, deps)
    }
    case 'etf-btc':
    case 'etf-eth': {
      const asset: EtfHistoryAsset = reader === 'etf-btc' ? 'btc' : 'eth'
      const result = await deps.capital({ asOf, allowStale: true })
      if (result.state === 'unavailable') return unavailable('query-unavailable', 'the capital conditions query answered unavailable.')
      if (result.state === 'available' && result.etf.state === 'available') {
        const rows = (asset === 'btc' ? result.etf.btc.rows : result.etf.eth.rows)
          .filter((row) => row.tradingDate <= asOf.slice(0, 10) && row.observedAt <= asOf)
          .sort((left, right) => left.tradingDate.localeCompare(right.tradingDate))
        const latest = rows.at(-1)
        if (latest) {
          return {
            state: 'available', value: latest.netFlowUsd, observedAt: latest.observedAt,
            ...(asset === 'btc' ? READER_PROVENANCE.etfBtc : READER_PROVENANCE.etfEth)
          }
        }
      }
      // The store holds no flow row at or before the instant; the provider's history might.
      return readEtfHistory(asset, asOf, deps)
    }
    case 'funding-btc':
    case 'funding-eth': {
      const result = await deps.funding({ asOf })
      if (result.state === 'empty') return missing('the funding history holds no point at or before this instant.')
      if (result.state !== 'available') return unavailable('query-unavailable', 'the funding history query answered unavailable.')
      const points = (reader === 'funding-btc' ? result.btc : result.eth).filter((point) => point.observedAt <= asOf)
      const latest = points.at(-1)
      return latest
        ? { state: 'available', value: latest.ratePercent, observedAt: latest.observedAt, ...READER_PROVENANCE.funding }
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
        ? { state: 'available', value: latest.notionalUsd, observedAt: latest.observedAt, ...READER_PROVENANCE.openInterest }
        : missing('no open-interest bar was observed at or before this instant.')
    }
    case 'macro-dxy':
    case 'macro-gold':
    case 'macro-us10y':
    case 'macro-us10y-real': {
      const read = await deps.macroHistory({ series: MACRO_SERIES[reader], asOf })
      if (!read) {
        return unavailable('historical-as-of-unavailable', 'no stored historical read path is wired for the macro series in this build.')
      }
      if (read.state === 'unavailable') {
        return unavailable(MACRO_GAP_CODES[read.gapCode] ?? 'query-unavailable', read.detail)
      }
      // The projection's own provenance, so a synthetic dollar can never inherit the licensed method.
      return { state: 'available', value: read.value, observedAt: read.observedAt, method: read.method, sourceUrl: read.sourceUrl }
    }
  }
}

/**
 * The ETF provider's own history, asked only when the store answered `empty` or held no row.
 *
 * The reader validates the instant and the result; this function only turns its answer into this
 * tool's vocabulary, so a public series can never inherit a stored snapshot's method or a store's
 * `not-visible-as-of` wording.
 */
async function readEtfHistory(asset: EtfHistoryAsset, asOf: string, deps: DailyBriefBackfillDeps): Promise<ReadResult> {
  const read = deps.etfHistory
  if (!read) {
    return unavailable('historical-api-unavailable', 'no public ETF flow history interface is wired in this build; the gap stays.')
  }
  const result = await read({ asset, asOf })
  if (result.state === 'unavailable') return unavailable(HISTORICAL_API_GAP_CODES[result.gapCode] ?? 'query-unavailable', result.detail)
  return { state: 'available', value: result.value, observedAt: result.observedAt, method: result.method, sourceUrl: result.sourceUrl }
}

/**
 * The two DefiLlama per-asset histories, asked only when the store answered `empty`.
 *
 * The reader owns the both-assets rule and the instant validation; this function only turns its
 * answer into this tool's vocabulary. An unavailable reader is the same named gap as a missing
 * asset, so a half-core or aggregate substitute can never be assembled here.
 */
async function readStablecoinHistory(asOf: string, deps: DailyBriefBackfillDeps): Promise<ReadResult> {
  const read = deps.stablecoinHistory
  if (!read) {
    return unavailable(
      'historical-api-unavailable',
      'no per-asset DefiLlama supply history interface is wired in this build; the core stablecoin gap stays.'
    )
  }
  const result = await read({ asOf })
  if (result.state === 'unavailable') return unavailable(HISTORICAL_API_GAP_CODES[result.gapCode] ?? 'query-unavailable', result.detail)
  return { state: 'available', value: result.value, observedAt: result.observedAt, method: result.method, sourceUrl: result.sourceUrl }
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
