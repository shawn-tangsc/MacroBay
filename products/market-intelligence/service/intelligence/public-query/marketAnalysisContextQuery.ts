import { applyReservedFacts } from '../analysis/analysisImpactDisclosurePolicy'
import {
  MARKET_ANALYSIS_CONTEXT_CAVEATS,
  MARKET_ANALYSIS_CONTEXT_POLICY,
  MARKET_ANALYSIS_MACRO_CALENDAR_POLICY,
  MARKET_ANALYSIS_CROSS_ASSET_INSTRUMENTS,
  type MarketAnalysisCrossAssetInstrument,
  MARKET_ANALYSIS_ERROR_CODES,
  type AgentEvidenceRef,
  type AgentFact,
  type AnalysisDomain,
  type MarketAnalysisContextInput,
  type MarketAnalysisContextResult,
  type MarketAnalysisDomainAccess,
  type MarketAnalysisDomainAdmission
} from '../../../contracts/marketAnalysisContracts'
import type { CrossAssetRange, CrossAssetSnapshot } from '../../../contracts/crossAssetObservationContracts'
import { MARKET_INTELLIGENCE_QUERY_CAVEATS as marketIntelligenceQueryCaveats } from '../../../contracts/intelligenceQueryContracts'
import { macroRatesSnapshotPublicPolicy } from '../../../contracts/macro/macroRatesSnapshotContracts'
import { macroMarketSnapshotPublicPolicy } from '../../../contracts/macro/macroMarketSnapshotContracts'
import { crossAssetAnalysisRanges } from '../cross-asset/crossAssetAnalysisWindows'
import type { AgentSafeEvidenceRef } from './queryContracts'
import type { MarketIntelligencePublicQueryService as PublicQueryService } from './publicQueryService'
import { readMarketCalendarObservations } from '../macro-calendar/marketCalendarObservationNormalization'
import { projectMacroMarket } from './macroMarketFactProjection'
import { projectMacroRates } from './macroRatesFactProjection'
import {
  compareObservedAt,
  defaultObservation,
  isContextInput,
  normalizeContextMaxFacts,
  observation,
  projectCapital,
  projectCrossAsset,
  projectFunding,
  projectMacroCalendar,
  projectSentiment,
  safeQuery,
  safeSourceHealth,
  toSourceHealthFlag,
  utf8JsonBytes,
  type MarketAnalysisDomainObservation
} from './marketAnalysisContextProjection'

const HANDLER_PREFIX = 'market-intelligence.'
const MATRIX_DOMAIN_ORDER: readonly AnalysisDomain[] = ['macro', 'capital', 'sentiment', 'funding', 'cross-asset']
const CONTEXT_FACT_DOMAIN_ORDER: readonly AnalysisDomain[] = ['macro', 'cross-asset', 'capital', 'sentiment', 'funding']

type DomainDefinition = Readonly<Pick<MarketAnalysisDomainAccess, 'domain' | 'sourceIds' | 'admission' | 'publicQueryMethods' | 'ipcMethods'>>

