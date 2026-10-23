import {
  MARKET_ANALYSIS_CROSS_ASSET_INSTRUMENT,
  MARKET_ANALYSIS_CROSS_ASSET_REAL_INSTRUMENT,
  MARKET_ANALYSIS_CONTEXT_CAVEATS,
  MARKET_ANALYSIS_CONTEXT_POLICY,
  MARKET_ANALYSIS_MACRO_CALENDAR_POLICY,
  isMarketAnalysisCanonicalUtc,
  type AgentFact,
  type AnalysisDomain,
  type AnalysisFreshness,
  type MarketAnalysisContextInput,
  type MarketAnalysisCrossAssetInstrument,
  type MarketAnalysisDomainAccess,
  type MarketAnalysisQueryState,
  type SourceHealthFlag
} from '../../../contracts/marketAnalysisContracts'
import type {
  AgentSafeEvidenceRef,
  CapitalConditionsSnapshotResult,
  FearGreedSnapshotResult,
  FundingRateHistoryResult,
  MarketIntelligenceQueryResult,
  SourceCoverageAsOf,
  SourceHealthData
} from './queryContracts'
import { marketCalendarPublicPolicy } from '../../../contracts/macro/marketCalendarQueryContracts'
import { analysisModelVocabulary } from '../analysis/analysisModelVocabulary'
import type { MacroEconomicCalendarMonthResult } from '../macro-calendar/macroEconomicCalendarQueryService'
import type {
  MacroCalendarProviderObservation,
  MacroCalendarProviderObservationSet
} from '../macro-calendar/marketCalendarObservationNormalization'
import type { AgentEvidenceRef } from '../../../contracts/marketAnalysisContracts'
import type { CrossAssetRange, CrossAssetSnapshot } from '../../../contracts/crossAssetObservationContracts'
import { crossAssetAnalysisWindowPolicy } from '../cross-asset/crossAssetAnalysisWindows'
import type { MarketIntelligencePublicQueryService as PublicQueryService } from './publicQueryService'
import { observation, type MarketAnalysisDomainObservation } from './domainObservationMerge'

export { observation }
export type { MarketAnalysisDomainObservation }

const CONTEXT_FACT_CONFIDENCE = 1

export function defaultObservation(domain: AnalysisDomain): MarketAnalysisDomainObservation {
  return Object.freeze({
    queryState: domain === 'cross-asset' ? 'not-comparable' : 'missing',
    freshness: 'missing',
    factCount: 0,
    evidenceCount: 0,
    caveats: ['query-not-run']
  })
}

export function isContextInput(value: unknown): value is MarketAnalysisContextInput {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype || Object.getOwnPropertySymbols(value).length > 0) return false
    const keys = Object.keys(value)
    if (!keys.every(key => ['eventGroupId', 'asOf', 'domains', 'maxFacts'].includes(key))) return false
    const candidate = value as Record<string, unknown>
    return typeof candidate.eventGroupId === 'string' && candidate.eventGroupId.length > 0 && candidate.eventGroupId.length <= 200 &&
      isMarketAnalysisCanonicalUtc(candidate.asOf) && Date.parse(candidate.asOf) <= Date.now() &&
      (candidate.domains === undefined || Array.isArray(candidate.domains)) &&
      (candidate.maxFacts === undefined || typeof candidate.maxFacts === 'number')
  } catch {
    return false
  }
}

export function normalizeContextMaxFacts(value: number | undefined): number | undefined {
  if (value === undefined) return MARKET_ANALYSIS_CONTEXT_POLICY.defaultMaxFacts
  return Number.isSafeInteger(value) && value > 0 ? Math.min(value, MARKET_ANALYSIS_CONTEXT_POLICY.defaultMaxFacts) : undefined
}

