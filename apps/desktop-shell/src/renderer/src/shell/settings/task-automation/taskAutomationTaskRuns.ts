import type { ScheduledTaskEntity } from '@platform/ai/agent-platform/schemas/taskSchemas'

import { getTaskDeliveryAttemptsViaApi, getTaskLogsViaApi } from '../../agents/agentTaskDataApi'
import {
  collectDeliverySkipReasons,
  countDeliveryHealth,
  type TaskRunSnapshot,
  type TaskRunState
} from './taskAutomationSettingsViewModel'

/**
 * 每个定时任务只取「最近一次运行」与它这一轮的投递尝试（有界：1 + 1 次查询/任务），
 * 供表格「最近结果」列与聚合投递健康使用。
 *
 * 单个任务读取失败**不丢这一行**：返回 `{ unreadable: true }`，表格显示「暂时读不到」。
 * 把失败条目过滤掉会让那一行退化成「从未运行」——两件不同的事实，用户会以为任务没跑过。
 * 只有「确实没有运行记录」才是缺席（`undefined`），那一行显示「从未运行」是对的。
 */
export async function loadTaskRunSnapshots(
  platform: Window['platform'],
  tasks: readonly ScheduledTaskEntity[]
): Promise<Record<string, TaskRunState>> {
  const entries = await Promise.all(tasks.map(async (task): Promise<readonly [string, TaskRunState] | null> => {
    try {
      const logPage = await getTaskLogsViaApi(platform, task.agentId, task.id, { limit: 1 })
      const latestRun = logPage.logs[0]
      if (!latestRun) return null
      const attemptPage = await getTaskDeliveryAttemptsViaApi(platform, task.agentId, latestRun.id, {
        limit: 50,
        offset: 0
      })
      const skip = collectDeliverySkipReasons(attemptPage.attempts)
      return [task.id, {
        status: latestRun.status,
        at: latestRun.startedAt ?? null,
        health: countDeliveryHealth(attemptPage.attempts),
        skipReasons: skip.skipReasons,
        unexplainedSkips: skip.unexplainedSkips
      } satisfies TaskRunSnapshot] as const
    } catch {
      // The failure is the row's value, not a reason to drop the row. The error text is not carried:
      // it can contain a path or a query and the table only needs to say the read failed.
      return [task.id, { unreadable: true }] as const
    }
  }))

  return Object.fromEntries(
    entries.filter((entry): entry is readonly [string, TaskRunState] => entry !== null)
  )
}
