import type { CrossAssetSnapshot } from '../../../contracts/crossAssetObservationContracts'
import type { OpenInterestHistoryResult } from '../../../contracts/openInterestHistory'
import type {
  CapitalConditionsSnapshotResult,
  FearGreedSnapshotResult,
  FundingRateHistoryResult
} from '../../../contracts/intelligenceQueryContracts'
import type { AgentEvidenceRef, AnalysisConclusionDirection, AnalysisSummary, Prediction } from '../../../contracts/marketAnalysisContracts'
import type { BriefingPriorConclusion, DailyBriefingPeriodKind, DailyBriefingRunTrigger } from '../../../contracts/dailyBriefing'
import type { MarketIntelligencePublicQueryService } from '../public-query/publicQueryService'
import type { NewsSentimentItemView } from '../news-sentiment/newsSentimentQuery'
import type { BriefingCalendarFreshnessReading } from './dailyBriefingCalendarCatchUp'

/**
 * The frozen inputs of one edition, before selection and rendering.
 *
 * The collector (the service that talks to the existing queries) produces this; the pure document
 * builder consumes it. Keeping the two apart is what lets the builder be tested without a clock,
 * a store or a source, and keeps every query failure a stated gap instead of a thrown error.
 */
export type DailyBriefingCalendarState = 'available' | 'unavailable' | 'source-disabled'

export type DailyBriefingCalendarEvent = Readonly<{
  eventKey: string
  title: string
  titleKey?: string
  countryCode?: string
  countryName?: string
  scheduledAt: string
  importance: 'high' | 'medium' | 'low'
  lifecycleState: 'scheduled' | 'released' | 'cancelled'
  category: 'economic-indicator' | 'financial-event' | 'central-bank-activity'
  actual?: string
  previous?: string
  consensus?: string
  surprise: Readonly<{
    direction: 'beat' | 'miss' | 'inline' | 'consensus-unavailable'
    value?: number
    unit?: 'pp' | 'relative-percent'
    reason?: string
  }>
}>

export type DailyBriefingConclusionInput = Readonly<{
  summary: AnalysisSummary
  predictions: readonly Prediction[]
  /** The timeline node's own direction; the legacy fallback when the summary has no structured conclusion. */
  occurredAt: string
  direction?: AnalysisConclusionDirection | null
  evidenceRefs?: readonly AgentEvidenceRef[]
}>

export type DailyBriefingFactPacket = Readonly<{
  asOf: string
  windowStart: string
  windowEnd: string
  /** The statistical window the packet was read for, in hours, as configured at generation time. */
  windowHours: number
  locale: 'zh-CN' | 'en-US'
  timeZone: string
  /**
   * Which period this run is for, and why it ran. Carried on the packet so the document builder does
   * not have to guess: after periods got their own ids, a literal `default` here would file every
   * edition under the wrong period. Absent on older callers/fixtures, and then the builder's
   * fallback applies.
   */
  periodId?: string
  /** The nominal cutoff of this period; absent means the window end. */
  periodTime?: string
  periodKind?: DailyBriefingPeriodKind
  runTrigger?: DailyBriefingRunTrigger
  conclusion: DailyBriefingConclusionInput | null
  /**
   * Every earlier AI conclusion inside the window, oldest first. These are claims the editor may
   * weigh, never facts: their numbers do not become evidence and cannot be cited as such.
   */
  priorConclusions?: readonly BriefingPriorConclusion[]
  news: Readonly<{
    state: 'available' | 'empty' | 'unavailable' | 'source-disabled'
    items: readonly NewsSentimentItemView[]
  }>
  calendar: Readonly<{
    state: DailyBriefingCalendarState
    events: readonly DailyBriefingCalendarEvent[]
  }>
  /**
   * How old the calendar was when this run judged it, plus the catch-up it ran first (`A0.8`).
   *
   * Read once, before the month query, so the empty section's reason comes from the same reading the
   * run used. Absent on older callers and fixtures: then the section may only say "not readable".
   */
  calendarFreshness?: BriefingCalendarFreshnessReading
  /**
   * 两级取值的计数（`A0.12`）：第一级回查了几条事件、第二级真的发了几次搜索。
   * 留在 fact 层供用例与排查读，不进文档、不呈现给读者。
   */
  macroValueCounts?: Readonly<{ calendarCalls: number; webCalls: number }>
  readings: Readonly<{
    fearGreed: FearGreedSnapshotResult
    funding: FundingRateHistoryResult
    capital: CapitalConditionsSnapshotResult
  }>
  positioning?: OpenInterestHistoryResult
  policyPath?: import('../policy-path/policyPathQueryService').PolicyPathReading
  market: Readonly<{
    crossAsset?: CrossAssetSnapshot
    /**
     * Why the cross-asset read came back empty, when it did: `not-wired`, `threw:<message>` or
     * `rejected:<field>`. In-memory only — it reaches the agent's gap sentence, never the stored
     * document, so no schemaVersion moves.
     */
    crossAssetFailure?: string
    macroMarket?: NonNullable<ReturnType<MarketIntelligencePublicQueryService['queryMacroMarketSnapshot']>>
    macroRates?: NonNullable<ReturnType<MarketIntelligencePublicQueryService['queryMacroRatesSnapshot']>>
  }>
  enabled: Readonly<{
    fearGreed: boolean
    funding: boolean
    stablecoin: boolean
    etf: boolean
    calendar: boolean
  }>
}>
