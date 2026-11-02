import type { ScheduledTaskEntity, TaskRunLogEntity } from '@platform/ai/agent-platform/schemas/taskSchemas'
import type { JobRunRecord } from '@platform/jobs'

import { getTaskLogsViaApi, listTaskJobPageViaApi, listTasksViaApi } from '../agentTaskDataApi'
import { buildTaskJobQuery } from '../agentTaskCenterViewModel'

/**
 * 任务中心一次读取的全部结果：任务、每个任务的运行记录、每条运行对应的作业。
 *
 * 抽成独立模块有两个原因：抽屉组件有 360 行的硬上限（`agentArchitectureBoundary.test.ts`），
 * 而「读哪些数据、并发多少」本身就是一段可单独理解的扇出逻辑，不该和渲染挤在一起。
 */
export type AgentTaskCenterLoadState = {
  tasks: ScheduledTaskEntity[]
  logsByTaskId: Record<string, TaskRunLogEntity[]>
  logsTotalByTaskId: Record<string, number>
  jobsByRunLogId: Record<string, JobRunRecord | null>
}

export const emptyAgentTaskCenterLoadState: AgentTaskCenterLoadState = {
  tasks: [],
  logsByTaskId: {},
  logsTotalByTaskId: {},
  jobsByRunLogId: {}
}

const TASK_PAGE_LIMIT = 50
const TASK_LOG_LIMIT = 10

/**
 * 读任务中心的一屏数据。
 *
 * 扇出是有界的：任务最多 50 条、每个任务最多 10 条运行，作业按运行逐条取首次结果。
 * 任何一次读取失败都向上抛——**调用方据此置 `loadError`，而不是把空结果当成「没有任务」**。
 */
export async function readAgentTaskCenterLoadState(
  platform: Window['platform'],
  agentId: string
): Promise<AgentTaskCenterLoadState> {
  const taskPage = await listTasksViaApi(platform, agentId, { limit: TASK_PAGE_LIMIT })
  const logsByTaskId: Record<string, TaskRunLogEntity[]> = {}
  const logsTotalByTaskId: Record<string, number> = {}
  const jobsByRunLogId: Record<string, JobRunRecord | null> = {}

  await Promise.all(
    taskPage.tasks.map(async (task) => {
      const logsPage = await getTaskLogsViaApi(platform, agentId, task.id, { limit: TASK_LOG_LIMIT })
      logsByTaskId[task.id] = logsPage.logs
      logsTotalByTaskId[task.id] = logsPage.total
      await Promise.all(
        logsPage.logs.map(async (log) => {
          const page = await listTaskJobPageViaApi(platform, buildTaskJobQuery(log.id))
          jobsByRunLogId[log.id] = page.runs[0] ?? null
        })
      )
    })
  )

  return { tasks: taskPage.tasks, logsByTaskId, logsTotalByTaskId, jobsByRunLogId }
}
