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
  /** 被收进「另有 N 条」的条数；为 0 时界面不画那一行。 */
  hiddenCount: number
}>

export function filterVisibleByTier<T>(input: readonly TierVisibilityInput<T>[]): TierVisibilityResult<T> {
  const visible: T[] = []
  let hiddenCount = 0
  for (const entry of input) {
    const tier = tierOfMetricKey(entry.metricKey)
    if (tier === 1 || tier === 2) { visible.push(entry.item); continue }
    hiddenCount += 1
  }
  return { visible, hiddenCount }
}