const DOMAIN_DEFINITIONS: readonly DomainDefinition[] = Object.freeze([
  Object.freeze({
    domain: 'macro',
    // The macro domain is answered by three routes the panel also shows: the two calendars, the
    // 市场状态 block's dollar/gold snapshot, and FRED's daily rate block. They are listed together
    // because a conclusion about a macro move may read any of them, and the matrix must name all of
    // them rather than the calendar alone.
    sourceIds: Object.freeze([
      'macro-calendar-fed-schedule', 'macro-calendar-fed-statement', 'macro-calendar-fed-statement-history',
      'macro-calendar-bls-schedule', 'macro-calendar-bls-values', 'macro-calendar-bls-ics-manual',
      'macro-calendar-bea-schedule', 'macro-calendar-bea-release-rss',
      'macro-calendar-0xrouter-economic-data', 'macro-calendar-0xrouter-financial-events',
      'macro-calendar-0xrouter-central-bank-activities',
      'fred-rates-liquidity', 'twelve-data-market'
    ]),
    admission: 'connected-but-not-agent-tool',
    publicQueryMethods: Object.freeze([
      'macroEconomicCalendarQueryService.queryMonth',
      'marketCalendarPublicQueryService.queryMonth',
      'publicQueryService.queryMacroMarketSnapshot',
      'publicQueryService.queryMacroRatesSnapshot'
    ]),
    ipcMethods: Object.freeze([
      'intelligence.macro.economicCalendar.queryMonth',
      'intelligence.macro.marketCalendar.queryMonth',
      'intelligence.macro.marketSnapshot.query',
      'intelligence.macro.ratesSnapshot.query'
    ])
  }),
  Object.freeze({
    domain: 'capital', sourceIds: Object.freeze(['defillama-stablecoins', '0xrouter']),
    admission: 'connected-but-not-agent-tool',
    publicQueryMethods: Object.freeze(['publicQueryService.queryCapitalConditionsSnapshot']),
    ipcMethods: Object.freeze(['intelligence.queryCapitalConditionsSnapshot'])
  }),
  Object.freeze({
    domain: 'sentiment', sourceIds: Object.freeze(['alternative-fear-greed']),
    admission: 'connected-but-not-agent-tool',
    publicQueryMethods: Object.freeze(['publicQueryService.queryFearGreedSnapshot']),
    ipcMethods: Object.freeze(['intelligence.queryFearGreedSnapshot'])
  }),
  Object.freeze({
    domain: 'funding', sourceIds: Object.freeze(['binance-futures-positioning']),
    admission: 'connected-but-not-agent-tool',
    publicQueryMethods: Object.freeze(['publicQueryService.queryFundingRateHistory']),
    ipcMethods: Object.freeze(['intelligence.queryFundingRateHistory'])
  }),
  Object.freeze({
    // Two admitted sources answer this domain: the licensed Nasdaq 100 index (preferred) and the
    // Binance proxy that fills the same row when the licensed source has nothing.
    domain: 'cross-asset', sourceIds: Object.freeze(['realmarketapi-market', 'binance-futures-positioning']),
    admission: 'connected-but-not-agent-tool',
    publicQueryMethods: Object.freeze(['publicQueryService.queryCrossAssetSnapshot']),
    ipcMethods: Object.freeze(['intelligence.crossAsset.query'])
  })
])

export type MarketAnalysisDomainAccessMatrix = Readonly<{
  asOf: string
  domains: readonly MarketAnalysisDomainAccess[]
  blockedSources: readonly MarketAnalysisSourceAccess[]
  instrumentIdentities: readonly MarketAnalysisCrossAssetInstrument[]
}>

export type MarketAnalysisSourceAccess = Readonly<{
  sourceId: string
  admission: MarketAnalysisDomainAdmission
  publicQueryMethods: readonly string[]
  ipcMethods: readonly string[]
  agentToolAvailable: boolean
  autoTriggerAllowed: boolean
  caveats: readonly string[]
  /** The context domains this source feeds. One registry entry per source, not one per domain. */
  domains: readonly AnalysisDomain[]
}>

type MarketAnalysisContextQueryService = Pick<PublicQueryService, 'queryFearGreedSnapshot' | 'queryFundingRateHistory' | 'queryCapitalConditionsSnapshot' | 'queryCrossAssetSnapshot' | 'getSourceHealth'> &
  Partial<Pick<PublicQueryService,
    'queryMacroEconomicCalendarMonth' | 'queryMarketCalendarMonth' | 'queryMacroMarketSnapshot' | 'queryMacroRatesSnapshot'>>

