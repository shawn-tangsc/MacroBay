import type { CrossAssetSnapshot } from '../../../contracts/crossAssetObservationContracts'
import type {
  CapitalConditionsSnapshotResult,
  FearGreedSnapshotResult,
  FundingRateHistoryResult
} from '../../../contracts/intelligenceQueryContracts'
import type { AgentEvidenceRef, AnalysisConclusionDirection, AnalysisSummary, Prediction } from '../../../contracts/marketAnalysisContracts'
import type { MarketIntelligencePublicQueryService } from '../public-query/publicQueryService'
import type { NewsSentimentItemView } from '../news-sentiment/newsSentimentQuery'

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
  locale: 'zh-CN' | 'en-US'
  timeZone: string
  conclusion: DailyBriefingConclusionInput | null
  news: Readonly<{
    state: 'available' | 'empty' | 'unavailable' | 'source-disabled'
    items: readonly NewsSentimentItemView[]
  }>
  calendar: Readonly<{
    state: DailyBriefingCalendarState
    events: readonly DailyBriefingCalendarEvent[]
  }>
  readings: Readonly<{
    fearGreed: FearGreedSnapshotResult
    funding: FundingRateHistoryResult
    capital: CapitalConditionsSnapshotResult
  }>
  market: Readonly<{
    crossAsset?: CrossAssetSnapshot
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
