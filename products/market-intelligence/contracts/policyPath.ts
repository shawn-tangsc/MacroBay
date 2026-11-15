/**
 * The policy path reading: one meeting's official facts plus the market's implied odds for it.
 *
 * Two rules shape this file. The series is the primary data — a single value cannot say whether the
 * market moved — and every value carries the instant it was observed, because these numbers change
 * all day and a value without an as-of is unfalsifiable.
 */

import { metricConceptOf } from './metricKeyConcept'

export const POLICY_PATH_OUTCOMES = ['no-change', 'hike-25', 'hike-50-plus', 'cut-25', 'cut-50-plus'] as const
export type PolicyPathOutcome = typeof POLICY_PATH_OUTCOMES[number]

export type PolicyPathDistribution = Readonly<Record<PolicyPathOutcome, number>>

export type PolicyPathQuote = Readonly<{ bid: number; ask: number }>

export type PolicyPathObservation = Readonly<{
  /** When the venue data was read, ISO with milliseconds. */
  at: string
  values: PolicyPathDistribution
  quote?: PolicyPathQuote
}>

/** One SEP release, reduced to the row the policy block reads. */
export type PolicyPathSep = Readonly<{
  /** The meeting that published these projections; the median is only meaningful against it. */
  asOf: string
  medianPath: Readonly<{ y2026?: number; y2027?: number; y2028?: number; y2029?: number; longerRun?: number }>
  rangeCurrentYear?: Readonly<{ low: number; high: number }>
  /** The same-year median from the previous SEP, for "up or down" without a second fetch. */
  previousMedian?: number
  sourceUrl: string
}>

export type PolicyPathStaleness = 'live' | 'delayed' | 'stale' | 'unavailable'

/** Sum drift beyond this share means the payload is not a usable distribution. */
export const POLICY_PATH_SUM_TOLERANCE = 0.005

/** The venue quotes five buckets that should sum to one; overround is a few tenths of a percent. */
export function normalizeOutcomes(raw: Partial<Record<PolicyPathOutcome, number>>): PolicyPathDistribution | undefined {
  const values = POLICY_PATH_OUTCOMES.map((outcome) => raw[outcome])
  if (values.some((value) => typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1)) return undefined
  const sum = values.reduce<number>((total, value) => total + (value as number), 0)
  if (!Number.isFinite(sum) || sum <= 0 || Math.abs(sum - 1) > 0.1) return undefined
  const normalized = values.map((value) => (value as number) / sum) as number[]
  return Object.fromEntries(POLICY_PATH_OUTCOMES.map((outcome, index) => [outcome, normalized[index]!])) as PolicyPathDistribution
}

/** Percent-point change, rounded to one decimal so a 0.04pp wobble does not read as movement. */
export function changeInPp(current: number, previous: number): number {
  return Math.round((current - previous) * 1000) / 10
}

/** Basis-point change, one decimal: the chart's own unit, rounded like the pp figure above. */
export function changeInBp(current: number, previous: number): number {
  return Math.round((current - previous) * 10) / 10
}

/**
 * What one bucket is worth in basis points — the single definition of the expectation.
 *
 * A bucket *is* a magnitude, so 25 and its negative carry no ambiguity. The two open-ended buckets
 * take their lower bound (+50 / −50): the midpoint would guess at what the venue never told us, and
 * a historical average would import past moves into today's quote. The lower bound is the only
 * choice that is decidable from one observation alone. The cost is a known, documented bias — both
 * open-ended buckets are understated — so this number must never be compared with another venue's
 * expectation, and changing it means recomputing every stored point, never mixing old and new.
 */
export const POLICY_PATH_BUCKET_BP: Readonly<Record<PolicyPathOutcome, number>> = Object.freeze({
  'hike-25': 25,
  'hike-50-plus': 50,
  'no-change': 0,
  'cut-25': -25,
  'cut-50-plus': -50
})