const SOURCE_ACCESS_REGISTRY: readonly MarketAnalysisSourceAccess[] = Object.freeze([
  source('macro-calendar-fed-schedule', ['macro'], 'production-ready', ['macroEconomicCalendarQueryService.queryMonth'], ['intelligence.macro.economicCalendar.queryMonth'], true),
  source('macro-calendar-fed-statement', ['macro'], 'production-ready', ['macroEconomicCalendarQueryService.queryMonth'], ['intelligence.macro.economicCalendar.queryMonth'], true),
  source('macro-calendar-fed-statement-history', ['macro'], 'production-ready', ['macroEconomicCalendarQueryService.queryMonth'], ['intelligence.macro.economicCalendar.queryMonth'], true),
  source('macro-calendar-bls-schedule', ['macro'], 'connected-but-not-agent-tool', ['macroEconomicCalendarQueryService.queryMonth'], ['intelligence.macro.economicCalendar.queryMonth']),
  source('macro-calendar-bls-values', ['macro'], 'connected-but-not-agent-tool', ['macroEconomicCalendarQueryService.queryMonth'], ['intelligence.macro.economicCalendar.queryMonth']),
  source('macro-calendar-bls-ics-manual', ['macro'], 'connected-but-not-agent-tool', ['macroEconomicCalendarQueryService.queryMonth'], ['intelligence.macro.economicCalendar.queryMonth']),
  source('macro-calendar-bea-schedule', ['macro'], 'production-ready', ['macroEconomicCalendarQueryService.queryMonth'], ['intelligence.macro.economicCalendar.queryMonth'], true),
  source('macro-calendar-bea-release-rss', ['macro'], 'production-ready', ['macroEconomicCalendarQueryService.queryMonth'], ['intelligence.macro.economicCalendar.queryMonth'], true),
  source('alternative-fear-greed', ['sentiment'], 'connected-but-not-agent-tool', ['publicQueryService.queryFearGreedSnapshot'], ['intelligence.queryFearGreedSnapshot']),
  source('binance-futures-positioning', ['funding', 'cross-asset'], 'connected-but-not-agent-tool', ['publicQueryService.queryFundingRateHistory'], ['intelligence.queryFundingRateHistory', 'intelligence.crossAsset.query']),
  source('defillama-stablecoins', ['capital'], 'connected-but-not-agent-tool', ['publicQueryService.queryCapitalConditionsSnapshot'], ['intelligence.queryCapitalConditionsSnapshot']),
  source('0xrouter', ['capital'], 'connected-but-not-agent-tool', ['publicQueryService.queryCapitalConditionsSnapshot'], ['intelligence.queryCapitalConditionsSnapshot']),
  // Full admission, decided by the product owner: the 0xRouter calendar is live and equal
  // to the official calendar for trigger purposes. Its observations are still aggregator
  // observations, so the observed-unverified caveat stays on every one of these sources.
  source('macro-calendar-0xrouter-economic-data', ['macro'], 'production-ready', ['marketCalendarPublicQueryService.queryMonth'], ['intelligence.macro.marketCalendar.queryMonth'], true, ['observed-unverified']),
  source('macro-calendar-0xrouter-financial-events', ['macro'], 'production-ready', ['marketCalendarPublicQueryService.queryMonth'], ['intelligence.macro.marketCalendar.queryMonth'], true, ['observed-unverified']),
  source('macro-calendar-0xrouter-central-bank-activities', ['macro'], 'production-ready', ['marketCalendarPublicQueryService.queryMonth'], ['intelligence.macro.marketCalendar.queryMonth'], true, ['observed-unverified']),
  source('bea-economic-series', ['macro'], 'planned', [], [], false, ['planned-source-unavailable']),
  // FRED is collected and read (the dashboard's 美债 10Y and 实际利率 rows) *and* now callable by the
  // analysis agent through its own read-only tool. Its only granularity is the official trading-day
  // close, and that caveat rides with the source so no conclusion reads a daily series as an
  // explanation of an intraday move. `autoTriggerAllowed` stays false: a daily close is not a trigger.
  source('fred-rates-liquidity', ['macro'], 'connected-but-not-agent-tool', ['macroRatesSnapshotQuery.snapshot'],
    [macroRatesSnapshotPublicPolicy.method], false, [marketIntelligenceQueryCaveats.officialDailyClose], true),
  // The dollar and gold are read from the admitted macro-market source, and the analysis reads the
  // very same snapshot through `get_macro_market_snapshot`. The dollar is *synthesised* from the ICE
  // basket whenever the licensed feed has nothing, so the caveat travels with the source rather than
  // being rediscovered by whoever reads the facts.
  source('twelve-data-market', ['macro'], 'production-ready', ['macroMarketSnapshotQuery.snapshot'],
    ['intelligence.macro.marketSnapshot.query'], false,
    [macroMarketSnapshotPublicPolicy.caveats.syntheticDollarIndex, macroMarketSnapshotPublicPolicy.caveats.providerTimeSeries], true),
  // The zero-credential feeds lit this round: both OKX announcement lists, the go-ethereum release
  // feed and CoinGecko's global market snapshot. They feed the event pipeline an analysis can be
  // triggered by, not one of the five context domains — the `domains` list is empty rather than
  // stretched, because none of them answers a domain query yet, and no analysis surface reads them.
  // `autoTriggerAllowed` stays false for all four (an announcement list is not permission to start a
  // run), and the caveat names what each reading is: a venue's own feed on the venue's own publish
  // time, a project's release feed on GitHub's publish time, and an aggregator's snapshot.
  source('okx-latest-announcements', [], 'connected-but-not-agent-tool', [], [], false,
    ['venue-announcement-feed', 'venue-published-time']),
  source('okx-api-announcements', [], 'connected-but-not-agent-tool', [], [], false,
    ['venue-announcement-feed', 'venue-published-time']),
  source('github-releases', [], 'connected-but-not-agent-tool', [], [], false,
    ['project-release-feed', 'project-published-time']),
  source('coingecko-market', [], 'connected-but-not-agent-tool', [], [], false,
    [marketIntelligenceQueryCaveats.lowConfidenceAggregation])
])

