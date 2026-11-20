import { applyReservedFacts } from '../analysis/analysisImpactDisclosurePolicy'
import { MARKET_ANALYSIS_CONTEXT_FACT_BUDGET } from '../analysis/analysisContextPolicy'
import { MARKET_ANALYSIS_RUN_SOURCE_BUDGET } from '../analysis/analysisRunPolicy'
import {
  MARKET_ANALYSIS_CONTEXT_CAVEATS,
  MARKET_ANALYSIS_CONTEXT_SCHEMA_VERSION,
  MARKET_ANALYSIS_CONTRACT_POLICY,
  MARKET_ANALYSIS_POLICY_PATH_SOURCE_ID,
  MARKET_ANALYSIS_ERROR_CODES,
  type AgentEvidenceRef,
  type AgentFact,
  type AnalysisDomain,
  type MarketAnalysisContextInput,
  type MarketAnalysisContextResult
} from '../../../contracts/marketAnalysisContracts'
import type { CrossAssetRange, CrossAssetSnapshot } from '../../../contracts/crossAssetObservationContracts'
import { crossAssetAnalysisRanges } from '../cross-asset/crossAssetAnalysisWindows'
import type { AgentSafeEvidenceRef } from './queryContracts'
import type { MarketIntelligencePublicQueryService as PublicQueryService } from './publicQueryService'
import { readAnalysisCalendarMonth } from './marketAnalysisCalendarReader'
import { marketCalendarObservationPolicy } from '../macro-calendar/marketCalendarObservationNormalization'
import { projectMacroMarket } from './macroMarketFactProjection'
import { projectMacroRates } from './macroRatesFactProjection'
import { applyMacroFactCap } from './macroFactBudget'
import { projectPolicyPath } from './policyPathFactProjection'
import {
  MATRIX_DOMAIN_ORDER,
  buildMarketAnalysisDomainAccessMatrix
} from './marketAnalysisSourceAccess'
import {
  isContextInput,
  normalizeContextMaxFacts,
  observation,
  projectCapital,
  projectCrossAsset,
  projectFunding,
  projectMacroCalendar,
  projectSentiment,
  type MarketAnalysisDomainObservation
} from './marketAnalysisContextProjection'

export {
  buildMarketAnalysisDomainAccessMatrix,
  compareMarketAnalysisAgentToolRegistration,
  formatMarketAnalysisDataAccessHarness,
  listMarketAnalysisSourceAccess
} from './marketAnalysisSourceAccess'
export type { MarketAnalysisDomainAccessMatrix, MarketAnalysisSourceAccess } from './marketAnalysisSourceAccess'
import {
  compareObservedAt,
  hashSafeEvidenceIdentity,
  safeQuery,
  safeSourceHealth,
  toSourceHealthFlag,
  utf8JsonBytes
} from './marketAnalysisContextSupport'

const CONTEXT_FACT_DOMAIN_ORDER: readonly AnalysisDomain[] = ['macro', 'cross-asset', 'capital', 'sentiment', 'funding']

