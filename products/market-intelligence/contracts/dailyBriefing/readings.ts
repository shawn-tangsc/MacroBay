/**
 * The brief's reading shapes: the fact rows, the news and macro items, and the next-event entries.
 *
 * Split out of `contracts/dailyBriefing.ts` so the reading vocabulary can change without dragging
 * the document or the conclusion shapes into the same diff.
 */

export type DailyBriefingLocale = 'zh-CN' | 'en-US'
export type DailyBriefLedePattern = 'event-shock' | 'surprise-gap' | 'tension' | 'structure' | 'setup' | 'outlier' | 'falsification'
export type DailyBriefingDocumentSchemaVersion = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15
export type DailyBriefingPolicyVersion = 'daily-briefing.v1' | 'daily-briefing.v2' | 'daily-briefing.v3' | 'daily-briefing.v4' | 'daily-briefing.v5' | 'daily-briefing.v6' | 'daily-briefing.v7' | 'daily-briefing.v8' | 'daily-briefing.v9' | 'daily-briefing.v10' | 'daily-briefing.v11' | 'daily-briefing.v12' | 'daily-briefing.v13' | 'daily-briefing.v14' | 'daily-briefing.v15' | 'daily-briefing.v16' | 'daily-briefing.v17' | 'daily-briefing.v18' | 'daily-briefing.v19' | 'daily-briefing.v20' | 'daily-briefing.v21' | 'daily-briefing.v22' | 'daily-briefing.v23' | 'daily-briefing.v24' | 'daily-briefing.v25'

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

/**
 * Deterministic materiality of one data fact.
 *
 * The rule layer decides whether a fact is allowed to appear at all: a leverage or policy-path line
 * below its threshold can never be shown, however the model ranks it. The reader's rule is
 * "no material change, no line", so an immaterial row keeps a hidden baseline instead of appearing
 * because a value exists. `reasonCode` is stable data, never prose.
 */
export type BriefingMaterialityCode =
  | 'largest-move'
  | 'gap'
  | 'index-move'
  | 'fx-move'
  | 'gold-move'
  | 'yield-move'
  | 'stablecoin-shift'
  | 'etf-flow'
  | 'funding-extreme'
  | 'funding-flip'
  | 'sentiment-extreme'
  | 'open-interest-shift'
  | 'policy-probability-shift'
  | 'policy-meeting-imminent'
  | 'policy-path-change'
  | 'no-material-change'

export type BriefingMateriality = Readonly<{
  material: boolean
  reasonCode: BriefingMaterialityCode
}>

/** Editorial visibility of a data fact. Absent on editions built before the field existed: shown. */
export type BriefingDataVisibility = 'shown' | 'hidden'

/**
 * How a row's comparison is anchored in time.
 *
 * A daily brief is generated every morning, but its rows do not all publish on that clock:
 *
 * - `24h` — a 24/7 market (crypto, stablecoins, funding, open interest). The baseline is the point
 *   nearest `asOf - 24h`, so Saturday is compared with Friday, not with "yesterday".
 * - `trading-day` — a US session close (ETF flows, the dollar, gold, the ten-year). The baseline is
 *   the last close of the previous session, reached by walking back over weekends and market
 *   holidays. A day without a close is not a stale reading: the newest close is simply the newest.
 * - `publication-day` — a released value (fear-and-greed, a calendar release). The baseline is the
 *   previous publication, whatever day it landed on; the real interval is carried in `baselineAt`.
 *
 * `baselineAt` is the instant of the value compared against. Without it the window is known but the
 * anchor is not, and a reader must not be told a "1d" move that was measured over an unknown span.
 */
export type BriefingRowCadence = '24h' | 'trading-day' | 'publication-day'

/**
 * The expected publication windows a row is allowed before its absence becomes a gap.
 *
 * These are tolerances for lateness, not rules for weekends: a `trading-day` row is never stale
 * because the market is shut, only because sessions that should have printed are missing.
 */
export const briefingCadencePolicy = Object.freeze({
  /** A 24/7 feed may lag this long and still answer a rolling-24h comparison. */
  rolling24hMaxLagMs: 6 * 60 * 60 * 1_000,
  /** Sessions a `trading-day` row may miss before its value is a gap rather than the newest close. */
  tradingDayMaxMissingSessions: 2
})

