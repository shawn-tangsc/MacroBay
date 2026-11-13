import { zeroXRouterIndicatorIdentities } from './marketCalendarMetricIdentity'

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
  'US.CPI.NSA.YOY', 'US.CORE_CPI.NSA.YOY', 'US.NONFARM.SA.CHANGE', 'US.CORE_PCE.NSA.YOY'
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
  unit?: 'percent' | 'thousands'
  source?: 'narwhal' | '0xrouter'
}>

/** 旧源的 `indicator_id` → 我们规范 key 的反查（同一张表，不另写一份）。 */
export function legacyIndicatorIdsByMetricKey(metricKey: string): readonly string[] {
  return Object.entries(zeroXRouterIndicatorIdentities)
    .filter(([, entry]) => entry.metricKey === metricKey)
    .map(([indicatorId]) => indicatorId)
}

function latestRow(rows: readonly MacroIndicatorCardRow[]): MacroIndicatorCardRow | undefined {
  return rows.reduce<MacroIndicatorCardRow | undefined>((best, row) => {
    if (!best) return row
    return Date.parse(row.releasedAt) > Date.parse(best.releasedAt) ? row : best
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
      ...(legacy.unit === undefined ? {} : { unit: legacy.unit })
    }
  }
  const latestCovering = latestRow(covering)
  if (latestCovering) {
    // 发布了，但这一期没有这个 measure 的值——值级缺失，不是没有这条发布。
    // 这一期没有值，但上一期的实际值仍要带出来（CPI 2026-10：本期空、上一期 3.7%）。
    const withPrevious = latestRow(covering.filter((row) => row.previousAsPublished !== undefined))
    return {
      metricKey, state: 'missing-current',
      ...(latestCovering.period === undefined ? {} : { period: latestCovering.period }),
      releasedAt: latestCovering.releasedAt,
      ...(withPrevious?.previousAsPublished === undefined ? {} : { previousAsPublished: withPrevious.previousAsPublished })
    }
  }
  return { metricKey, state: 'not-recorded' }
}

export function resolveMacroIndicatorFacts(rows: readonly MacroIndicatorCardRow[]): readonly MacroIndicatorCardFact[] {
  return MACRO_INDICATOR_CARD_KEYS.map((key) => resolveMacroIndicatorFact(key, rows))
}
