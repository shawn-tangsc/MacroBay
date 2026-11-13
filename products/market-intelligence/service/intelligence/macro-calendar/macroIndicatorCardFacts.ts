import { narwhalMeasureMetricKeys, zeroXRouterIndicatorIdentities } from './marketCalendarMetricIdentity'

/**
 * 三张关键指标卡的取值事实——**按身份取，不按名字、不按标题**。
 *
 * 取值链（用户 2026-11-13 定）：
 * 1. 该 `metric_key` 最新一次**已发布**的值；
 * 2. Narwhal 有该 measure 的值 → 用 Narwhal；
 * 3. Narwhal 没有（今天 per-measure 的 `actual` 还没入库）→ **回退旧源同身份的值**；
 * 4. 两边都没有 → 才是「未提供」。
 *
 * 两条禁令来自实测：不许拿发布行的 `actual` 冒充同一发布里的另一个 measure——
 * CPI 那行的 `actual` 是核心月率 0.3，CPI 年率是 3.7；就业那行的主 measure 是政府就业。
 * 所以一行只有在「它的主身份就是这个 key」或「它带了这个 measure 的值」时才算数。
 */
export const MACRO_INDICATOR_CARD_KEYS = Object.freeze([
  'US.CPI.NSA.YOY', 'US.CORE_CPI.NSA.YOY', 'US.NONFARM.SA.CHANGE', 'US.CORE_PCE.NSA.YOY',
  // 新增就业卡里那一行「失业率」：值就在同一条非农发布行里（`unemployment_rate`），
  // 不另开一次读。之前这一格显示「未提供」，那不是没数据，是我们没取。
  'US.UNEMPLOYMENT.SA.RATE'
] as const)

export type MacroIndicatorCardKey = typeof MACRO_INDICATOR_CARD_KEYS[number]

export type MacroIndicatorCardRow = Readonly<{
  provider: 'narwhal' | '0xrouter'
  /** 这次发布覆盖的全部 metric_key（Narwhal 的 `measure_keys`；旧源按 indicator_id 映射）。 */
  measureKeys: readonly string[]
  /** 主 measure 的身份：这一行的 `actual` 属于它。 */
  primaryMetricKey?: string
  /** per-measure 的值（Narwhal 落库后才有）。 */
  measureValues?: Readonly<Record<string, number>>
  /** 旧源的单值：`provider_actual_json` 解析出来的数。 */
  value?: number
  /**
   * **首发布时的上一期实际值**（旧源的 `provider_previous`）。
   *
   * 不是来源当前的 `previous`：非农那次首发布上期是 29，修订后是 60，两者不能换着用
   * （用 60 会把「较上期（未修正）+136K」算成 +105K）。
   */
  previousAsPublished?: number
  /** 来源问卷给的「预期」原文值，以及它在哪一刻被观测到、由哪个来源给（三样齐全才带得出去）。 */
  consensus?: number
  consensusAsOf?: string
  period?: string
  releasedAt: string
  unit?: 'percent' | 'thousands'
}>

export type MacroIndicatorCardFact = Readonly<{
  metricKey: MacroIndicatorCardKey
  /**
   * `provided`：取到了值；`missing-current`：发布了但没有这一期的值；
   * `not-recorded`：库里没有这个指标的任何发布行（不是「没发布」，是「没收录」）。
   */
  state: 'provided' | 'missing-current' | 'not-recorded'
  period?: string
  releasedAt?: string
  value?: number
  /** 首发布时的上一期实际值；缺它就不能显示「较上期」，也不许拿修订值顶。 */
  previousAsPublished?: number
  /** 上一期那个数从哪来：官方序列（FRED）还是日历库；以及它的观测时刻。 */
  previousSource?: 'fred' | 'release'
  previousObservedAt?: string
  /** 官方序列**读不到**（不是「没有值」）：那一格要说「暂时读不到」，不许拿旧数字冒充。 */
  previousUnreadable?: boolean
  /**
   * 共识：**五元组**（值 + 期次 + `asOf` + 出处 + 盘口才要的成交量）。今天是商业源问卷这一档。
   * 期次在 `period` 上——缺它就不带出去（那会变成一个「看起来像答案的数」）。
   */
  consensus?: Readonly<{
    value: number
    provenance: 'source-survey'
    asOf: string
  }>
  /**
   * **下一期**：排期只从日历那一处来（`nextReleaseFor`），盘口共识只对还没发布的那一期有意义。
   *
   * 与本期 `consensus` 分成两块，不是为了字段好看：盘是「下一期」的盘，塞进本期那一格，
   * 就是把 10 月的实际配上 11 月的预期——今天反复出的期次错位。
   */
  next?: Readonly<{
    period: string
    releaseAt: string
    /** 盘口反推的共识：有盘才有，成交量也在里面。 */
    consensus?: Readonly<{ value: number; provenance: 'market-implied'; asOf: string; marketVolume: number }>
    /** 没有值的原因：`no-market` 是真的没盘；`unreadable` 是读失败，要说「暂时读不到」。 */
    consensusState?: 'no-market' | 'unreadable'
  }>
  unit?: 'percent' | 'thousands'
  source?: 'narwhal' | '0xrouter' | 'fred'
}>

