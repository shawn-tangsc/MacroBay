import {
  isMarketCalendarFreshness,
  type MarketCalendarFreshness,
  type MarketCalendarPage
} from '../../../contracts/macro/marketCalendarQueryContracts'

/**
 * 0xRouter 日历的读面：一个月读者、一个新鲜度读者，**绑定一次**。
 *
 * 两者来自同一个运行时、在装配根同一点绑定，所以放在一起——门只有一扇。新鲜度是**转发**：
 * 天数与「最后一次成功」由日历运行时算（多来源里最旧的那个），这里不再算一遍。
 *
 * 两种失败都答 `unavailable`：从没绑过（装配缺口），以及绑了但抛错或返回合同不认的形状（运行期失败）。
 * 下游都只能读成「读不到」，**任何一条都不许变成「没有」**——那正是这个方法存在的原因。
 */
export type MarketCalendarBinding = Readonly<{
  queryMonth: (input: unknown) => MarketCalendarPage
  readCollectionFreshness?: () => Promise<unknown>
}>

export type MarketCalendarReadSurface = Readonly<{
  queryMonth: (input: unknown) => MarketCalendarPage
  bind: (query: MarketCalendarBinding | undefined) => void
  freshness: () => Promise<MarketCalendarFreshness>
}>

export function createMarketCalendarReadSurface(initial?: MarketCalendarBinding): MarketCalendarReadSurface {
  let binding = initial
  return {
    queryMonth: (input) => binding?.queryMonth(input) ?? ({ state: 'unavailable', failureCode: 'query-unavailable' }),
    bind(query) {
      binding = query
    },
    async freshness() {
      const reader = binding?.readCollectionFreshness
      // ① 没有绑定，或绑定里没有这个读者：装配根从没把日历运行时交过来。
      if (!reader) return { state: 'unavailable' as const, failureCode: 'query-unavailable' as const }
      // ② 绑了但抛错、或返回合同不认的形状：与 ① 分开判，因为修法不同；读者看到的都是「读不到」。
      try {
        const value = await reader()
        if (isMarketCalendarFreshness(value)) return value
      } catch {}
      return { state: 'unavailable' as const, failureCode: 'query-unavailable' as const }
    }
  }
}
