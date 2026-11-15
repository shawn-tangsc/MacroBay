import type { MarketCalendarEvent } from '../../../contracts/macro/marketCalendarQueryContracts'
import type { BriefingMacroItem } from '../../../contracts/dailyBriefing'

/**
 * 标准表的发布状态 → 简报宏观行自己的生命周期与「值是否该显示」。
 *
 * 切到标准表之后，简报不能再按「有没有 `providerActual`」猜状态（取消的行也会因此被说成排期），
 * 必须读源给的 `releaseStatus`。这条映射是纯函数、先于接线写好：五态（`待发布`/`已发布`/
 * `待补值`/`未提供`/`已取消`）落地时，这里只多两行默认分支，不牵动渲染。
 *
 * 两条硬规则：
 * 1. **只认 `published` 为已发布**——`backfilling` / `missing` / `unknown` / 缺省都**不是**已发布，
 *    也不显示值；「过期了还当没发」正是今晚那个 bug。
 * 2. **认不出的新状态落到「未发布」**：宁可少说一句「已发布」，不许把没值的行说成有值。
 */
export type BriefingMacroLifecycle = BriefingMacroItem['lifecycleState']

export type BriefingMacroReleaseLifecycle = Readonly<{
  lifecycleState: BriefingMacroLifecycle
  /** 只有真拿到实际值的那一档才显示值格；其它一律不渲染（不是填破折号）。 */
  valueVisible: boolean
}>

export function briefingMacroReleaseLifecycle(
  releaseStatus: MarketCalendarEvent['releaseStatus'] | undefined
): BriefingMacroReleaseLifecycle {
  if (releaseStatus === 'published') return Object.freeze({ lifecycleState: 'released', valueVisible: true })
  if (releaseStatus === 'cancelled') return Object.freeze({ lifecycleState: 'cancelled', valueVisible: false })
  // scheduled / unknown / 缺省 / 将来的 backfilling / missing：都还没有可显示的实际值。
  return Object.freeze({ lifecycleState: 'scheduled', valueVisible: false })
}
