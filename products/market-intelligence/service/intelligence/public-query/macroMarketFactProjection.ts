import {
  MARKET_ANALYSIS_CONTEXT_CAVEATS,
  type AgentFact
} from '../../../contracts/marketAnalysisContracts'
import {
  macroMarketSnapshotPublicPolicy,
  type MacroMarketSnapshotReading
} from '../../../contracts/macro/macroMarketSnapshotContracts'
import { goldLivePolicy } from '../macro-market/goldLivePolicy'
import { macroMarketPolicy } from '../macro-market/macroMarketPolicy'
import type { MacroMarketSnapshot } from '../macro-market/macroMarketSnapshotQuery'
import type { MacroMarketWindow } from '../macro-market/macroMarketReturns'
import {
  mergeDomainObservation,
  observation,
  type MarketAnalysisDomainObservation
} from './domainObservationMerge'
import { fact } from './marketAnalysisContextProjection'

export const MACRO_MARKET_FACT_METRICS = Object.freeze({
  dollarIndexLevel: 'dollar-index-level',
  /** The dollar's change over the snapshot's own window, in percent. */
  dollarIndexReturn: (window: MacroMarketWindow) => `dollar-index-return-${window}`,
  goldPrice: 'gold-price-usd-oz'
} as const)

/**
 * The caveat that must ride with every macro-market fact.
 *
 * Twelve Data answers with a provider time series whose bars close at the provider's cadence, and the
 * product's own 15-minute synthesis of the dollar is a further step away from the licensed index.
 * Both labels travel as source caveats in the admission matrix, and this projection repeats them in
 * the context's caveat set so a model reading the fact list still sees them.
 */
export const MACRO_MARKET_READ_CAVEAT = 'provider-time-series'

type Projection = Readonly<{
  asOf: string
  facts: AgentFact[]
  caveats: Set<string>
  observations: Partial<Record<'macro', MarketAnalysisDomainObservation>>
}>

/**
 * Projects the collected macro snapshot (the dollar row and gold) into analysis facts.
 *
 * The snapshot is the *same* answer the dashboard's 市场状态 block reads: the dollar row resolved to
 * the licensed `dxy-real` when it is fresh and to the labelled `dxy-synthetic` otherwise, and gold's
 * stored `xau-usd` level. Nothing is derived here beyond the window returns the snapshot itself
 * carries, and nothing is stated as current that the analysis clock has not reached.
 *
 * The dollar's own freshness bound is applied a second time, deliberately: `createMacroMarketSnapshotQuery`
 * already falls back to the synthesis when the real feed stops, but a projection that trusted a
 * reading nobody refreshed would print yesterday's level with today's `asOf`. A real reading older
 * than `dollarIndexFreshnessMs` is dropped rather than restated as current, and the domain is marked
 * `stale` — "宁可缺，不编造" for an expired source.
 */
export function projectMacroMarket(
  snapshot: MacroMarketSnapshot | undefined,
  asOf: string,
  facts: AgentFact[],
  caveats: Set<string>,
  observations: Partial<Record<'macro', MarketAnalysisDomainObservation>>
): void {
  const projection: Projection = { asOf, facts, caveats, observations }
  const view = readableView(snapshot, asOf)
  if (!view) {
    observations.macro = mergeDomainObservation(observations.macro,
      observation('unavailable', 'unavailable', 0, 0, [MARKET_ANALYSIS_CONTEXT_CAVEATS.queryUnavailable]))
    return
  }
  if (view.readings.length === 0) {
    observations.macro = mergeDomainObservation(observations.macro,
      observation('empty', 'missing', 0, 0, [MARKET_ANALYSIS_CONTEXT_CAVEATS.queryEmpty]))
    caveats.add(MARKET_ANALYSIS_CONTEXT_CAVEATS.queryEmpty)
    return
  }

  const asOfMs = Date.parse(asOf)
  const dollar = resolveDollar(view.readings, asOfMs)
  const gold = view.readings.find(reading => reading.seriesId === macroMarketSnapshotPublicPolicy.series.gold)
  if (dollar.state === 'stale') caveats.add(MARKET_ANALYSIS_CONTEXT_CAVEATS.queryStale)
  if (dollar.reading) projectDollar(dollar.reading, dollar.synthetic, projection)
  if (gold) projectGold(gold, asOfMs, projection)
  if (dollar.reading || gold) caveats.add(MACRO_MARKET_READ_CAVEAT)

  const factCount = facts.filter(entry => entry.sourceId === macroMarketPolicy.sourceId).length
  const queryState = factCount > 0 ? 'available' as const : dollar.state === 'stale' ? 'stale' as const : 'empty' as const
  const freshness = factCount > 0 ? 'fresh' as const : dollar.state === 'stale' ? 'stale' as const : 'missing' as const
  const readCaveats = [...new Set([
    ...(factCount > 0 ? [MACRO_MARKET_READ_CAVEAT] : []),
    ...(dollar.synthetic ? [macroMarketSnapshotPublicPolicy.caveats.syntheticDollarIndex] : []),
    ...(dollar.state === 'stale' ? [MARKET_ANALYSIS_CONTEXT_CAVEATS.queryStale] : [])
  ])]
  observations.macro = mergeDomainObservation(observations.macro, observation(queryState, freshness, factCount, 0, readCaveats))
}