export function buildMarketAnalysisDomainAccessMatrix(input: Readonly<{
  asOf: string
  observations?: Partial<Record<AnalysisDomain, MarketAnalysisDomainObservation>>
}>): MarketAnalysisDomainAccessMatrix {
  const observations = input.observations ?? {}
  const domains = MATRIX_DOMAIN_ORDER.map((domain) => {
    const definition = DOMAIN_DEFINITIONS.find((candidate) => candidate.domain === domain)!
    const observation = observations[domain] ?? defaultObservation(domain)
    // Derived from the source registry rather than restated by hand: a domain is agent-callable
    // exactly when one of its sources has been promoted to a read-only tool, so the per-domain flag
    // and the per-source decisions cannot drift apart. `autoTriggerAllowed` stays false for every
    // domain: being able to *ask* for a value is not permission to *start* an analysis from it.
    const sources = SOURCE_ACCESS_REGISTRY.filter((source) => source.domains.includes(domain))
    return Object.freeze({
      ...definition,
      queryState: observation.queryState,
      agentToolAvailable: sources.some((source) => source.agentToolAvailable),
      // Deliberately still false while `agentToolAvailable` is derived: being able to *ask* for a
      // value is not permission to *start* an analysis from one. Trigger permission remains a
      // per-source product decision (`autoTriggerAllowed` on the registry), and a domain may not
      // start a run on its own until that decision is made for it.
      autoTriggerAllowed: false,
      asOf: input.asOf,
      freshness: observation.freshness,
      factCount: observation.factCount,
      evidenceCount: observation.evidenceCount,
      caveats: Object.freeze([...observation.caveats])
    })
  })

  return Object.freeze({
    asOf: input.asOf,
    domains: Object.freeze(domains),
    blockedSources: SOURCE_ACCESS_REGISTRY.filter((source) => source.admission === 'blocked'),
    instrumentIdentities: MARKET_ANALYSIS_CROSS_ASSET_INSTRUMENTS
  })
}