/**
 * The market's weighted expectation at one instant, in basis points.
 *
 * The input must already be a normalised distribution: the collector normalises once on write, and
 * dividing by the sum again here would re-edit a value that is already aligned. Every bucket takes
 * part — the card folds small shares into "other" for display only, never for this sum.
 */
export function expectationBp(values: PolicyPathDistribution): number {
  let total = 0
  for (const outcome of POLICY_PATH_OUTCOMES) {
    const share = values[outcome]
    if (!Number.isFinite(share)) return Number.NaN
    total += share * POLICY_PATH_BUCKET_BP[outcome]
  }
  return total
}

/**
 * One point of the drawn series: the absolute instant and the five buckets observed then.
 *
 * The axis is deliberately not part of this shape. The stored points are absolute times, and the
 * renderer derives both the axis and its bins, so changing the axis later is a pure drawing change —
 * no migration, and the vertical value never depends on which axis is in force.
 */
export type PolicyPathSeriesPoint = Readonly<{ at: string; values: PolicyPathDistribution }>

/** The most likely bucket, and how likely it is. */
export function leadingOutcome(values: PolicyPathDistribution): { outcome: PolicyPathOutcome; probability: number } {
  return POLICY_PATH_OUTCOMES.reduce((best, outcome) =>
    values[outcome] > best.probability ? { outcome, probability: values[outcome] } : best,
  { outcome: 'no-change' as PolicyPathOutcome, probability: -1 })
}

/**
 * How much of the realised outcome the market had already priced.
 *
 * This is arithmetic about the market, not a judgement about the committee: a hold that was priced
 * at 24% is a large surprise, but calling it "dovish" would assert a motive the data does not carry.
 */
export function verdictOf(pricedShare: number): 'priced' | 'partially-priced' | 'not-priced' {
  if (pricedShare >= 0.6) return 'priced'
  return pricedShare >= 0.3 ? 'partially-priced' : 'not-priced'
}

/** Minutes-old thresholds; a market quote goes stale far faster than a macro release. */
export function stalenessOf(asOf: string, now: string): PolicyPathStaleness {
  const observed = Date.parse(asOf)
  const current = Date.parse(now)
  if (!Number.isFinite(observed) || !Number.isFinite(current)) return 'unavailable'
  const minutes = (current - observed) / 60_000
  if (minutes < -5) return 'unavailable'
  if (minutes <= 15) return 'live'
  if (minutes <= 120) return 'delayed'
  if (minutes <= 7 * 24 * 60) return 'stale'
  return 'unavailable'
}

/** Oldest-to-newest, thinned to at most `limit` points, always keeping the last observation. */
export function thinSeries(series: readonly PolicyPathObservation[], limit: number): readonly PolicyPathObservation[] {
  if (limit < 1 || series.length <= limit) return [...series]
  const step = (series.length - 1) / (limit - 1)
  const picked = Array.from({ length: limit }, (_unused, index) => series[Math.round(index * step)]!)
  picked[picked.length - 1] = series[series.length - 1]!
  return [...new Map(picked.map((observation) => [observation.at, observation])).values()]
}

/**
 * A repricing move worth pointing at, sized so the chip can name it.
 *
 * Only one is ever reported: three chips on a 300px card would be noise, and the reader needs the
 * strongest move, not an inventory. It is a visual hint — it changes no data and triggers nothing.
 */
export type PolicyPathMarker = Readonly<{
  kind: 'repricing' | 'intraday'
  level: 'strong' | 'normal'
  changeInPp: number
}>

export const POLICY_PATH_MARKER_POLICY = Object.freeze({
  /** A move this large is the card's headline; below it the chip is amber. */
  strongRepricingPp: 8,
  repricingPp: 5,
  intradayPp: 3
} as const)

/**
 * The single strongest marker for the leading bucket.
 *
 * The 24-hour window outranks the 6-hour one by design, not by magnitude: the daily move is what a
 * reader means by "repriced", and the intraday row only speaks when the day did not. A series that
 * does not reach back 24 hours falls back to the 6-hour move; a series that reaches back neither
 * reports nothing.
 */
