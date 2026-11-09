import type { JobRuntime } from '@platform/jobs'

import type { EventBusRuntime } from '../contracts/eventBusContracts'

export const eventBusRetentionJobId = 'platform.eventBusRetention'

/**
 * 事件总线的保留期任务（`MI-11-R16`：写侧原先无上限）。
 *
 * 实测本机文件 2,953 条 / 2.63 MiB、174 条/天；按这个速率 90 天会到 17.6 MiB，且每次启动
 * 整份读、整份写回。保留期规则只在 `pruneEventBusState` 实现一次，这里只负责「每天叫它一次」。
 *
 * 传 thunk 而不是实例：任务注册发生在组合根，运行时是懒构造的单例，thunk 让注册顺序不影响结果，
 * 用例也能注入假实现。`pending` 投递及其事件不会被裁——重启后要靠它们重放。
 */
export type EventBusRetentionTarget = Readonly<{
  pruneRetained: () => Promise<{ removedEvents: number; removedDeliveries: number }>
}>

export function registerEventBusRetentionJob(
  jobRuntime: JobRuntime,
  deps: Readonly<{ eventBus: () => EventBusRetentionTarget; timeZone: () => string }>
): void {
  jobRuntime.registerHandler(eventBusRetentionJobId, async (_payload, context) => {
    const { removedEvents, removedDeliveries } = await deps.eventBus().pruneRetained()
    await context.log({
      level: 'info',
      message: `Event bus retention: ${removedEvents} event(s), ${removedDeliveries} delivery record(s) removed.`
    })
  })

  jobRuntime.setSchedule({
    id: eventBusRetentionJobId,
    owner: 'platform',
    handlerId: eventBusRetentionJobId,
    title: { 'zh-CN': '清理事件总线记录', 'en-US': 'Event bus retention' },
    audience: 'internal' as const,
    // 凌晨跑，避开用户活跃时段；排在缓存审计（03:50）之后，两个保留期任务不挤在同一分钟。
    trigger: { kind: 'cron', expression: '55 3 * * *', timezone: deps.timeZone() },
    payload: {}
  })
}

/** 运行时实例满足这个形状；调用点不必再断言一次。 */
export function eventBusRetentionTarget(runtime: EventBusRuntime): EventBusRetentionTarget {
  return { pruneRetained: () => runtime.pruneRetained() }
}