export type BriefingValueFormat = 'score' | 'percent' | 'usd' | 'flow-usd' | 'yield' | 'level'
/** `points` is a fear-and-greed index move, which is a score change rather than a percentage. */
export type BriefingChangeUnit = 'pp' | 'percent' | 'bp' | 'usd' | 'points'
/**
 * The comparison window of a data row. `24h` is a rolling 24/7 window, `1d` the source's own
 * day-over-day figure, `trading-day` one session's close, `publication-day` the span since the
 * previous release.
 */
export type BriefingWindow = 'latest' | '24h' | '1d' | '7d' | '30d' | 'daily' | 'trading-day' | 'publication-day'

/**
 * One comparison window of a data row.
 *
 * `change` is the row's headline comparison; `auxiliaryChanges` carries the longer or alternate
 * windows (stablecoin 7d/30d, the 1d dollar amount beside its percentage). A change is never
 * inferred from the level: when the edition has no earlier observation the row says
 * `changeReason: 'no-baseline'` instead of reporting a zero move.
 */
export type BriefingRowChange = Readonly<{
  value: number
  unit: BriefingChangeUnit
  window: BriefingWindow
}>

/**
 * One point of a card's stored series: the instant the value belongs to, and the value itself.
 *
 * Open interest keeps the notional amount, not a percentage, because the card's number is the amount's
 * change and the line is drawn from the amounts it moved between.
 */
export type BriefingSeriesPoint = Readonly<{ at: string; value: number }>

/**
 * One point of a price curve: a zero-anchored return, never a price.
 *
 * A price line on this card would only ever go up; `returnPercent` says what the window did.
 */
export type BriefingCurvePoint = Readonly<{ at: string; returnPercent: number }>

/**
 * One drawable stretch of a curve.
 *
 * Rebased and thinned at build time, and split wherever the source had no reading, so a gap in the
 * data is a gap in the drawing instead of a straight line through minutes nobody measured.
 */
export type BriefingCurveSegment = readonly BriefingCurvePoint[]

/**
 * Why a card has no curve to draw.
 *
 * These are four different facts and stay four: `no-snapshot` the market read carried no curve at
 * all, `no-anchor` no point in the window with a value (so there is nothing to be zero against),
 * `too-few-points` fewer than two drawable points, `window-too-long` the edition's window is longer
 * than the 24-hour curve can honestly cover.
 */
export type BriefingCurveReason = 'no-snapshot' | 'no-anchor' | 'too-few-points' | 'window-too-long'

/**
 * How far the reading travelled inside the edition's window.
 *
 * `percent = (high − low) / anchor × 100`, where `anchor` is the window-start close the curve is also
 * divided by — never a bar's open, never the current price. One window, one zero point: otherwise the
 * amplitude drifts with the day and the same data computes two different numbers.
 */
export type BriefingAmplitude = Readonly<{ percent: number; high: number; low: number; anchor: number }>

/**
 * Why a row states no amplitude.
 *
 * `partial-bars`: the window's bars are not all there, so the real high or low may be missing and the
 * number would understate the day. `no-anchor`: no window-start close to divide by. Both are stated
 * instead of a number with a caveat nobody reads.
 */
export type BriefingAmplitudeReason = 'partial-bars' | 'no-anchor'