/** The reading the dollar row resolves to, plus whether that reading is this product's synthesis. */
function resolveDollar(
  readings: readonly MacroMarketSnapshotReading[],
  asOfMs: number
): Readonly<{ reading?: MacroMarketSnapshotReading; synthetic: boolean; state: 'available' | 'stale' | 'missing' }> {
  for (const seriesId of macroMarketSnapshotPublicPolicy.dollarIndexPreference) {
    const reading = readings.find(candidate => candidate.seriesId === seriesId)
    if (!reading) continue
    const synthetic = reading.synthetic === true
    // The synthesis has no freshness bound of its own: the snapshot only reaches for it after the
    // licensed feed stopped, so the row is a fallback rather than a stale real reading.
    if (synthetic) return { reading, synthetic, state: 'available' }
    if (dollarExpired(reading, asOfMs)) return { synthetic, state: 'stale' }
    return { reading, synthetic, state: 'available' }
  }
  return { synthetic: false, state: 'missing' }
}

/** Whether the licensed dollar reading has aged past its own bound on the analysis clock. */
function dollarExpired(reading: MacroMarketSnapshotReading, asOfMs: number): boolean {
  if (!Number.isFinite(asOfMs)) return false
  return asOfMs - reading.atMs > macroMarketSnapshotPublicPolicy.dollarIndexFreshnessMs
}

function projectDollar(reading: MacroMarketSnapshotReading, synthetic: boolean, projection: Projection): void {
  const suffix = synthetic ? 'synthetic' : 'real'
  projection.facts.push(fact(
    'macro', 'usd-index', MACRO_MARKET_FACT_METRICS.dollarIndexLevel, reading.level, 'index-point',
    macroMarketPolicy.sourceId, instant(reading.atMs), projection.asOf, 'comparable', suffix
  ))
  // The window returns the snapshot carries, and only those: a window the series could not answer is
  // absent rather than zero, exactly as the panel renders it.
  for (const window of macroMarketSnapshotPublicPolicy.windows) {
    const value = reading.returns[window]
    if (typeof value !== 'number' || !Number.isFinite(value)) continue
    projection.facts.push(fact(
      'macro', 'usd-index', MACRO_MARKET_FACT_METRICS.dollarIndexReturn(window), value, '%',
      macroMarketPolicy.sourceId, instant(reading.atMs), projection.asOf, 'comparable', suffix
    ))
  }
}

/**
 * Gold's latest price: the live tick when one is fresh, the stored level otherwise.
 *
 * Exactly one of the two is projected, so the model never reads a streamed tick and a collected bar
 * as two confirmations of one price. The tick is never used for a window return — it is not part of
 * the series those are computed from — and a tick older than the stream's own bound loses to the
 * stored bar. Both carry the tick's or the bar's own instant as `observedAt`, so the age is readable.
 */
function projectGold(reading: MacroMarketSnapshotReading, asOfMs: number, projection: Projection): void {
  const live = reading.live
  const livePrice = live === undefined ? Number.NaN : Number(live.price)
  // The price is re-checked here as well as at the wire boundary: a tick that is not a positive
  // decimal is not a price, and the row falls back to the stored bar instead of printing `0`.
  const liveUsable = live !== undefined && Number.isFinite(livePrice) && livePrice > 0 &&
    live.state === 'live' && live.atMs <= asOfMs && asOfMs - live.atMs <= goldLivePolicy.freshnessMs
  if (liveUsable && live) {
    projection.facts.push(fact(
      'macro', 'gold', MACRO_MARKET_FACT_METRICS.goldPrice, livePrice, 'USD/oz',
      macroMarketPolicy.sourceId, instant(live.atMs), projection.asOf, 'comparable', 'live'
    ))
    return
  }
  projection.facts.push(fact(
    'macro', 'gold', MACRO_MARKET_FACT_METRICS.goldPrice, reading.level, 'USD/oz',
    macroMarketPolicy.sourceId, instant(reading.atMs), projection.asOf, 'comparable', 'collected'
  ))
}

/** The snapshot as this projection may read it: its own clock is not ahead of the analysis clock. */
function readableView(
  snapshot: MacroMarketSnapshot | undefined,
  asOf: string
): Readonly<{ readings: readonly MacroMarketSnapshotReading[] }> | undefined {
  if (!snapshot || snapshot.state === 'unavailable') return undefined
  if (!Array.isArray(snapshot.readings)) return undefined
  // A snapshot collected after the analysis boundary describes a market state the analysis cannot
  // have acted on: it is refused as a whole rather than trimmed into a half-true picture.
  if (snapshot.asOf > asOf) return undefined
  return { readings: snapshot.readings }
}

function instant(atMs: number): string | null {
  return Number.isFinite(atMs) ? new Date(atMs).toISOString() : null
}