/** 旧源的 `indicator_id` → 我们规范 key 的反查（同一张表，不另写一份）。 */
export function legacyIndicatorIdsByMetricKey(metricKey: string): readonly string[] {
  return Object.entries(zeroXRouterIndicatorIdentities)
    .filter(([, entry]) => entry.metricKey === metricKey)
    .map(([indicatorId]) => indicatorId)
}

/**
 * 规范 key → 新源 `measure` 的反查（同一张表，不另写一份）。
 *
 * 那张表是双射（128 measure ↔ 128 key），所以反查唯一；查不到就没有新源口径。
 */
export function narwhalMeasuresByMetricKey(metricKey: string): readonly string[] {
  return Object.entries(narwhalMeasureMetricKeys)
    .filter(([, mapped]) => mapped === metricKey)
    .map(([measure]) => measure)
}

/** 同一时刻两个源都有一行时取新源；其余取更晚的那条。 */
/** 共识必须有值 + 观测时刻 + 出处名；缺一样就不带出去——半个共识比没有更像答案。 */
function consensusOf(row: MacroIndicatorCardRow): Partial<Pick<MacroIndicatorCardFact, 'consensus'>> {
  // 出处 = 这一行的 provider（`fact.source`），不在这里再写一个源名。
  if (row.consensus === undefined || row.consensusAsOf === undefined) return {}
  if (row.period === undefined) return {}
  return { consensus: Object.freeze({ value: row.consensus, provenance: 'source-survey' as const, asOf: row.consensusAsOf }) }
}

function latestRow(rows: readonly MacroIndicatorCardRow[]): MacroIndicatorCardRow | undefined {
  return rows.reduce<MacroIndicatorCardRow | undefined>((best, row) => {
    if (!best) return row
    const mine = Date.parse(row.releasedAt)
    const theirs = Date.parse(best.releasedAt)
    if (mine > theirs) return row
    return mine === theirs && row.provider === 'narwhal' ? row : best
  }, undefined)
}

/**
 * 一个 key 的取值：Narwhal 的 per-measure 值优先，其次旧源同身份的值，最后如实说缺什么。
 *
 * 「发布行覆盖了这个 key 但值属于别的 measure」→ 不算取到值；这正是今天 CPI/就业的情形，
 * 不许用主 measure 的数去顶。
 */
export function resolveMacroIndicatorFact(
  metricKey: MacroIndicatorCardKey,
  rows: readonly MacroIndicatorCardRow[]
): MacroIndicatorCardFact {
  const covering = rows.filter((row) => row.measureKeys.includes(metricKey))
  const narwhalValue = latestRow(covering.filter((row) =>
    row.provider === 'narwhal' && row.measureValues?.[metricKey] !== undefined))
  if (narwhalValue) {
    return {
      metricKey, state: 'provided', source: 'narwhal',
      ...(narwhalValue.period === undefined ? {} : { period: narwhalValue.period }),
      releasedAt: narwhalValue.releasedAt,
      value: narwhalValue.measureValues![metricKey]!,
      ...(narwhalValue.previousAsPublished === undefined ? {} : { previousAsPublished: narwhalValue.previousAsPublished }),
      ...consensusOf(narwhalValue),
      ...(narwhalValue.unit === undefined ? {} : { unit: narwhalValue.unit })
    }
  }
  // 旧源：只有「这一行的主身份就是这个 key」的单值才算这个指标的值。
  const legacy = latestRow(covering.filter((row) =>
    row.provider === '0xrouter' && row.value !== undefined && row.primaryMetricKey === metricKey))
  if (legacy) {
    return {
      metricKey, state: 'provided', source: '0xrouter',
      ...(legacy.period === undefined ? {} : { period: legacy.period }),
      releasedAt: legacy.releasedAt,
      value: legacy.value!,
      ...(legacy.previousAsPublished === undefined ? {} : { previousAsPublished: legacy.previousAsPublished }),
      ...consensusOf(legacy),
      ...(legacy.unit === undefined ? {} : { unit: legacy.unit })
    }
  }
  const latestCovering = latestRow(covering)
  if (latestCovering) {
    // 发布了，但这一期没有这个 measure 的值——值级缺失，不是没有这条发布。
    // 这一期没有值，但上一期的实际值仍要带出来（CPI 2026-10：本期空、上一期 3.7%）。
    const withPrevious = latestRow(covering.filter((row) => row.previousAsPublished !== undefined))
    // 期次可能只挂在另一源那一行上（新源发布行不带期次，旧源同身份行带）：取**任何一行有期次的那期**。
    const withPeriod = latestRow(covering.filter((row) => row.period !== undefined))
    const period = latestCovering.period ?? withPeriod?.period
    return {
      metricKey, state: 'missing-current',
      ...(period === undefined ? {} : { period }),
      releasedAt: latestCovering.releasedAt,
      ...(withPrevious?.previousAsPublished === undefined ? {} : { previousAsPublished: withPrevious.previousAsPublished }),
      ...consensusOf(latestCovering)
    }
  }
  return { metricKey, state: 'not-recorded' }
}

export function resolveMacroIndicatorFacts(rows: readonly MacroIndicatorCardRow[]): readonly MacroIndicatorCardFact[] {
  return MACRO_INDICATOR_CARD_KEYS.map((key) => resolveMacroIndicatorFact(key, rows))
}