export function repricingMarkers(input: Readonly<{ change24hPp?: number; change6hPp?: number }>): readonly PolicyPathMarker[] {
  const day = input.change24hPp
  if (day !== undefined && Number.isFinite(day)) {
    const size = Math.abs(day)
    if (size >= POLICY_PATH_MARKER_POLICY.strongRepricingPp) return [{ kind: 'repricing', level: 'strong', changeInPp: day }]
    if (size >= POLICY_PATH_MARKER_POLICY.repricingPp) return [{ kind: 'repricing', level: 'normal', changeInPp: day }]
  }
  const sixHours = input.change6hPp
  if (sixHours !== undefined && Number.isFinite(sixHours) && Math.abs(sixHours) >= POLICY_PATH_MARKER_POLICY.intradayPp) {
    return [{ kind: 'intraday', level: 'normal', changeInPp: sixHours }]
  }
  return []
}

/**
 * The four shapes the policy block takes, derived from the decision instant rather than stored.
 *
 * A reading is read at an instant and means something different on each side of the meeting: two
 * weeks out it is a priced meeting, inside the window it is a countdown, on the day it is a
 * settlement against what was priced, and for three days after it is a verdict. Deriving the shape
 * from the clock keeps it from disagreeing with the reader's calendar.
 */
// 阶段判定（会议前 / 落定期 / 常态）搬进 `policyPathPhase.ts`；这里原样转出，调用点不变。
export { POLICY_PATH_PHASE_POLICY, decisionInstant, phaseAt, type PolicyPathPhase } from './policyPathPhase'
export const POLICY_PATH_OUTCOME_ORDER: readonly PolicyPathOutcome[] = Object.freeze([
  'cut-50-plus', 'cut-25', 'no-change', 'hike-25', 'hike-50-plus'
] as const)

/**
 * The realised band implied by a target-range change.
 *
 * The change, not the statement's wording, names the band: the parser already verified both bounds,
 * and anything at or beyond two 25bp steps is the same "50bp or more" bucket the venue quotes.
 */
export function outcomeFromRangeChange(input: Readonly<{
  previous: Readonly<{ lowerPercent: number; upperPercent: number }>
  current: Readonly<{ lowerPercent: number; upperPercent: number }>
}>): PolicyPathOutcome {
  const steps = Math.round((input.current.lowerPercent - input.previous.lowerPercent) / 0.25)
  if (steps >= 2) return 'hike-50-plus'
  if (steps === 1) return 'hike-25'
  if (steps <= -2) return 'cut-50-plus'
  if (steps === -1) return 'cut-25'
  return 'no-change'
}

/**
 * Buckets at or below this share are not worth naming: the card folds them into 其他 and the drawer
 * greys them, so a colour never promises a band the reader was not told about.
 */
export const POLICY_PATH_SHARE_FLOOR = 0.05

/** The buckets above the floor, in the order the surfaces read them. */
export function namedOutcomes(values: PolicyPathDistribution): PolicyPathOutcome[] {
  return POLICY_PATH_OUTCOME_ORDER.filter((outcome) => values[outcome] > POLICY_PATH_SHARE_FLOOR)
}

/** What the realised band was worth against the price one hour before the decision. */
export type PolicyPathSettlement = Readonly<{
  decidedMeetingDate: string
  /** The range the meeting started from, so the move can be read without a second query. */
  previousTargetRange?: Readonly<{ lowerPercent: number; upperPercent: number }>
  actualOutcome: PolicyPathOutcome
  /** The realised band's share in the last observation before the decision. */
  priced?: number
  /** The band that was leading in that same observation. */
  pricedOutcome?: PolicyPathOutcome
  /** That whole distribution, so the drawer can say what else was priced instead of one number. */
  pricedDistribution?: PolicyPathDistribution
  /**
   * Which side of the decision the baseline sits on. `pre-decision` is the honest comparison; the
   * fallback uses the first print after the meeting and says so, so nobody reads it as foresight.
   */
  pricingBasis: 'pre-decision' | 'post-decision'
  /** Hours between the decision and the fallback print; only meaningful for `post-decision`. */
  pricedHoursAfter?: number
  conclusion:
    | Readonly<{ kind: 'priced' }>
    | Readonly<{ kind: 'relative'; direction: 'hawkish' | 'dovish'; surprisePp: number }>
    | Readonly<{ kind: 'unavailable'; reason: 'settlement-pricing-unavailable' }>
  /** The meeting after the decided one; the strip's last row. */
  nextMeeting?: Readonly<{ meetingDate: string; daysUntil: number }>
}>