export async function buildMarketAnalysisContext(
  input: MarketAnalysisContextInput,
  publicQueryService: MarketAnalysisContextQueryService,
  /**
   * Internal, never IPC-facing: the gate's already-fetched route and the events whose change
   * triggered this run. Deliberately not part of `MarketAnalysisContextInput`, which
   * `isContextInput` validates for external callers — extending that would let a caller inject
   * route data across the trust boundary.
   */
  internal: Readonly<{ triggeredEventKeys?: ReadonlySet<string> }> = {}
): Promise<MarketAnalysisContextResult> {
  let requestedDomains: readonly AnalysisDomain[]
  try {
    if (!isContextInput(input)) return { state: 'unavailable', errorCode: MARKET_ANALYSIS_ERROR_CODES.asOfInvalid }
    requestedDomains = input.domains ? [...input.domains] : CONTEXT_FACT_DOMAIN_ORDER
    if (!Array.isArray(requestedDomains) || requestedDomains.some((domain) => !MATRIX_DOMAIN_ORDER.includes(domain)) || new Set(requestedDomains).size !== requestedDomains.length) {
      return { state: 'unavailable', errorCode: MARKET_ANALYSIS_ERROR_CODES.contextDomainNotAllowed }
    }
  } catch {
    return { state: 'unavailable', errorCode: MARKET_ANALYSIS_ERROR_CODES.asOfInvalid }
  }
  const maxFacts = normalizeContextMaxFacts(input.maxFacts)
  if (maxFacts === undefined) return { state: 'unavailable', errorCode: MARKET_ANALYSIS_ERROR_CODES.contextMaxFactsInvalid }
  const facts: AgentFact[] = []
  const evidenceRefs = new Map<string, AgentEvidenceRef>()
  const observations: Partial<Record<AnalysisDomain, MarketAnalysisDomainObservation>> = {}
  const caveats = new Set<string>()

  const addEvidence = (refs: readonly AgentSafeEvidenceRef[] | undefined): void => {
    for (const ref of refs ?? []) {
      if (evidenceRefs.has(ref.evidenceRefId)) continue
      evidenceRefs.set(ref.evidenceRefId, {
        evidenceRefId: ref.evidenceRefId,
        sourceId: ref.sourceId,
        sourceLabel: ref.sourceId,
        itemId: ref.itemId ?? null,
        occurredAt: ref.occurredAt ?? null,
        publishedAt: ref.publishedAt ?? null,
        detectedAt: ref.detectedAt ?? null,
        computedAt: ref.computedAt ?? null,
        visibleAt: ref.visibleAt,
        excerptHash: ref.excerptHash ?? ''
      })
    }
  }

  if (requestedDomains.includes('macro')) {
    const officialQuery = publicQueryService.queryMacroEconomicCalendarMonth
    const marketQuery = publicQueryService.queryMarketCalendarMonth
    if (!officialQuery && !marketQuery) {
      observations.macro = observation('missing', 'missing', 0, 0, [MARKET_ANALYSIS_CONTEXT_CAVEATS.macroCalendarQueryNotWired])
      caveats.add(MARKET_ANALYSIS_CONTEXT_CAVEATS.macroCalendarQueryNotWired)
    } else {
      const month = input.asOf.slice(0, 7)
      const official = officialQuery
        ? await safeQuery(() => officialQuery({ month, asOf: input.asOf, maxEvents: MARKET_ANALYSIS_MACRO_CALENDAR_POLICY.maxEvents }))
        : undefined
      safeProject(() => projectMacroCalendar({
        official,
        provider: marketQuery ? readMarketCalendarObservations(marketQuery, { month, asOf: input.asOf }) : undefined
      }, input.asOf, facts, evidenceRefs, caveats, observations), observations, 'macro')
    }
    // The macro domain has three producers and the panel shows all three: the calendar rows, the
    // 市场状态 block's dollar and gold readings, and FRED's daily rates. Each projection merges into
    // the domain rather than replacing it, so a working rates read survives an empty calendar and a
    // gap one producer reports stays named in the caveats.
    const macroMarket = publicQueryService.queryMacroMarketSnapshot
    safeProject(() => projectMacroMarket(macroMarket ? macroMarket() : undefined, input.asOf, facts, caveats, observations), observations, 'macro')
    const macroRates = publicQueryService.queryMacroRatesSnapshot
    safeProject(() => projectMacroRates(macroRates ? macroRates() : undefined, input.asOf, facts, caveats, observations), observations, 'macro')
  } else observations.macro = observation('missing', 'missing', 0, 0, ['domain-not-requested'])

  if (requestedDomains.includes('capital')) {
    const result = await safeQuery(() => publicQueryService.queryCapitalConditionsSnapshot({ asOf: input.asOf }))
    safeProject(() => projectCapital(result, input.asOf, facts, caveats, observations), observations, 'capital')
  } else observations.capital = observation('missing', 'missing', 0, 0, ['domain-not-requested'])

  if (requestedDomains.includes('sentiment')) {
    const result = await safeQuery(() => publicQueryService.queryFearGreedSnapshot({ asOf: input.asOf }))
    safeProject(() => projectSentiment(result, input.asOf, facts, caveats, observations), observations, 'sentiment')
  } else observations.sentiment = observation('missing', 'missing', 0, 0, ['domain-not-requested'])

  if (requestedDomains.includes('funding')) {
    const result = await safeQuery(() => publicQueryService.queryFundingRateHistory({ asOf: input.asOf }))
    safeProject(() => projectFunding(result, input.asOf, facts, caveats, observations), observations, 'funding')
  } else observations.funding = observation('missing', 'missing', 0, 0, ['domain-not-requested'])

  if (requestedDomains.includes('cross-asset')) {
    // One snapshot per range: a single range cannot carry 15m/2h/24h/3d (the 24h close is published
    // as a metric and the 7d curve is hourly). `projectCrossAsset` turns an empty map into
    // `not-comparable`, and `safeProject` keeps a throwing read from failing the whole analysis.
    const snapshots = new Map<CrossAssetRange, CrossAssetSnapshot>()
    for (const range of crossAssetAnalysisRanges) {
      const snapshot = await safeQuery(() => publicQueryService.queryCrossAssetSnapshot({ range, asOf: input.asOf }))
      if (snapshot) snapshots.set(range, snapshot)
    }
    safeProject(() => projectCrossAsset(snapshots, input.asOf, facts, caveats, observations), observations, 'cross-asset')
  } else observations['cross-asset'] = observation('not-comparable', 'missing', 0, 0, ['domain-not-requested'])

  attachQueryEvidence(facts, evidenceRefs, input.asOf)
  for (const domain of MATRIX_DOMAIN_ORDER) {
    const current = observations[domain]
    if (!current) continue
    const evidenceCount = facts.filter((fact) => fact.domain === domain && fact.evidenceRefId !== null).length
    observations[domain] = observation(current.queryState, current.freshness, current.factCount, evidenceCount, current.caveats)
  }

  const sourceHealth = await safeSourceHealth(publicQueryService, input.asOf)
  if (sourceHealth) {
    addEvidence(sourceHealth.evidenceRefs)
  } else {
    caveats.add(MARKET_ANALYSIS_CONTEXT_CAVEATS.sourceHealthUnavailable)
  }

  const matrix = buildMarketAnalysisDomainAccessMatrix({ asOf: input.asOf, observations })
  const missingDomains = matrix.domains.filter((domain) => domain.queryState !== 'available').map((domain) => domain.domain)
  for (const domain of matrix.domains) for (const caveat of domain.caveats) if (caveat !== 'query-not-run' && caveat !== 'domain-not-requested') caveats.add(caveat)

  const sortedFacts = facts
    .sort((left, right) => CONTEXT_FACT_DOMAIN_ORDER.indexOf(left.domain) - CONTEXT_FACT_DOMAIN_ORDER.indexOf(right.domain) || compareObservedAt(left, right) || left.factId.localeCompare(right.factId))
  // Cap the macro share before the global budget, so one provider's routine rows can never
  // evict the other domains: the model needs capital, sentiment and funding to explain a move.
  const macroFacts = sortedFacts.filter(fact => fact.domain === 'macro')
  if (macroFacts.length > MARKET_ANALYSIS_CONTEXT_POLICY.maximumMacroFacts) {
    const keptMacro = new Set(macroFacts.slice(0, MARKET_ANALYSIS_CONTEXT_POLICY.maximumMacroFacts).map(fact => fact.factId))
    for (let index = sortedFacts.length - 1; index >= 0; index -= 1) {
      if (sortedFacts[index]!.domain === 'macro' && !keptMacro.has(sortedFacts[index]!.factId)) sortedFacts.splice(index, 1)
    }
    caveats.add(MARKET_ANALYSIS_CONTEXT_CAVEATS.maxItemsTruncated)
  }
  // The reserve reorders inside the budget so the facts explaining a triggered change survive
  // truncation; with no triggers this is exactly `sortedFacts.slice(0, maxFacts)`.
  const keptFacts = applyReservedFacts(sortedFacts, internal.triggeredEventKeys ?? new Set(), maxFacts,
    undefined, MARKET_ANALYSIS_CONTEXT_POLICY.minimumFactsPerDomain)
  if (keptFacts.length < sortedFacts.length) caveats.add(MARKET_ANALYSIS_CONTEXT_CAVEATS.maxItemsTruncated)

  const output: MarketAnalysisContextAvailable = {
    state: 'available',
    schemaVersion: MARKET_ANALYSIS_CONTEXT_POLICY.schemaVersion,
    profileId: 'crypto-market-analysis-v1',
    eventGroupId: input.eventGroupId,
    asOf: input.asOf,
    dataCutoff: input.asOf,
    snapshotId: null,
    snapshotHash: null,
    facts: Object.freeze(keptFacts),
    missingDomains: Object.freeze(missingDomains),
    caveats: Object.freeze([...caveats]),
    evidenceRefs: Object.freeze([...evidenceRefs.values()]),
    sourceHealth: Object.freeze(sourceHealth?.data.sources.map(source => toSourceHealthFlag(source, input.asOf)) ?? []),
    domainAccess: matrix.domains
  }
  if (utf8JsonBytes(output) > MARKET_ANALYSIS_CONTEXT_POLICY.maximumOutputBytes) {
    return { state: 'unavailable', errorCode: MARKET_ANALYSIS_ERROR_CODES.contextTooLarge }
  }
  return output
}