export function projectCapital(result: CapitalConditionsSnapshotResult | undefined, asOf: string, facts: AgentFact[], caveats: Set<string>, observations: Partial<Record<AnalysisDomain, MarketAnalysisDomainObservation>>): void {
  if (!result || result.state === 'unavailable') {
    observations.capital = observation('unavailable', 'unavailable', 0, 0, [MARKET_ANALYSIS_CONTEXT_CAVEATS.queryUnavailable])
    return
  }
  if (result.state === 'empty') {
    observations.capital = observation('empty', 'missing', 0, 0, [MARKET_ANALYSIS_CONTEXT_CAVEATS.queryEmpty])
    return
  }
  const rows: ReadonlyArray<readonly [string, string, number, string]> = [
    ['stablecoins', 'current-usd', result.coreStablecoins.currentUsd, 'USD'],
    ['stablecoins', 'change-1d-usd', result.coreStablecoins.change1dUsd, 'USD'],
    ['stablecoins', 'change-7d-usd', result.coreStablecoins.change7dUsd, 'USD'],
    ['stablecoins', 'change-30d-usd', result.coreStablecoins.change30dUsd, 'USD']
  ]
  for (const [subject, metric, value, unit] of rows) facts.push(fact('capital', subject, metric, value, unit, 'defillama-stablecoins', result.coreStablecoins.observedAt, asOf, 'comparable'))
  if (result.etf.state === 'available') {
    for (const asset of [result.etf.btc, result.etf.eth]) {
      for (const row of asset.rows) facts.push(fact('capital', asset.asset, 'etf-net-flow-usd', row.netFlowUsd, 'USD', result.etf.sourceId, row.observedAt, asOf, 'comparable', row.tradingDate))
    }
  }
  const caveat = result.etf.state === 'unavailable' ? 'etf-unavailable' : undefined
  if (caveat) caveats.add(caveat)
  const etfFactCount = result.etf.state === 'available' ? result.etf.btc.rows.length + result.etf.eth.rows.length : 0
  observations.capital = observation('available', 'fresh', rows.length + etfFactCount, 0, caveat ? [caveat] : [])
}

export function projectSentiment(result: FearGreedSnapshotResult | undefined, asOf: string, facts: AgentFact[], caveats: Set<string>, observations: Partial<Record<AnalysisDomain, MarketAnalysisDomainObservation>>): void {
  if (!result || result.state === 'unavailable') {
    observations.sentiment = observation('unavailable', 'unavailable', 0, 0, [MARKET_ANALYSIS_CONTEXT_CAVEATS.queryUnavailable])
    return
  }
  if (result.state === 'empty') {
    observations.sentiment = observation('empty', 'missing', 0, 0, [MARKET_ANALYSIS_CONTEXT_CAVEATS.queryEmpty])
    return
  }
  if ('score' in result && typeof result.score === 'number') {
    facts.push(fact('sentiment', 'market', 'fear-greed-index', result.score, 'score', 'alternative-fear-greed', result.observedAt, asOf, 'comparable'))
    observations.sentiment = observation('available', 'fresh', 1, 0, [])
    return
  }
  observations.sentiment = observation('missing', 'missing', 0, 0, ['sentiment-not-computed-as-of'])
  caveats.add('sentiment-not-computed-as-of')
}

