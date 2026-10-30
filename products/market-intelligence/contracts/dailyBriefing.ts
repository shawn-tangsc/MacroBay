import type { AnalysisConclusionDirection } from './marketAnalysisContracts'

/**
 * The frozen daily-briefing document.
 *
 * This is the one shape the renderer, the Markdown serializer and the stored edition share. It is
 * data only: labels are keys, prose is the published conclusion's own text, and every number keeps
 * its window and observation time. The main process builds it; the renderer never re-derives it.
 */
export const dailyBriefingPolicy = Object.freeze({
  schemaVersion: 2,
  policyVersion: 'daily-briefing.v9',
  windowHours: 24,
  maximumBytes: 256 * 1024,
  maximumNewsItems: 3,
  maximumMacroItems: 3,
  maximumNextItems: 3,
  maximumCounterEvidence: 3,
  maximumConditions: 5,
  maximumGaps: 3,
  maximumCaveats: 3,
  retentionDays: 14,
  editionDatePattern: /^\d{4}-\d{2}-\d{2}$/
})

export type DailyBriefingLocale = 'zh-CN' | 'en-US'
export type DailyBriefingDocumentSchemaVersion = 1 | 2
export type DailyBriefingPolicyVersion = 'daily-briefing.v1' | 'daily-briefing.v2' | 'daily-briefing.v3' | 'daily-briefing.v4' | 'daily-briefing.v5' | 'daily-briefing.v6' | 'daily-briefing.v7' | 'daily-briefing.v8' | 'daily-briefing.v9'

/** The four readings, and whether each source could answer at generation time. */
export type DailyBriefingReadingId = 'fear-greed' | 'funding' | 'capital' | 'calendar'
export type DailyBriefingReadingState = 'available' | 'stale' | 'unavailable' | 'source-disabled'

/** Visibility tier. The agent ranks; a deterministic floor is unioned into `must` by the builder. */
export type FactImportanceTier = 'must' | 'support' | 'reference'
export type FactImportanceSource = 'rule' | 'agent'
export type FactImportanceReason =
  | 'reading'
  | 'largest-move'
  | 'gap'
  | 'high-impact-release'
  | 'nearest-event'
  | 'counter-evidence'
  | 'context'
  | 'agent'

export type FactImportance = Readonly<{
  tier: FactImportanceTier
  source: FactImportanceSource
  reasonCode: FactImportanceReason
  reasonText?: string
}>

export type BriefingValueFormat = 'score' | 'percent' | 'usd' | 'flow-usd' | 'yield' | 'level'
export type BriefingChangeUnit = 'pp' | 'percent' | 'bp' | 'usd'
export type BriefingWindow = 'latest' | '24h' | '1d' | 'daily' | 'trading-day'

export type BriefingMarketRow = Readonly<{
  id: 'btc' | 'eth' | 'index' | 'dxy' | 'gold' | 'us10y' | 'us10y-real'
  labelKey: string
  importance: FactImportance
  state: DailyBriefingReadingState
  value: Readonly<{ number: number; format: BriefingValueFormat }> | null
  change: Readonly<{ value: number; unit: BriefingChangeUnit; window: BriefingWindow }> | null
  changeReason?: 'no-baseline' | 'insufficient-window'
  window: BriefingWindow
  observedAt: string | null
  reason?: 'not-collected' | 'query-failed' | 'stale-fallback' | 'coverage-incomplete'
}>

export type BriefingPulseRow = Readonly<{
  id: 'fear-greed' | 'funding-btc' | 'funding-eth' | 'stablecoin' | 'etf-btc' | 'etf-eth'
  group: 'funds' | 'sentiment'
  labelKey: string
  importance: FactImportance
  state: DailyBriefingReadingState
  value: Readonly<{ number: number; format: BriefingValueFormat }> | null
  change: Readonly<{ value: number; unit: BriefingChangeUnit; window: BriefingWindow }> | null
  changeReason?: 'no-baseline' | 'insufficient-window'
  window: BriefingWindow
  observedAt: string | null
  reason?: 'not-collected' | 'query-failed' | 'capital-gate' | 'etf-unavailable'
}>

export type BriefingNewsPolarity = 'bullish' | 'bearish' | 'neutral' | 'mixed'

export type BriefingNewsItem = Readonly<{
  itemId: string
  title: string
  translatedTitle?: string
  sourceName: string
  publishedAt: string
  polarity: BriefingNewsPolarity
  strength: number
  confidence: number
  symbols: readonly ('BTC' | 'ETH')[]
  why?: string
}>

export type BriefingMacroItem = Readonly<{
  eventKey: string
  title: string
  titleKey?: string
  scheduledAt: string
  importance: 'high' | 'medium' | 'low'
  actual?: string
  previous?: string
  consensus?: string
  surprise: Readonly<{
    direction: 'beat' | 'miss' | 'inline' | 'consensus-unavailable'
    value?: number
    unit?: 'pp' | 'relative-percent'
    reason?: string
  }>
  why?: string
}>

