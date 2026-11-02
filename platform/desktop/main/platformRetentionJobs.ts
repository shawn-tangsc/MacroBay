import type { JobRuntime } from '@platform/jobs'

import type { AssistantPlatformDatabase } from '../../ai/assistant-platform/db/createAssistantPlatformDatabase'
import { createRetentionRepository } from '../../ai/assistant-platform/repositories/retentionRepository'
import { registerAssistantSessionRetentionJob } from '../../ai/assistant-platform/retention/registerAssistantSessionRetentionJob'
import type { NotificationRuntime } from '../../notifications/runtime/notificationRuntime'
import { registerNotificationRetentionJob } from '../../notifications/jobs/notificationRetentionJob'

export type PlatformRetentionInput = Readonly<{
  jobRuntime: JobRuntime
  assistantDatabase: AssistantPlatformDatabase
  /** 通知运行时由组合根传进来；这里不 import 单例，否则任务注册会依赖 IPC 装配层。 */
  notificationRuntime: NotificationRuntime
  /** 读者时区：保留期按「读者的一天」算，不按机器时区。 */
  timeZone: () => string
}>

/**
 * 平台自己拥有的保留期任务：会话历史与通知记录。
 *
 * 两处都挂在同一个 `@platform/jobs` 运行时上，都不许自造定时器。放在这里而不是 `app.ts`，
 * 是因为 `app.ts` 是受保护的装配接缝：每加一个平台任务就在里面多五行，久了没人看得出
 * 这些行属于同一个概念。这里一个函数说清「平台有哪些保留期任务」。**已知还有两类清理没有收进来**：任务自动化的维护与任务运行记录仍是进程级定时器（`app.ts` 里 `scheduleTaskAutomationMaintenance` / `scheduleJobRunRetention`），收敛后也应从这里接入。
 */
export function registerPlatformRetentionJobs(input: PlatformRetentionInput): void {
  registerAssistantSessionRetentionJob(input.jobRuntime, {
    repo: createRetentionRepository(input.assistantDatabase)
  })
  registerNotificationRetentionJob(input.jobRuntime, {
    runtime: () => input.notificationRuntime,
    timeZone: input.timeZone
  })
}
