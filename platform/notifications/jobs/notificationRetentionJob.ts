import type { JobRuntime } from '@platform/jobs'

export const notificationRetentionJobId = 'platform.notificationsRetention'

/**
 * 清理通知记录所需的最小能力面。
 *
 * 传 thunk 而不是实例：通知运行时在 `registerIpcHandlers` 里才配置好，而 job 运行时更早创建；
 * 用 thunk 让注册顺序不影响结果，也让测试可以注入一个假实现。
 */
export type NotificationRetentionTarget = Readonly<{
  prune: () => Promise<{ removedRecords: number }>
}>

/**
 * 通知保留期清理。挂在 `@platform/jobs` 上，不自造定时器。
 *
 * 时间上限与条数上限都在 `pruneNotificationRecords` 里一次算完；这里只负责「什么时候跑」
 * 和「跑完记一行」，不重复实现裁剪规则。
 */
export function registerNotificationRetentionJob(
  jobRuntime: JobRuntime,
  deps: Readonly<{ runtime: () => NotificationRetentionTarget; timeZone: () => string }>
): void {
  jobRuntime.registerHandler(notificationRetentionJobId, async (_payload, context) => {
    const { removedRecords } = await deps.runtime().prune()
    await context.log({
      level: 'info',
      message: `Notification retention: ${removedRecords} record(s) removed.`
    })
  })

  jobRuntime.setSchedule({
    id: notificationRetentionJobId,
    owner: 'platform',
    handlerId: notificationRetentionJobId,
    title: 'Notification retention',
    visibility: 'internal' as const,
    // 凌晨跑，避开用户活跃时段；时区取读者时区，和「运行语义跟设置时区」一致。
    trigger: { kind: 'cron', expression: '40 3 * * *', timezone: deps.timeZone() },
    payload: {}
  })
}
