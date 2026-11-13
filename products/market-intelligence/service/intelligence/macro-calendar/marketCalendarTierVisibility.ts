import { tierOfMetricKey } from './marketCalendarReleaseGroups'

/**
 * 日历页与右列按分级收窄可见条目：**只显示一级、二级**，未标级的收进一行计数。
 *
 * 两条不能被绕过的规则：
 * 1. **不许静默隐藏**：未标级的条目被过滤掉时，必须给出计数，界面下面留一行
 *    「另有 N 条未标记级别的发布」，点开能看到。否则读者会以为那天只有几条，而实际有二十多条。
 * 2. **一级/二级不许被误过滤**：判据只看码的分级，不看有没有值、是不是事件型——
 *    就业组那 12 个身份每天都能拿来验（非农、失业率、时薪都是一级）。
 *
 * 事件型行（`evt.*`）与没有码的行（源内身份）都算「未标级」：分级标的是指标码，讲话没有码。
 * 这不是遗漏，是它们本来就不参与分级——所以它们进计数行，而不是被当成「一级」显示。
 */
export type TierVisibilityInput<T> = Readonly<{ metricKey: string; item: T }>

export type TierVisibilityResult<T> = Readonly<{
  visible: readonly T[]
  /** 超出显示上限的**一级/二级/决议类事件**条数：折进数字里也不能丢——那是一条重要数据。 */
  hiddenTiered: number
  /** 未分级条数（含事件型与源内身份行）。 */
  hiddenUntiered: number
  /**
   * 格子里的数字 = `hiddenTiered + hiddenUntiered` = **当天总条数 − 已显示条数**。
   * 这个恒等式是判据：拿「未分级条数」去填这个数字，就会出现「总数 5、显示 2、数字 3」而
   * 其中一条其实是一级——这类错在月历上肉眼永远看不出来。
   */
  hiddenTotal: number
}>

/**
 * 决议类事件码：**不是指标、没有分级，但读者靠它知道「今天有没有议息」**（Chief 2026-11-14 定）。
 *
 * 判据是这张**显式清单**，不是「有没有指标码」也不是事件类型名——按类型猜会把讲话、
 * 库存、抵押贷款申请一起放进来，格子里又会被名字灌满。要新增决议类事件，就往这里加一行。
 */
export const calendarDecisionEventMetricKeys: readonly string[] = Object.freeze([
  'evt.fomc',
  'evt.policy-rate-decision',
  'evt.monetary-policy-statement'
])

export function isDecisionEventMetricKey(metricKey: string): boolean {
  return calendarDecisionEventMetricKeys.includes(metricKey)
}

/**
 * 旧路径的官方条目没有事件码，只有 `titleKey`（`fomc` / `cpi` …）。决议类这一条按同一张清单
 * 落到事件码上，所以「哪些事件能露名字」仍然只有一处定义。
 */
export function decisionEventMetricKeyForTitleKey(titleKey: string): string | undefined {
  return titleKey === 'fomc' ? 'evt.fomc' : undefined
}

export const tierVisibilityPolicy = Object.freeze({
  /** 一天在格子里最多显示几条一级/二级：再多名字会把格子撑破。 */
  maximumVisible: 2
})

/**
 * 收窄规则（日历格子用）：**只写一级、二级指标与决议类事件的名字，且最多 `maximumVisible` 条**；
 * 其余（未标级的 + 一二级里超出的）**全部计入数字**，一个都不许静默消失。
 *
 * 顺序保持原样，不在这里排序：排序是读取侧的事，这里只决定「谁露名字、谁进数字」。
 */
export function filterVisibleByTier<T>(input: readonly TierVisibilityInput<T>[],
  options?: Readonly<{ maximumVisible?: number }>): TierVisibilityResult<T> {
  const maximum = Math.max(0, options?.maximumVisible ?? tierVisibilityPolicy.maximumVisible)
  const visible: T[] = []
  let hiddenTiered = 0
  let hiddenUntiered = 0
  for (const entry of input) {
    const tier = tierOfMetricKey(entry.metricKey)
    // 一级、二级指标，以及决议类事件（清单在上面）：其余一律进数字。
    const tiered = tier === 1 || tier === 2 || isDecisionEventMetricKey(entry.metricKey)
    if (tiered && visible.length < maximum) { visible.push(entry.item); continue }
    if (tiered) hiddenTiered += 1
    else hiddenUntiered += 1
  }
  return { visible, hiddenTiered, hiddenUntiered, hiddenTotal: hiddenTiered + hiddenUntiered }
}