export function projectFunding(result: FundingRateHistoryResult | undefined, asOf: string, facts: AgentFact[], caveats: Set<string>, observations: Partial<Record<AnalysisDomain, MarketAnalysisDomainObservation>>): void {
  if (!result || result.state === 'unavailable') {
    observations.funding = observation('unavailable', 'unavailable', 0, 0, [MARKET_ANALYSIS_CONTEXT_CAVEATS.queryUnavailable])
    return
  }
  if (result.state === 'empty') {
    observations.funding = observation('empty', 'missing', 0, 0, [MARKET_ANALYSIS_CONTEXT_CAVEATS.queryEmpty])
    return
  }
  const points = [...result.btc.map(point => ['BTC', point] as const), ...result.eth.map(point => ['ETH', point] as const)]
  for (const [index, [asset, point]] of points.entries()) facts.push(fact('funding', asset, 'funding-rate-percent', point.ratePercent, '%', 'binance-futures-positioning', point.observedAt, asOf, 'comparable', `point-${index}`))
  const state = points.length ? 'available' : 'empty'
  const freshness = points.length ? 'fresh' : 'missing'
  const pointCaveat = points.length ? [] : [MARKET_ANALYSIS_CONTEXT_CAVEATS.queryEmpty]
  observations.funding = observation(state, freshness, points.length, 0, pointCaveat)
  if (!points.length) caveats.add(MARKET_ANALYSIS_CONTEXT_CAVEATS.queryEmpty)
}

/**
 * Projects both macro calendar routes into one fact set: the official releases and the
 * normalized 0xRouter observations. A provider-only month is a usable macro route, but the
 * missing official evidence is still named as a caveat instead of being hidden.
 */
/**
 * Projects the cross-asset snapshots into price and relative-return facts.
 *
 * The analysis used to run with no price evidence at all: `cross-asset` sat in `missingDomains` on
 * every snapshot, so the conclusion could only infer a market reaction from ETF flows and funding,
 * and the verifier had no observation to check a prediction against.
 *
 * Windows come from `crossAssetAnalysisWindowPolicy`, the same policy the verifier reads, so the
 * horizon the model is shown and the horizon the verifier checks cannot drift apart. A snapshot
 * whose coverage is incomplete contributes `not-comparable` facts rather than numbers nobody can
 * compare; an absent map leaves the domain `not-comparable`, which is what the conclusion already
 * knows how to explain (`safeProject` handles a throw, `undefined` is resolved here).
 */