/**
 * How far the realised band sat from the one the market priced, in probability points.
 *
 * The sign carries the direction, and no motive is asserted: comparing two bands is arithmetic,
 * while calling one of them "dovish" would be a judgement about why the committee moved. A band the
 * market already led with is simply priced.
 */
export function settlementConclusion(input: Readonly<{
  actual: PolicyPathOutcome
  pricedOutcome: PolicyPathOutcome
  pricedShare: number
}>): PolicyPathSettlement['conclusion'] {
  if (input.actual === input.pricedOutcome) return { kind: 'priced' }
  const direction = POLICY_PATH_OUTCOME_ORDER.indexOf(input.actual) > POLICY_PATH_OUTCOME_ORDER.indexOf(input.pricedOutcome)
    ? 'hawkish'
    : 'dovish'
  return { kind: 'relative', direction, surprisePp: Math.round((1 - input.pricedShare) * 1000) / 10 }
}

/** A pp figure as the cards write it: one decimal, and no trailing ".0" on a whole number. */
export function formatPp(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1)
}

/** The same figure with an explicit sign, where the direction is the point of showing it. */
export function formatSignedPp(value: number): string {
  return `${value > 0 ? '+' : ''}${formatPp(value)}`
}

/** The whole distribution `minutes` before the newest observation, when the series reaches back. */
export function distributionAtOrBefore(
  series: readonly PolicyPathObservation[],
  minutes: number
): PolicyPathDistribution | undefined {
  const newest = series.at(-1)
  if (!newest) return undefined
  const target = Date.parse(newest.at) - minutes * 60_000
  let candidate: PolicyPathDistribution | undefined
  for (const observation of series) {
    if (Date.parse(observation.at) <= target) candidate = observation.values
    else break
  }
  return candidate
}

/**
 * 事件标注：那一刻曲线真的动了多少，以及标不标。
 *
 * 三条规则（用户 2026-11-13 定，别放宽）：
 * 1. 窗口内**任何**已发生的事件都可标，不限指标名单——央行讲话与会议往往才是大动作的来源；
 * 2. 只有 |推动量| ≥ 0.5bp 才标；半个点以下读者看不出曲线动过，标了就是噪音；
 * 3. 同一个 ±15 分钟窗口里有多条事件 → **不归因、不标**（宁可少一个圈，不把一次跳变算给两件事）；
 *    一张图最多 5 条，按 |推动量| 取前 5。
 *
 * 推动量 = E(事件后最近一条) − E(事件前最近一条)，两侧都必须落在窗口内；缺一侧就不标。
 * 单位与方向都走期望口径：概率差的正负可以跟期望差相反，图上一律用期望。
 */
/**
 * 允许标注的**概念**清单——判据只有这一张表，按指标身份，不按名字、不按 importance、不按国家。
 *
 * 事件标注解释的是「这条曲线为什么跳」，所以只有**影响美联储路径**的指标才配得上：
 * `importance: high` 是对市场的普遍影响（EIA 原油库存也是 high），两者不是一回事。
 * 这份表是产品口径（`15-事件身份口径.md` §十七），要扩只能扩这里；清单之外的指标无论推动量多大都不标。
 *
 * 按**概念**列，不按码列（M4）：季调/未季调是同一个指标的两个变体，影响程度一样、该不该标也一样。
 * 以前码一变一变体就得回来补一行，漏了就漏标；现在概念把变体全盖住，换码不用动这里。
 */