export type BriefingMarketRow = Readonly<{
  id: 'btc' | 'eth' | 'index' | 'dxy' | 'gold' | 'us10y' | 'us10y-real'
  labelKey: string
  importance: FactImportance
  /** Deterministic verdict; absent on editions built before v19. */
  materiality?: BriefingMateriality
  /** Editorial visibility; absent means shown, for older editions. */
  visibility?: BriefingDataVisibility
  visibilityReason?: string
  state: DailyBriefingReadingState
  value: Readonly<{ number: number; format: BriefingValueFormat }> | null
  change: BriefingRowChange | null
  /** Longer comparison windows shown behind the headline change; never invented when absent. */
  auxiliaryChanges?: readonly BriefingRowChange[]
  changeReason?: 'no-baseline' | 'insufficient-window'
  window: BriefingWindow
  /** The comparison cadence; absent on editions built before schema 9. */
  cadence?: BriefingRowCadence
  /** The instant of the value `change` was measured against; absent when only the window is known. */
  baselineAt?: string
  observedAt: string | null
  reason?: 'not-collected' | 'query-failed' | 'stale-fallback' | 'coverage-incomplete'
  /**
   * Which reading a stale row carries, never presented as today's: `snapshot` a frozen metric older
   * than the floor, `curve` the 24h curve's last point, `last-close` the newest bar, `series-return`
   * /`series-level` a daily series' move or level, `published` the official stamp for the session.
   */
  valueBasis?: 'snapshot' | 'curve' | 'last-close' | 'series-return' | 'series-level' | 'published'
  /**
   * The card's window return curve, split at every missing reading and already rebased to its own
   * first point. Absent on editions built before schema 10, and on any edition with nothing to draw.
   */
  curve?: readonly BriefingCurveSegment[]
  /** Stated only when `curve` is absent, so "no line" always has a reason the reader can be told. */
  curveReason?: BriefingCurveReason
  /**
   * The window's travel, on the three readings that have continuous bars. Absent on editions built
   * before schema 11, on rows without a continuous series, and when the window's bars are incomplete.
   */
  amplitude?: BriefingAmplitude
  /**
   * The close this row's window ended on, so the card can print a level and not only a percentage.
   *
   * A percentage alone leaves the reader without a base: `+0.9%` of what? Absent on editions built before
   * schema 12, and whenever the read carried no closed bar at the cutoff — the card then shows its reason
   * rather than a zero.
   */
  close?: Readonly<{ value: number; at: string }>
  /**
   * Which leg answered the index row: the licensed index or the tokenised proxy.
   *
   * Written down so a stored edition can say what its number was about — a proxy's move is not the index's,
   * and a reader comparing it against the dollar or gold would be comparing different instruments.
   */
  indexSource?: 'real' | 'proxy'
  /** Stated only when `amplitude` is absent, same rule as `curveReason`. */
  amplitudeReason?: BriefingAmplitudeReason
  /** The window's own bar count against what it should hold, when an amplitude was withheld for it. */
  amplitudeCoverage?: Readonly<{ count: number; expectedCount: number }>
}>

export type BriefingPulseRow = Readonly<{
  id: 'fear-greed' | 'funding-btc' | 'funding-eth' | 'stablecoin' | 'etf-btc' | 'etf-eth'
  group: 'funds' | 'sentiment'
  labelKey: string
  importance: FactImportance
  /** Deterministic verdict; absent on editions built before v19. */
  materiality?: BriefingMateriality
  /** Editorial visibility; absent means shown, for older editions. */
  visibility?: BriefingDataVisibility
  visibilityReason?: string
  state: DailyBriefingReadingState
  value: Readonly<{ number: number; format: BriefingValueFormat }> | null
  change: BriefingRowChange | null
  /** Longer comparison windows shown behind the headline change; never invented when absent. */
  auxiliaryChanges?: readonly BriefingRowChange[]
  changeReason?: 'no-baseline' | 'insufficient-window'
  window: BriefingWindow
  /** The comparison cadence; absent on editions built before schema 9. */
  cadence?: BriefingRowCadence
  /** The instant of the value `change` was measured against; absent when only the window is known. */
  baselineAt?: string
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
  /** AI visibility decision; absent means shown for older editions. */
  visibility?: 'shown' | 'hidden'
  visibilityReason?: string
}>

/**
 * The headline to draw for one edition. A translated title is used only when it belongs to that
 * edition's language; an English edition falls back to the source (English) title rather than print
 * Chinese. This is a display fallback for documents written before the language gate — it never
 * infers a source language, never drops an item, and never affects a Chinese edition.
 */
export function editionNewsTitle(item: Readonly<{ title: string; translatedTitle?: string }>, editionLocale: DailyBriefingLocale): string {
  const translated = item.translatedTitle
  if (!translated) return item.title
  if (editionLocale === 'en-US' && /[\u3400-\u9fff]/.test(translated)) return item.title
  return translated
}