export function projectCrossAsset(
  snapshots: ReadonlyMap<CrossAssetRange, CrossAssetSnapshot>,
  asOf: string,
  facts: AgentFact[],
  caveats: Set<string>,
  observations: Partial<Record<AnalysisDomain, MarketAnalysisDomainObservation>>
): void {
  const sourceId = MARKET_ANALYSIS_CROSS_ASSET_INSTRUMENT.sourceId
  const usable = [...snapshots.entries()].filter(([, snapshot]) => snapshot.mode === 'historical' && snapshot.asOf <= asOf && snapshot.analysisEnd <= asOf)
  if (usable.length === 0) {
    observations['cross-asset'] = observation('not-comparable', 'missing', 0, 0, [MARKET_ANALYSIS_CONTEXT_CAVEATS.notComparable])
    caveats.add(MARKET_ANALYSIS_CONTEXT_CAVEATS.notComparable)
    return
  }
  const byRange = new Map(usable)
  const assetKey = (asset: 'BTC' | 'ETH') => asset === 'BTC' ? 'btc' : 'eth'
  for (const asset of ['BTC', 'ETH'] as const) {
    for (const window of crossAssetAnalysisWindowPolicy.priceReturns) {
      const snapshot = byRange.get(window.range)
      if (!snapshot) continue
      const value = window.kind === 'closed-return'
        ? closedReturn(snapshot, assetKey(asset))
        : curveReturn(snapshot, assetKey(asset), window.lookbackPoints)
      if (value === undefined) continue
      const comparable = completeCoverage(snapshot, assetKey(asset))
      // The window belongs to the metric name: a fact carries no free-text label, so "价格收益 +0.4%"
      // without one left the model unable to tell 15 minutes from three days — it said so.
      facts.push(fact('cross-asset', asset, `price-return-${window.horizon}`, value, '%', sourceId, snapshot.analysisEnd, asOf,
        comparable ? 'comparable' : 'not-comparable', `${window.range}-${window.horizon}`))
      if (!comparable) caveats.add(MARKET_ANALYSIS_CONTEXT_CAVEATS.notComparable)
    }
  }
  /**
   * The Nasdaq 100 row, read from the leg that answered it.
   *
   * The fact names `USTEC` when the licensed index answered and `QQQUSDT` when the tokenised proxy
   * did, and the leg's own limitation rides with it: a cash index cannot explain a move made while its
   * market was shut, and a tokenised perpetual is not the index. Both are stated, so no conclusion has
   * to guess which instrument it is reading.
   *
   * Only the published close is read, exactly as before: a gappy 24/7 curve and a session-bound curve
   * are not the same shape, and subtracting one from the other would invent a return.
   */
  for (const window of crossAssetAnalysisWindowPolicy.priceReturns) {
    if (window.kind !== 'closed-return') continue
    const snapshot = byRange.get(window.range)
    if (!snapshot) continue
    const instrument = crossAssetIndexInstrument(snapshot)
    if (!instrument) continue
    const value = closedReturn(snapshot, 'index')
    if (value === undefined) continue
    const comparable = completeCoverage(snapshot, 'index')
    facts.push(fact('cross-asset', instrument.symbol, `price-return-${window.horizon}`, value, '%', instrument.sourceId,
      snapshot.analysisEnd, asOf, comparable ? 'comparable' : 'not-comparable', `${window.range}-${window.horizon}`))
    if (!comparable) caveats.add(MARKET_ANALYSIS_CONTEXT_CAVEATS.notComparable)
    caveats.add(instrument.limitation)
  }
  const relative = crossAssetAnalysisWindowPolicy.relativeReturn
  const relativeSnapshot = byRange.get(relative.range)
  const btc = relativeSnapshot ? curveReturn(relativeSnapshot, 'btc', relative.lookbackPoints) : undefined
  const eth = relativeSnapshot ? curveReturn(relativeSnapshot, 'eth', relative.lookbackPoints) : undefined
  if (relativeSnapshot && btc !== undefined && eth !== undefined) {
    // Exactly the verifier's arithmetic: BTC's window return minus ETH's, so a prediction written
    // against this fact is checkable by the same yardstick.
    const comparable = completeCoverage(relativeSnapshot, 'btc') && completeCoverage(relativeSnapshot, 'eth')
    facts.push(fact('cross-asset', 'btc-vs-eth', `relative-return-${relative.horizon}`, btc - eth, '%', sourceId, relativeSnapshot.analysisEnd, asOf,
      comparable ? 'comparable' : 'not-comparable', `${relative.range}-${relative.horizon}`))
    if (!comparable) caveats.add(MARKET_ANALYSIS_CONTEXT_CAVEATS.notComparable)
  }
  observations['cross-asset'] = facts.some(entry => entry.domain === 'cross-asset')
    ? observation('available', 'fresh', facts.filter(entry => entry.domain === 'cross-asset').length, 0, [])
    : observation('empty', 'missing', 0, 0, [MARKET_ANALYSIS_CONTEXT_CAVEATS.queryEmpty])
  if (observations['cross-asset']?.queryState === 'empty') caveats.add(MARKET_ANALYSIS_CONTEXT_CAVEATS.queryEmpty)
}

type CrossAssetKey = 'index' | 'btc' | 'eth'

/** The instrument that answered the Nasdaq 100 row, or `undefined` when neither leg had a reading. */
function crossAssetIndexInstrument(snapshot: CrossAssetSnapshot): Readonly<{ symbol: string; sourceId: string; limitation: string }> | undefined {
  if (snapshot.indexSource === 'real') {
    return Object.freeze({
      symbol: MARKET_ANALYSIS_CROSS_ASSET_REAL_INSTRUMENT.symbol,
      sourceId: MARKET_ANALYSIS_CROSS_ASSET_REAL_INSTRUMENT.sourceId,
      limitation: MARKET_ANALYSIS_CROSS_ASSET_REAL_INSTRUMENT.limitation
    })
  }
  if (snapshot.indexSource === 'proxy') {
    return Object.freeze({
      symbol: MARKET_ANALYSIS_CROSS_ASSET_INSTRUMENT.symbol,
      sourceId: MARKET_ANALYSIS_CROSS_ASSET_INSTRUMENT.sourceId,
      limitation: MARKET_ANALYSIS_CROSS_ASSET_INSTRUMENT.limitation
    })
  }
  return undefined
}