type MarketAnalysisContextQueryService = Pick<PublicQueryService, 'queryFearGreedSnapshot' | 'queryFundingRateHistory' | 'queryOpenInterestHistory' | 'queryCapitalConditionsSnapshot' | 'queryCrossAssetSnapshot' | 'getSourceHealth'> &
  // Optional so a test double or an older wiring still compiles; the projection treats an absent
  // reader exactly like an unavailable answer.
  Partial<Pick<PublicQueryService, 'queryMarketDivergence'>> &
  Partial<Pick<PublicQueryService,
    'queryMacroEconomicCalendarMonth' | 'queryMarketCalendarMonth' | 'queryMacroMarketSnapshot' | 'queryMacroRatesSnapshot' | 'queryPolicyPath'>>

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
        excerptHash: ref.excerptHash ?? '',
        ...(ref.sourceUrl ? { sourceUrl: ref.sourceUrl } : {})
      })
    }
  }

  if (requestedDomains.includes('macro')) {
    // 只读一个入口：标准表的月查询（页面里已经包含官方行）。再调官方日历查询，同一次发布
    // 会以两个来源各出现一次——那正是「同一事实两份证据」。
    const marketQuery = publicQueryService.queryMarketCalendarMonth
    if (!marketQuery) {
      observations.macro = observation('missing', 'missing', 0, 0, [MARKET_ANALYSIS_CONTEXT_CAVEATS.macroCalendarQueryNotWired])
      caveats.add(MARKET_ANALYSIS_CONTEXT_CAVEATS.macroCalendarQueryNotWired)
    } else {
      const month = input.asOf.slice(0, 7)
      const provider = readAnalysisCalendarMonth(marketQuery, { month, asOf: input.asOf })
      safeProject(() => projectMacroCalendar({ official: undefined, provider }, input.asOf, facts, evidenceRefs, caveats, observations), observations, 'macro')
      // 一页都没读成：域状态必须是不可用，不能被投影成「这个月没有事件」。
      if (provider.observations.length === 0 && provider.caveats.includes(marketCalendarObservationPolicy.caveats.pageUnavailable)) {
        observations.macro = observation('unavailable', 'unavailable', 0, 0, [MARKET_ANALYSIS_CONTEXT_CAVEATS.macroCalendarUnavailable])
        caveats.add(MARKET_ANALYSIS_CONTEXT_CAVEATS.macroCalendarUnavailable)
      }
    }
    // The macro domain has three producers and the panel shows all three: the calendar rows, the
    // 市场状态 block's dollar and gold readings, and FRED's daily rates. Each projection merges into
    // the domain rather than replacing it, so a working rates read survives an empty calendar and a
    // gap one producer reports stays named in the caveats.
    const macroMarket = publicQueryService.queryMacroMarketSnapshot
    safeProject(() => projectMacroMarket(macroMarket ? macroMarket() : undefined, input.asOf, facts, caveats, observations), observations, 'macro')
    const macroRates = publicQueryService.queryMacroRatesSnapshot
    safeProject(() => projectMacroRates(macroRates ? macroRates() : undefined, input.asOf, facts, caveats, observations), observations, 'macro')
    // The policy path is the fourth macro producer, and the only asynchronous one: it joins the
    // meeting date, the venue's odds, the target range, the latest SEP and the last vote into the
    // same context the freeze will persist. A disabled source answers `disabled` and contributes
    // nothing; an enabled but empty one contributes a named gap.
    const policyPath = publicQueryService.queryPolicyPath
    if (policyPath) {
      const policyRead = await safeQuery(() => policyPath({ asOf: input.asOf }))
      safeProject(() => projectPolicyPath(policyRead ?? { state: 'unavailable' }, input.asOf, facts, caveats, observations), observations, 'macro')
    }
  } else observations.macro = observation('missing', 'missing', 0, 0, ['domain-not-requested'])

  // Read once: both the capital and the sentiment projections consume it, and the reading is
  // as-of a single instant by construction.
  const divergence = (requestedDomains.includes('capital') || requestedDomains.includes('sentiment')) && publicQueryService.queryMarketDivergence
    ? await safeQuery(() => publicQueryService.queryMarketDivergence!({ asOf: input.asOf }))
    : undefined

  if (requestedDomains.includes('capital')) {
    const result = await safeQuery(() => publicQueryService.queryCapitalConditionsSnapshot({ asOf: input.asOf }))
    safeProject(() => projectCapital(result, divergence, input.asOf, facts, caveats, observations), observations, 'capital')
  } else observations.capital = observation('missing', 'missing', 0, 0, ['domain-not-requested'])

  if (requestedDomains.includes('sentiment')) {
    const result = await safeQuery(() => publicQueryService.queryFearGreedSnapshot({ asOf: input.asOf }))
    safeProject(() => projectSentiment(result, divergence, input.asOf, facts, caveats, observations), observations, 'sentiment')
  } else observations.sentiment = observation('missing', 'missing', 0, 0, ['domain-not-requested'])

  if (requestedDomains.includes('funding')) {
    // The two halves of the same source are read together: a funding rate without the open
    // interest behind it cannot tell deleveraging from crowding, which is the whole point.
    const [result, positioning] = await Promise.all([
      safeQuery(() => publicQueryService.queryFundingRateHistory({ asOf: input.asOf })),
      safeQuery(() => publicQueryService.queryOpenInterestHistory({ asOf: input.asOf, window: '24h' }))
    ])
    safeProject(() => projectFunding(result, positioning, input.asOf, facts, caveats, observations), observations, 'funding')
  } else observations.funding = observation('missing', 'missing', 0, 0, ['domain-not-requested'])

  if (requestedDomains.includes('cross-asset')) {
    // One snapshot per range: a single range cannot carry 15m/2h/24h/3d (the 24h close is published
    // as a metric and the 7d curve is hourly). `projectCrossAsset` turns an empty map into
    // `not-comparable`, and `safeProject` keeps a throwing read from failing the whole analysis.
    const snapshots = new Map<CrossAssetRange, CrossAssetSnapshot>()
    for (const range of crossAssetAnalysisRanges) {
      const snapshot = await safeQuery(() => publicQueryService.queryCrossAssetSnapshot({ range, asOf: input.asOf, knowledgeAt: input.asOf }))
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
  // The cap protects the policy path's fixed share; a busy month must not drop the SEP or the vote.
  const macroCapped = applyMacroFactCap(sortedFacts, MARKET_ANALYSIS_CONTEXT_FACT_BUDGET.maximumMacroFacts)
  if (macroCapped.truncated) caveats.add(MARKET_ANALYSIS_CONTEXT_CAVEATS.maxItemsTruncated)
  // The reserve reorders inside the budget so the facts explaining a triggered change survive
  // truncation; with no triggers this is exactly `macroCapped.facts.slice(0, maxFacts)`.
  const keptFacts = applyReservedFacts(macroCapped.facts, internal.triggeredEventKeys ?? new Set(), maxFacts,
    undefined, MARKET_ANALYSIS_CONTEXT_FACT_BUDGET.minimumFactsPerDomain)
  if (keptFacts.length < macroCapped.facts.length) caveats.add(MARKET_ANALYSIS_CONTEXT_CAVEATS.maxItemsTruncated)
  // A caller may ask for fewer facts than the macro share; say the policy set was cut rather than
  // letting the generic truncation caveat hide which evidence went missing.
  const policySourceId = MARKET_ANALYSIS_POLICY_PATH_SOURCE_ID
  const policyAvailable = macroCapped.facts.filter(fact => fact.sourceId === policySourceId).length
  const policyKept = keptFacts.filter(fact => fact.sourceId === policySourceId).length
  if (policyAvailable > 0 && policyKept < policyAvailable) caveats.add(MARKET_ANALYSIS_CONTEXT_CAVEATS.policyPathTruncated)

  const output: MarketAnalysisContextAvailable = {
    state: 'available',
    schemaVersion: MARKET_ANALYSIS_CONTEXT_SCHEMA_VERSION,
    profileId: MARKET_ANALYSIS_CONTRACT_POLICY.dataAccessProfileId,
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
  if (utf8JsonBytes(output) > MARKET_ANALYSIS_CONTRACT_POLICY.maximumModelOutputBytes) {
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

export function resolveMacroActual(input: Readonly<{
  official: Readonly<{ value: string; observedAt: string }> | null
  provider: Readonly<{ value: string; observedAt: string }> | null
}>): Readonly<{ value: string | null; source: 'official' | 'observed-unverified' | null }> {
  if (input.official) return Object.freeze({ value: input.official.value, source: 'official' as const })
  if (input.provider) return Object.freeze({ value: input.provider.value, source: 'observed-unverified' as const })
  return Object.freeze({ value: null, source: null })
}

type MarketAnalysisContextAvailable = Extract<MarketAnalysisContextResult, { state: 'available' }>

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
      excerptHash,
      ...(fact.sourceUrl ? { sourceUrl: fact.sourceUrl } : {})
    })
  }
}