export const POLICY_PATH_EVENT_RELEVANT_CONCEPTS = Object.freeze([
  'US.CPI.YOY', 'US.CORE_CPI.YOY', 'US.NONFARM.CHANGE', 'US.CORE_PCE.YOY'
] as const)

/**
 * 央行那档：用 `series_id`（发布类型，语言无关）认，不按标题判。
 *
 * 只认两个：**决议**是一次会议的代表，**纪要**有单独时刻可以单独标。
 * 声明 / 发布会 / 点阵图与决议同一时刻，是同一件事的附件，不单独标；票委讲话识别得出但并不值得标。
 */
export const POLICY_PATH_EVENT_RELEVANT_SERIES_IDS = Object.freeze([
  'usa-policy-rate-decision', 'usa-monetary-policy-minutes'
] as const)

/**
 * 同一次发布只允许标一条：同一时刻的多条 measure 按这张表取优先级最高的一条。
 *
 * 不归组的话，CPI 整体年率 / 核心年率 / 月率会在「同窗多条不归因」那步互相挤掉，
 * 结果是曲线明明跳了却一条解释都没有。顺序是产品口径：非农 > 失业率 > 时薪；
 * CPI 整体年率 > 核心年率 > 月率；核心 PCE > 整体 PCE。以后扩清单按同一份文档插进来。
 */
export const POLICY_PATH_EVENT_METRIC_PRIORITY_CONCEPTS = Object.freeze([
  'US.NONFARM.CHANGE',
  'US.CPI.YOY',
  'US.CORE_CPI.YOY',
  'US.CORE_PCE.YOY'
] as const)

export type PolicyPathEventCandidate = Readonly<{
  at: string
  label: string
  /**
   * 主 measure 的身份：**只用来取显示名，不参与资格判断**。
   *
   * 一次发布一行，这一格只装「这条事件叫什么」；它不等于这次发布覆盖的全部指标。
   */
  eventNameKey?: string
  /**
   * 这次发布覆盖的全部 `metric_key`——**资格只看这个列表**。
   *
   * 为什么需要它：一次发布包含多个 measure（CPI 年率/核心年率/月率），写入端一行只存得下一个主
   * measure 的身份。只看 `eventNameKey`，四个必标 key 会在写入时就丢掉，标注永远命中不了。
   */
  measureKeys?: readonly string[]
  /** 发布类型（央行事件）：`usa-policy-rate-decision` / `usa-monetary-policy-minutes`。 */
  seriesId?: string
}>

/**
 * 这次发布覆盖了哪个必标**概念**（按优先级取第一个）；一个都没有就是 `undefined`。
 *
 * 只认 `measureKeys`，**不看 `eventNameKey`、不看名字**——`eventNameKey` 是主 measure 的显示名，
 * 一次发布覆盖多个指标时它只代表其中一个，拿它判资格会把另外几个必标指标整条漏掉。
 *
 * 比较前把每个 measure 归一到概念：这样同一概念的季调/未季调两条行都命中，
 * 不需要在这张清单里为每个变体各留一个兼容位（那正是「换码漏一处」的入口）。
 */
export function matchedRelevantConcept(event: PolicyPathEventCandidate): string | undefined {
  const keys = event.measureKeys ?? []
  return (POLICY_PATH_EVENT_METRIC_PRIORITY_CONCEPTS as readonly string[])
    .find((concept) => keys.some((key) => metricConceptOf(key) === concept))
}

export const POLICY_PATH_EVENT_POLICY = Object.freeze({
  /** 归因窗口：事件前后各 15 分钟。 */
  windowMinutes: 15,
  /** 低于这个推动量不标。 */
  minimumMoveBp: 0.5,
  /** 一张图最多几个标注。 */
  maximumMarks: 5
} as const)

export type PolicyPathExpectationEvent = Readonly<{
  at: string
  label: string
  /** 期望的推动量（bp），带符号。 */
  changeBp: number
  /** 标注处曲线的高度：事件前最近一条的期望（bp）。 */
  bp: number
}>