function safeProject(project: () => void, observations: Partial<Record<AnalysisDomain, MarketAnalysisDomainObservation>>, domain: AnalysisDomain): void {
  try {
    project()
  } catch {
    observations[domain] = observation('unavailable', 'unavailable', 0, 0, [MARKET_ANALYSIS_CONTEXT_CAVEATS.queryUnavailable])
  }
}

export function formatMarketAnalysisContextAcceptanceMarker(details: Readonly<{
  domains: number
  facts: number
  missing: number
  bytes: number
  containsSourceUrl: boolean
}>): string {
  return JSON.stringify({
    marker: 'MI_ANALYSIS_ACCEPTANCE', package: 'MI-A03', event: 'context-tool', status: 'pass',
    details: { domains: ['macro', 'capital', 'sentiment', 'funding', 'cross-asset'], facts: details.facts, missing: details.missing, bytes: details.bytes, containsSourceUrl: details.containsSourceUrl }
  })
}

export function listMarketAnalysisSourceAccess(): readonly MarketAnalysisSourceAccess[] {
  return SOURCE_ACCESS_REGISTRY
}

export function formatMarketAnalysisDataAccessHarness(input: MarketAnalysisDomainAccessMatrix): string {
  return JSON.stringify({
    asOf: input.asOf,
    domains: input.domains.map((domain) => ({
      domain: domain.domain,
      sourceIds: domain.sourceIds,
      admission: domain.admission,
      queryState: domain.queryState,
      agentToolAvailable: domain.agentToolAvailable,
      autoTriggerAllowed: domain.autoTriggerAllowed,
      freshness: domain.freshness,
      factCount: domain.factCount,
      evidenceCount: domain.evidenceCount,
      caveats: domain.caveats
    })),
    sources: listMarketAnalysisSourceAccess()
  })
}