/** The return over `lookbackPoints` bars of the snapshot's own range, or undefined when incomplete. */
function curveReturn(snapshot: CrossAssetSnapshot, asset: CrossAssetKey, lookbackPoints: number): number | undefined {
  const curve = snapshot.curves[asset]
  const end = curve?.at(-1)?.returnPercent
  const start = curve?.at(-(lookbackPoints + 1))?.returnPercent
  if (typeof end !== 'number' || typeof start !== 'number' || !Number.isFinite(end) || !Number.isFinite(start)) return undefined
  return end - start
}

function closedReturn(snapshot: CrossAssetSnapshot, asset: CrossAssetKey): number | undefined {
  const metric = snapshot.closedReturns[asset][crossAssetAnalysisWindowPolicy.closedReturnMetric]
  return metric.state === 'available' && Number.isFinite(metric.value) ? metric.value : undefined
}

/** A number nobody can compare is worse than no number: partial history is not evidence. */
function completeCoverage(snapshot: CrossAssetSnapshot, asset: CrossAssetKey): boolean {
  return snapshot.historyCoverage[asset]?.complete === true
}

export function projectMacroCalendar(
  input: Readonly<{
    official: MacroEconomicCalendarMonthResult | undefined
    provider: MacroCalendarProviderObservationSet | undefined
  }>,
  asOf: string,
  facts: AgentFact[],
  evidenceRefs: Map<string, AgentEvidenceRef>,
  caveats: Set<string>,
  observations: Partial<Record<AnalysisDomain, MarketAnalysisDomainObservation>>
): void {
  const official = input.official
  const officialEvents = official && official.state === 'available' && official.asOf === asOf ? official.events : undefined
  for (const caveat of input.provider?.caveats ?? []) caveats.add(caveat)
  if (!officialEvents) caveats.add(MARKET_ANALYSIS_CONTEXT_CAVEATS.macroCalendarUnavailable)
  const events: readonly MacroCalendarProviderObservation[] = [...(officialEvents ?? []), ...(input.provider?.observations ?? [])]
  if (events.length === 0) {
    observations.macro = officialEvents
      ? observation('empty', 'missing', 0, 0, [MARKET_ANALYSIS_CONTEXT_CAVEATS.macroCalendarEmpty])
      : observation('unavailable', 'unavailable', 0, 0, [MARKET_ANALYSIS_CONTEXT_CAVEATS.macroCalendarUnavailable])
    caveats.add(officialEvents ? MARKET_ANALYSIS_CONTEXT_CAVEATS.macroCalendarEmpty : MARKET_ANALYSIS_CONTEXT_CAVEATS.macroCalendarUnavailable)
    return
  }
  let factCount = 0
  for (const event of events) {
    if (!event.detectedAt || event.detectedAt > asOf || event.providerIds.length === 0) continue
    const sourceId = event.providerIds[0]!
    const evidenceRefId = `macro-calendar:${sourceId}:${event.eventKey}`
    if (!evidenceRefs.has(evidenceRefId)) evidenceRefs.set(evidenceRefId, {
      evidenceRefId, sourceId, sourceLabel: sourceId, itemId: event.eventKey,
      occurredAt: event.scheduledAt ?? event.publishedAt ?? event.detectedAt, publishedAt: event.publishedAt ?? null,
      detectedAt: event.detectedAt, computedAt: asOf, visibleAt: asOf,
      excerptHash: `macro-${hashSafeEvidenceIdentity({ eventKey: event.eventKey, detectedAt: event.detectedAt, actual: event.actual?.displayValue ?? null, previous: event.previous?.displayValue ?? null })}`
    })
    /**
     * What this observation is called, when its subject cannot say it.
     *
     * The 0xRouter route sets `eventFamily` to the event *kind* (`economic-indicator`), so those
     * facts read as「经济指标 · 生命周期」 — the same sentence for every release. The observation's own
     * title is the reader-facing name, and it already carries its period (「9月零售销售(月率)」). A
     * title that is a registered key (`cpi`) is not a name, so the vocabulary answers that one.
     * Nothing is invented: no title and no registered name leaves the fact unnamed, and the reader's
     * change list keeps hiding it rather than printing a kind as if it were a name.
     */
    const subjectLabel = calendarSubjectIsAKind(event.eventFamily)
      ? analysisModelVocabulary.eventName[event.titleKey] ?? blankToUndefined(event.titleKey)
      : undefined
    const add = (metric: string, value: string | number | null, unit: string | null = null): void => {
      // The event key is the identity; `publishedAt`/`detectedAt` stay as the displayed and
      // as-of-filtered observation time only.
      facts.push(fact('macro', event.eventFamily, metric, value, unit, sourceId, event.publishedAt ?? event.detectedAt, asOf, 'comparable', event.eventKey,
        { identityFromEventOnly: true, ...(subjectLabel ? { subjectLabel } : {}) }))
      facts[facts.length - 1] = { ...facts[facts.length - 1]!, evidenceRefId }
      factCount += 1
    }
    add(MARKET_ANALYSIS_MACRO_CALENDAR_POLICY.factMetrics.eventName, event.titleKey)
    add(MARKET_ANALYSIS_MACRO_CALENDAR_POLICY.factMetrics.lifecycleState, event.lifecycleState)
    add(MARKET_ANALYSIS_MACRO_CALENDAR_POLICY.factMetrics.scheduledDate, event.scheduledDate, 'date')
    if (event.scheduledAt) add(MARKET_ANALYSIS_MACRO_CALENDAR_POLICY.factMetrics.scheduledAt, event.scheduledAt, 'UTC')
    if (event.officialReleaseDate) add(MARKET_ANALYSIS_MACRO_CALENDAR_POLICY.factMetrics.officialReleaseDate, event.officialReleaseDate, 'date')
    if (event.actual) add(MARKET_ANALYSIS_MACRO_CALENDAR_POLICY.factMetrics.actual, event.actual.displayValue, event.actual.unit ?? null)
    if (event.previous) add(MARKET_ANALYSIS_MACRO_CALENDAR_POLICY.factMetrics.previous, event.previous.displayValue, event.previous.unit ?? null)
    if (event.consensus) add(MARKET_ANALYSIS_MACRO_CALENDAR_POLICY.factMetrics.consensus, event.consensus.displayValue, event.consensus.unit ?? null)
    if (event.consensusState === 'unavailable') caveats.add(MARKET_ANALYSIS_CONTEXT_CAVEATS.macroCalendarConsensusUnavailable)
    for (const eventCaveat of event.caveats) caveats.add(eventCaveat)
  }
  if (factCount === 0) {
    observations.macro = observation('empty', 'missing', 0, 0, [MARKET_ANALYSIS_CONTEXT_CAVEATS.macroCalendarEmpty])
    caveats.add(MARKET_ANALYSIS_CONTEXT_CAVEATS.macroCalendarEmpty)
    return
  }
  observations.macro = observation('available', 'fresh', factCount, factCount, [])
}

