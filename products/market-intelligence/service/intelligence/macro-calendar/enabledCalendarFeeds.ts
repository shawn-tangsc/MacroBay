import { zeroXRouterCalendarSchedulerFeeds } from './0xrouter-calendar/zeroXRouterCalendarScheduler'

/**
 * 自动日历任务该刷哪些 feed：**只刷读者没关掉的那些**，没建过档案的默认开。
 *
 * 放在日历域里而不是装配根：这是一条日历规则（「没有档案 ≠ 关掉了」），装配根只该把源接上。
 * 每加一条 feed 只改这里一处，不必再进两百行的 registerServices 里找。
 *
 * **两个读取器不能互相顶替**（2026-11-16）：`createEnabledCalendarFeeds` 读的是通用自动采集
 * 名单，0xrouter 三路故意不在那个名单里（它们的采集由日历线自己的调度器拥有）；拿它去喂
 * 0xrouter 调度器，三路会被「正常地」判成关闭，一条作业都不注册。
 */

export const AUTOMATIC_CALENDAR_FEED_IDS: readonly string[] = Object.freeze([
  // Narwhal 一次采集写三类：自动刷新只认拥有作业的这条，另两条由它覆盖。
  'macro-calendar-narwhal-economic-data'
])

/**
 * **0xrouter 三路自己的启用读取器**（2026-11-16）。
 *
 * 不能复用 `createEnabledCalendarFeeds`：那个的语义是「通用自动采集名单」
 * （`AUTOMATIC_CALENDAR_FEED_IDS`），而 0xrouter 三路**故意不在那个名单里**——它们的采集由
 * 日历线自己的调度器拥有。复用它，调度器拿到的启用集合里永远没有那三个 sourceId，
 * 于是每一路都走 `removeSchedule`，一条作业都不注册、也不留 warn（「正常地认为这三路是关的」）。
 * 这正是用户重启两次后「打开着却什么都没有」的原因。
 */
export function createEnabledZeroXRouterFeeds(deps: Readonly<{
  listProfiles: () => Promise<readonly Readonly<{ sourceId: string; enabled: boolean }>[]>
}>): () => Promise<readonly string[]> {
  return async () => {
    const profiles = await deps.listProfiles()
    const byId = new Map(profiles.map((profile) => [profile.sourceId, profile.enabled]))
    // 没建过档案默认开：与日历域既有口径一致（「没有档案 ≠ 关掉了」）。
    return zeroXRouterCalendarSchedulerFeeds.map((feed) => feed.sourceId).filter((id) => byId.get(id) !== false)
  }
}

export function createEnabledCalendarFeeds(deps: Readonly<{
  listProfiles: () => Promise<readonly Readonly<{ sourceId: string; enabled: boolean }>[]>
}>): () => Promise<readonly string[]> {
  return async () => {
    const profiles = await deps.listProfiles()
    const byId = new Map(profiles.map((profile) => [profile.sourceId, profile.enabled]))
    return AUTOMATIC_CALENDAR_FEED_IDS.filter((id) => byId.get(id) !== false)
  }
}