export type BriefingMacroItem = Readonly<{
  eventKey: string
  title: string
  titleKey?: string
  scheduledAt: string
  importance: 'high' | 'medium' | 'low'
  countryCode?: string
  countryName?: string
  actual?: string
  previous?: string
  consensus?: string
  /**
   * The event's own lifecycle, carried from the calendar (`02` `A0.12`, schema 14).
   *
   * `cancelled` means the release was called off: the row is real schedule news, so the card draws
   * it and marks it, but no value will ever arrive — it must not read as "we failed to get one",
   * and it must not enter the analysis snapshot. Absent on documents written before schema 14; the
   * renderers treat absence as "not cancelled", never as a fourth state.
   */
  lifecycleState?: 'scheduled' | 'released' | 'cancelled'
  /**
   * 这个实际值是从哪儿来的（`02` v2.128）：日历源就是 `calendar`，联网取到的是 `web`。
   * 只用于在值后面标「（网页）」——**来源标注不是可信度话术**，四个禁用词照旧命中 0。
   * 老文档没有这个字段 = 全部来自日历，渲染不补任何后缀。
   */
  valueSource?: 'calendar' | 'web'
  surprise: Readonly<{
    direction: 'beat' | 'miss' | 'inline' | 'consensus-unavailable'
    value?: number
    unit?: 'pp' | 'relative-percent'
    reason?: string
  }>
  why?: string
  /** AI visibility decision; absent means shown for older editions. */
  visibility?: 'shown' | 'hidden'
  visibilityReason?: string
}>

/**
 * 一个新闻来源今天的状态（`02` v2.167，schema 15）。
 *
 * 右列「数据缺口与限制」只读冻结的日报文档，所以来源的状态必须**写进文档**才到得了读者眼前；
 * 另开一张来源状态表等于让读者去两个地方找同一种事。
 *
 * 两种状态分开，**永远不共用一句话**：
 * - `silent`：活着的源，但**超过它自己的静默窗口没有新条目**（新闻源 24 小时）。`lastNewItemAt`
 *   是**最后一次真的带来新条目**的时刻，不是"最后一次采集成功"——每 15 分钟都成功、抓回来全是
 *   被去重挡掉的旧条目时，后者永远是"刚才"。写不出这个时刻就不报静默，宁可不说话。
 * - `failed`：连续采集失败（与「静默」是两条事件）。
 *
 * 正常的源**不进这个列表**：没有条目就是没有条目，不是"缺什么"。
 */
export type BriefingNewsSource = Readonly<{
  sourceId: string
  /** 读者看得见的名字，来自来源注册表；渲染层不再自己查表。 */
  name: string
  state: 'silent' | 'failed'
  /** `silent`：最后一次真的带来新条目的时刻（UTC）。 */
  lastNewItemAt?: string
  /** `silent`：距那一刻过去了多少小时（取整，只用于句子里的数字）。 */
  silentHours?: number
  /** `failed`：连续失败次数。 */
  consecutiveFailures?: number
}>

/**
 * The transmission channel a scheduled event uses to reach BTC/ETH. Policy, inflation, labor,
 * liquidity, ETF flows, regulation, stablecoins and exchange risk are the channels a crypto desk
 * trades; `asia-risk` and `commodity` are regional spillovers that only matter when the read names
 * that transmission, so they rank below the crypto-native channels by default.
 */
export const briefingNextRelevanceRoles = [
  'rate-policy', 'inflation', 'labor', 'liquidity', 'etf', 'regulation',
  'stablecoin', 'exchange-risk', 'asia-risk', 'commodity'
] as const

export type BriefingNextRelevanceRole = (typeof briefingNextRelevanceRoles)[number]

export type BriefingNextRelevance = Readonly<{
  /** 0-100: higher means the event transmits more directly to BTC/ETH. */
  score: number
  role: BriefingNextRelevanceRole
  /** Stable machine code for the channel; reader copy is written by the editor, never this. */
  reasonCode: string
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
  /**
   * Why this event ranks where it does for a crypto reader. Optional because editions stored before
   * the ranking existed carry no relevance, and those must keep rendering.
   */
  relevance?: BriefingNextRelevance
  /** Editorial: why this event is the focus, and what each surprise would imply. */
  why?: string
  watch?: readonly Readonly<{ condition: string; implication: string }>[]
}>