export async function safeQuery<T>(query: () => Promise<T>): Promise<T | undefined> {
  try { return await query() } catch { return undefined }
}

export async function safeSourceHealth(service: Pick<PublicQueryService, 'getSourceHealth'>, asOf: string): Promise<MarketIntelligenceQueryResult<SourceHealthData> | undefined> {
  const result = await safeQuery(() => service.getSourceHealth({ asOf }))
  return isEnvelope(result) && isSourceHealthData(result.data) ? result as MarketIntelligenceQueryResult<SourceHealthData> : undefined
}

export function fact(domain: AnalysisDomain, subject: string, metric: string, value: string | number | null, unit: string | null, sourceId: string, observedAt: string | null, asOf: string, comparability: AgentFact['comparability'], identitySuffix = '', options: Readonly<{ identityFromEventOnly?: boolean; subjectLabel?: string }> = {}): AgentFact {
  // `identityFromEventOnly` is for observations whose collection instant changes on every
  // refresh (the 0xRouter macro route): with the instant in the identity, re-collecting the
  // same values produced a whole new set of facts, so the frozen "what changed" record read
  // as "everything removed + everything added" every 30 minutes. Domains whose time component
  // distinguishes data points (funding) keep the default.
  const identity = (options.identityFromEventOnly && identitySuffix
    ? [domain, subject, metric, identitySuffix]
    : [domain, subject, metric, observedAt ?? asOf, identitySuffix]).filter(Boolean).join('-')
  return {
    factId: `mi-fact-${identity}`.replace(/[^a-zA-Z0-9-]/g, '-'), domain, subject, metric, value, unit, sourceId, sourceLabel: sourceId, observedAt, asOf,
    freshness: 'fresh', confidence: CONTEXT_FACT_CONFIDENCE, comparability, evidenceRefId: null,
    // `subjectLabel` is how a fact is *said*, never which fact it is: it is not part of `factId`, and
    // the change diff compares values (design 141 §3.4). It exists for the calendar facts whose
    // subject is only their kind — `economic-indicator` tells a reader nothing about which release.
    ...(options.subjectLabel ? { subjectLabel: options.subjectLabel } : {})
  }
}

