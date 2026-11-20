import { isBlsOfficialCalendarUnavailable } from './bls-schedule-catch-up/blsOfficialCalendarAvailability'

/**
 * 读者主列表的投影条件：哪些官方事件**现在**不该占着列表。
 *
 * 起因是读者点到的 11-10「核心 CPI」：BLS 那行是**空壳**——没有 `scheduled_at`、没有实际值、
 * 没有预期值，界面于是把按惯例推算的时刻当成发布时间印了出来。同一天 0xRouter 有同一场发布、
 * 带时刻与前值。两行放在一起，读者点到的那条正好是空的。
 *
 * 判据不是「BLS 这个名字不该出现」，而是**这一条是不是只有 BLS 一家在说、而 BLS 现在读不到**：
 * - 只有 BLS 一家的空壳 → 不投进主列表（数据不删、采集不停）；
 * - 任何一家别家也在说的事实 → 照常显示（别家给得出时刻与数值）；
 * - BLS 恢复后 → 自动回来，因为判据读的是可用性状态，不是一张写死的名单。
 *
 * `blsUnavailable` 可注入，只为一件事：让「切回可用」这条能被用例证明，而不是靠改常量再跑一遍。
 */
const BLS_PROVIDER_ID = 'macro-calendar-bls'

export type ReaderProjectableEvent = Readonly<{
  providerIds: readonly string[]
  scheduledAt?: string
  actual?: unknown
  consensus?: unknown
}>

/**
 * 「空壳」= 没有确切发布时刻、也没有任何数值（实际值、预期值都空）。
 *
 * 只把**空壳**移出主列表，不按来源一刀切：BLS 上一次成功同步（2026-10-22）之前的历史行是有数值的，
 * 那些不该因为「现在读不到」就从列表上消失——那等于把历史一并藏掉。
 */
function isShell(event: ReaderProjectableEvent): boolean {
  if (typeof event.scheduledAt === 'string' && event.scheduledAt !== '') return false
  return event.actual == null && event.consensus == null
}

export function projectReaderVisibleEvents<T extends ReaderProjectableEvent>(
  events: readonly T[],
  blsUnavailable: boolean = isBlsOfficialCalendarUnavailable()
): readonly T[] {
  if (!blsUnavailable) return events
  return events.filter((event) => {
    const providers = event.providerIds
    // 没有来源信息的事件不是「只有 BLS 在说」，不能顺手丢掉。
    if (providers.length === 0) return true
    if (!providers.every((providerId) => providerId === BLS_PROVIDER_ID)) return true
    return !isShell(event)
  })
}