export function expectationEventMoves(
  series: readonly PolicyPathObservation[],
  events: readonly PolicyPathEventCandidate[]
): readonly PolicyPathExpectationEvent[] {
  const oldest = series[0]
  const newest = series[series.length - 1]
  if (!oldest || !newest) return []
  const windowMs = POLICY_PATH_EVENT_POLICY.windowMinutes * 60_000
  // 第一步：清单之外一律不标（判据只有指标身份 / 发布类型，不看名字、不看 importance）。
  // 没有身份的行（例如今天 0xRouter 的行没有 series_id）即使名字百分百像 FOMC 决议，也不标。
  const relevant = events.filter((event) =>
    matchedRelevantConcept(event) !== undefined
    || (event.seriesId !== undefined && (POLICY_PATH_EVENT_RELEVANT_SERIES_IDS as readonly string[]).includes(event.seriesId)))
  // 第二步：同一时刻（同一次发布）只留优先级最高的一条。
  const rankOf = (event: PolicyPathEventCandidate): number => {
    if (event.seriesId === 'usa-policy-rate-decision') return -1
    const concept = matchedRelevantConcept(event)
    return concept === undefined ? Number.MAX_SAFE_INTEGER
      : (POLICY_PATH_EVENT_METRIC_PRIORITY_CONCEPTS as readonly string[]).indexOf(concept)
  }
  const byInstant = new Map<string, PolicyPathEventCandidate>()
  for (const event of relevant) {
    const previous = byInstant.get(event.at)
    if (!previous) {
      byInstant.set(event.at, event)
      continue
    }
    if (rankOf(event) < rankOf(previous)) byInstant.set(event.at, event)
  }
  const candidates: Array<PolicyPathExpectationEvent & Readonly<{ atMs: number }>> = []
  for (const event of byInstant.values()) {
    const atMs = Date.parse(event.at)
    if (!Number.isFinite(atMs)) continue
    let before: PolicyPathObservation | undefined
    let after: PolicyPathObservation | undefined
    for (const observation of series) {
      const observedAt = Date.parse(observation.at)
      if (!Number.isFinite(observedAt)) continue
      if (observedAt <= atMs) {
        if (atMs - observedAt <= windowMs) before = observation
      } else if (observedAt - atMs <= windowMs) {
        // 有序序列里第一条落在窗口后的就是「事件后最近一条」。
        after = observation
        break
      }
    }
    if (!before || !after) continue
    const changeBp = changeInBp(expectationBp(after.values), expectationBp(before.values))
    if (Math.abs(changeBp) < POLICY_PATH_EVENT_POLICY.minimumMoveBp) continue
    candidates.push({ at: event.at, atMs, label: event.label, changeBp, bp: expectationBp(before.values) })
  }
  // 竞争归因：两条事件的窗口重叠（相隔不到 2 个窗口）就都不标。
  const attributed = candidates.filter((candidate) => candidates.every((other) =>
    other === candidate || Math.abs(other.atMs - candidate.atMs) >= 2 * windowMs))
  return attributed
    .sort((left, right) => Math.abs(right.changeBp) - Math.abs(left.changeBp))
    .slice(0, POLICY_PATH_EVENT_POLICY.maximumMarks)
    .sort((left, right) => left.atMs - right.atMs)
    .map(({ atMs: _atMs, ...mark }) => mark)
}

/** The value that was in force `minutes` before the newest observation, if the series reaches back. */
export function valueAtOrBefore(series: readonly PolicyPathObservation[], outcome: PolicyPathOutcome, minutes: number): number | undefined {
  const newest = series.at(-1)
  if (!newest) return undefined
  const target = Date.parse(newest.at) - minutes * 60_000
  let candidate: number | undefined
  for (const observation of series) {
    if (Date.parse(observation.at) <= target) candidate = observation.values[outcome]
    else break
  }
  return candidate
}
