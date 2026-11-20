import {
  MARKET_ANALYSIS_CROSS_ASSET_INSTRUMENTS,
  type AnalysisDomain,
  type MarketAnalysisCrossAssetInstrument,
  type MarketAnalysisDomainAccess,
  type MarketAnalysisDomainAdmission
} from '../../../contracts/marketAnalysisContracts'
import { MARKET_INTELLIGENCE_QUERY_CAVEATS as marketIntelligenceQueryCaveats } from '../../../contracts/intelligenceQueryContracts'
import { macroRatesSnapshotPublicPolicy } from '../../../contracts/macro/macroRatesSnapshotContracts'
import { macroMarketSnapshotPublicPolicy } from '../../../contracts/macro/macroMarketSnapshotContracts'
import { marketCalendarPublicPolicy } from '../../../contracts/macro/marketCalendarQueryContracts'
import { defaultObservation, type MarketAnalysisDomainObservation } from './marketAnalysisContextProjection'

/**
 * 分析能读哪些源、哪些能被问、哪些能触发——一张数据表加一份纯投影。
 *
 * 从 `marketAnalysisContextQuery` 抽出来（那个文件越过 500 行软上限）：这里没有任何一次读取、
 * 没有时钟、没有查询端口，输入观察值、输出访问矩阵，所以可以独立测。事实的选取与预算仍在
 * 原文件，两边共享 `MATRIX_DOMAIN_ORDER` 这一个顺序，不各自再排一遍。
 */

const HANDLER_PREFIX = 'market-intelligence.'

/** 矩阵与上下文两处共用的域顺序：矩阵按它排，事实按 `CONTEXT_FACT_DOMAIN_ORDER` 排。 */
export const MATRIX_DOMAIN_ORDER: readonly AnalysisDomain[] = ['macro', 'capital', 'sentiment', 'funding', 'cross-asset']

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
      // 市场日历的 feed id 取自公开契约的 `feedByKind`：事实里的 `sourceId` 就是按它填的，
      // 声明来源必须与事实来源同源，否则来源健康里会永远挂着三个不产数的旧 id。
      ...marketCalendarPublicPolicy.feedByKind,
      'fred-rates-liquidity', 'twelve-data-market', 'policy-path-market'
    ]),
    admission: 'connected-but-not-agent-tool',
    publicQueryMethods: Object.freeze([
      'macroEconomicCalendarQueryService.queryMonth',
      'marketCalendarPublicQueryService.queryMonth',
      'publicQueryService.queryMacroMarketSnapshot',
      'publicQueryService.queryMacroRatesSnapshot',
      'publicQueryService.queryPolicyPath'
    ]),
    ipcMethods: Object.freeze([
      'intelligence.macro.economicCalendar.queryMonth',
      'intelligence.macro.marketCalendar.queryMonth',
      'intelligence.macro.marketSnapshot.query',
      'intelligence.macro.ratesSnapshot.query',
      'intelligence.macro.policyPath.read'
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
  // Full admission, decided by the product owner: the calendar is live and equal to the official
  // calendar for trigger purposes. Its observations are still aggregator observations, so the
  // observed-unverified caveat stays on every one of these sources.
  // 与事实里的 `sourceId` 同一个出处（`feedByKind`），换源时只改契约一处。
  ...marketCalendarPublicPolicy.feedByKind.map((feedId) => source(
    feedId, ['macro'], 'production-ready',
    ['marketCalendarPublicQueryService.queryMonth'], ['intelligence.macro.marketCalendar.queryMonth'],
    true, ['observed-unverified'])),
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
  // The policy path is read by the panel's card and the analysis context: one service, two
  // consumers. It stays a contextual source — being able to price a meeting is not permission to
  // start an analysis from that price — and the two caveats name what a conclusion must not
  // over-read: the odds are a venue's price, and the SEP belongs to the last publishing meeting.
  source('policy-path-market', ['macro'], 'connected-but-not-agent-tool', ['publicQueryService.queryPolicyPath'],
    ['intelligence.macro.policyPath.read'], false,
    ['odds-are-market-pricing', 'projections-from-latest-sep-meeting'], true),
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