function hashSafeEvidenceIdentity(value: unknown): string {
  let serialized = ''
  try { serialized = JSON.stringify(value) } catch { serialized = 'unavailable' }
  let hash = 2166136261
  for (let index = 0; index < serialized.length; index += 1) hash = Math.imul(hash ^ serialized.charCodeAt(index), 16777619)
  return (hash >>> 0).toString(16).padStart(8, '0')
}

export function compareObservedAt(left: AgentFact, right: AgentFact): number {
  return (right.observedAt ?? '').localeCompare(left.observedAt ?? '')
}

export function isEnvelope(value: unknown): value is MarketIntelligenceQueryResult<unknown> {
  try { return !!value && typeof value === 'object' && 'data' in value && 'evidenceRefs' in value } catch { return false }
}

export function isSourceHealthData(value: unknown): value is SourceHealthData {
  try { return !!value && typeof value === 'object' && Array.isArray((value as { sources?: unknown }).sources) } catch { return false }
}

export function toSourceHealthFlag(source: SourceCoverageAsOf, asOf: string): SourceHealthFlag {
  const status = source.productionState === 'failed' ? 'failed' : source.productionState === 'stale' ? 'degraded' : source.productionState === 'disabled' || source.productionState === 'fixture-only' || source.productionState === 'planned' ? 'paused' : source.productionState === 'fresh' ? 'healthy' : 'degraded'
  return { sourceId: source.sourceId, status, asOf }
}

export function utf8JsonBytes(value: unknown): number {
  try { return new TextEncoder().encode(JSON.stringify(value)).byteLength } catch { return Number.POSITIVE_INFINITY }
}

/** True while a calendar fact's subject is only the *kind* of calendar item it came from. */
function calendarSubjectIsAKind(family: string): boolean {
  return (marketCalendarPublicPolicy.kinds as readonly string[]).includes(family)
}

/** A title of spaces is not a name; the fact stays unnamed rather than labelled with whitespace. */
function blankToUndefined(value: string): string | undefined {
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}