export function compareMarketAnalysisAgentToolRegistration(
  manifestToolNames: readonly string[],
  handlerIds: readonly string[]
): Readonly<{ registeredToolCount: number; mismatchCount: number }> {
  const handlerToolNames = handlerIds
    .filter((handlerId) => handlerId.startsWith(HANDLER_PREFIX))
    .map((handlerId) => handlerId.slice(HANDLER_PREFIX.length).replace(/-/g, '_'))
  const expected = new Set(manifestToolNames)
  const actual = new Set(handlerToolNames)
  const mismatchCount = new Set([...expected, ...actual]).size - [...expected].filter((toolName) => actual.has(toolName)).length
  return Object.freeze({ registeredToolCount: actual.size, mismatchCount })
}

export function resolveMacroActual(input: Readonly<{
  official: Readonly<{ value: string; observedAt: string }> | null
  provider: Readonly<{ value: string; observedAt: string }> | null
}>): Readonly<{ value: string | null; source: 'official' | 'observed-unverified' | null }> {
  if (input.official) return Object.freeze({ value: input.official.value, source: 'official' as const })
  if (input.provider) return Object.freeze({ value: input.provider.value, source: 'observed-unverified' as const })
  return Object.freeze({ value: null, source: null })
}

type MarketAnalysisContextAvailable = Extract<MarketAnalysisContextResult, { state: 'available' }>