export type BriefingNextItem = Readonly<{
  eventKey: string
  title: string
  titleKey?: string
  at: string
  importance: 'high' | 'medium' | 'low'
  category: 'economic-indicator' | 'financial-event' | 'central-bank-activity'
  countryCode?: string
  countryName?: string
  consensus?: string
  previous?: string
  /** Editorial: why this event is the focus, and what each surprise would imply. */
  why?: string
  watch?: readonly Readonly<{ condition: string; implication: string }>[]
}>

export type BriefingCounterEvidence = Readonly<{
  statement: string
  citations: readonly number[]
}>

export type BriefingTopSignal = Readonly<{
  horizon: string
  direction: string
  confidence: string
  rationale: string
  citations: readonly number[]
}>

export type BriefingConclusion = Readonly<{
  summaryId: string
  publishedAt: string
  direction: AnalysisConclusionDirection
  /** One row per operation horizon; the direction ribbon reads these. */
  directions: readonly Readonly<{ horizon: string; direction: string; confidence: string }>[]
  summary: string
  translation?: string
  change?: string
  conditions: readonly string[]
  invalidations: readonly Readonly<{ asset: 'BTC' | 'ETH'; horizonEnd: string; text: string }>[]
  counterEvidence: readonly BriefingCounterEvidence[]
  topSignal: BriefingTopSignal | null
  evidenceStrength?: string
  dataGaps: readonly string[]
  caveats: readonly string[]
}>

export type BriefingNewsSummary = Readonly<{
  state: 'available' | 'empty' | 'unavailable' | 'source-disabled'
  counts?: Readonly<{ bearish: number; bullish: number; mixed: number; neutral: number }>
  itemCount?: number
}>

export type DailyBriefingDocument = Readonly<{
  schemaVersion: DailyBriefingDocumentSchemaVersion
  policyVersion: DailyBriefingPolicyVersion
  edition: Readonly<{
    date: string
    locale: DailyBriefingLocale
    generatedAt: string
    windowStart: string
    windowEnd: string
    timeZone: string
  }>
  status: Readonly<{
    readings: readonly Readonly<{ id: DailyBriefingReadingId; state: DailyBriefingReadingState }>[]
    readingsAvailable: number
    readingsTotal: 4
  }>
  lede: Readonly<{
    source: 'template' | 'agent'
    text: string
    factCount?: number
    generatedAt: string
  }>
  news: Readonly<{
    items: readonly BriefingNewsItem[]
    macro: readonly BriefingMacroItem[]
    notes: Readonly<{ newsEmpty?: string; macroEmpty?: string }>
  }>
  data: Readonly<{
    market: readonly BriefingMarketRow[]
    funds: readonly BriefingPulseRow[]
    sentiment: Readonly<{
      fearGreed: BriefingPulseRow | null
      news: BriefingNewsSummary
    }>
  }>
  conclusion: BriefingConclusion | null
  next: Readonly<{ items: readonly BriefingNextItem[]; focus?: BriefingNextItem; note?: string }>
  editorial?: Readonly<{ dataNote?: string; invalidationNote?: string }>
  citations: readonly Readonly<{
    index: number
    refId: string
    sourceLabel?: string
    observedAt?: string
    itemId?: string
    statement?: string
  }>[]
  provenance: Readonly<{
    summaryId: string | null
    readAt: string
    supplements?: readonly Readonly<{ at: string; tool: string; reason: string }>[]
    editorialMeta?: Readonly<{
      promptVersion: string
      model: string
      source: 'default' | 'custom'
      fallback?: 'custom-unavailable'
    }>
    /** Present when the fact layer shipped because the editorial layer did not run. */
    editorialFailure?: string
  }>
}>

/** One row in the history rail. `missing` rows are gaps, not empty editions. */
export type DailyBriefingEditionSummary = Readonly<{
  date: string
  locale: DailyBriefingLocale
  availableLocales: readonly DailyBriefingLocale[]
  state: 'generated' | 'missing'
  generatedAt?: string
  direction?: AnalysisConclusionDirection
  summaryLine?: string
  readingsAvailable?: number
  windowEnd?: string
}>

export type DailyBriefingListResult = Readonly<{
  editions: readonly DailyBriefingEditionSummary[]
}>

export function isDailyBriefingLocale(value: unknown): value is DailyBriefingLocale {
  return value === 'zh-CN' || value === 'en-US'
}

export function isDailyBriefingEditionDate(value: unknown): value is string {
  if (typeof value !== 'string' || !dailyBriefingPolicy.editionDatePattern.test(value)) return false
  const parsed = Date.parse(`${value}T00:00:00.000Z`)
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === value
}

export function isDailyBriefingReadingState(value: unknown): value is DailyBriefingReadingState {
  return value === 'available' || value === 'stale' || value === 'unavailable' || value === 'source-disabled'
}

export function isFactImportanceTier(value: unknown): value is FactImportanceTier {
  return value === 'must' || value === 'support' || value === 'reference'
}

/** The document crosses IPC; reject an oversized payload before it is stored or rendered. */
export function isDailyBriefingDocumentWithinBudget(value: unknown): boolean {
  try {
    return new TextEncoder().encode(JSON.stringify(value)).byteLength <= dailyBriefingPolicy.maximumBytes
  } catch {
    return false
  }
}
