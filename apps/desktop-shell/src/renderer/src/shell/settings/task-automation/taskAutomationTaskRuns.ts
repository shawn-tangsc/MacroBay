import type { ScheduledTaskEntity } from '@platform/ai/agent-platform/schemas/taskSchemas'

import { getTaskDeliveryAttemptsViaApi, getTaskLogsViaApi } from '../../agents/agentTaskDataApi'
import { countDeliveryHealth, type TaskRunSnapshot } from './taskAutomationSettingsViewModel'

/**
 * 每个定时任务只取「最近一次运行」与它这一轮的投递尝试（有界：1 + 1 次查询/任务），
 * 供表格「最近结果」列与聚合投递健康使用。单个任务读取失败只丢这一行，不拖垮整页。
 */
export async function loadTaskRunSnapshots(
  platform: Window['platform'],
  tasks: readonly ScheduledTaskEntity[]
): Promise<Record<string, TaskRunSnapshot>> {
  const entries = await Promise.all(tasks.map(async (task): Promise<readonly [string, TaskRunSnapshot] | null> => {
    try {
      const logPage = await getTaskLogsViaApi(platform, task.agentId, task.id, { limit: 1 })
      const latestRun = logPage.logs[0]
      if (!latestRun) return null
      const attemptPage = await getTaskDeliveryAttemptsViaApi(platform, task.agentId, latestRun.id, {
        limit: 50,
        offset: 0
      })
      return [task.id, {
        status: latestRun.status,
        at: latestRun.startedAt ?? null,
        health: countDeliveryHealth(attemptPage.attempts)
      } satisfies TaskRunSnapshot] as const
    } catch {
      return null
    }
  }))

  return Object.fromEntries(
    entries.filter((entry): entry is readonly [string, TaskRunSnapshot] => entry !== null)
  )
}