function source(
  sourceId: string,
  domains: readonly AnalysisDomain[],
  admission: MarketAnalysisDomainAdmission,
  publicQueryMethods: readonly string[],
  ipcMethods: readonly string[],
  autoTriggerAllowed = false,
  caveats: readonly string[] = [],
  agentToolAvailable = false
): MarketAnalysisSourceAccess {
  return Object.freeze({
    sourceId,
    domains: Object.freeze([...domains]),
    admission,
    publicQueryMethods: Object.freeze([...publicQueryMethods]),
    ipcMethods: Object.freeze([...ipcMethods]),
    agentToolAvailable,
    autoTriggerAllowed,
    caveats: Object.freeze([...caveats])
  })
}

function attachQueryEvidence(facts: AgentFact[], evidenceRefs: Map<string, AgentEvidenceRef>, asOf: string): void {
  for (let index = 0; index < facts.length; index += 1) {
    const fact = facts[index]
    if (!fact || fact.evidenceRefId) continue
    const evidenceRefId = `query:${fact.sourceId}:${fact.domain}:${fact.subject}:${fact.metric}:${fact.observedAt ?? asOf}:${index}`
    const excerptHash = `query-${hashSafeEvidenceIdentity({ sourceId: fact.sourceId, subject: fact.subject, metric: fact.metric, observedAt: fact.observedAt, value: fact.value })}`
    facts[index] = { ...fact, evidenceRefId }
    if (!evidenceRefs.has(evidenceRefId)) evidenceRefs.set(evidenceRefId, {
      evidenceRefId,
      sourceId: fact.sourceId,
      sourceLabel: fact.sourceLabel,
      itemId: null,
      occurredAt: fact.observedAt,
      publishedAt: fact.observedAt,
      detectedAt: fact.observedAt,
      computedAt: asOf,
      visibleAt: asOf,
      excerptHash
    })
  }
}

function hashSafeEvidenceIdentity(value: unknown): string {
  let serialized = ''
  try { serialized = JSON.stringify(value) } catch { serialized = 'unavailable' }
  let hash = 2166136261
  for (let index = 0; index < serialized.length; index += 1) hash = Math.imul(hash ^ serialized.charCodeAt(index), 16777619)
  return (hash >>> 0).toString(16).padStart(8, '0')
}
