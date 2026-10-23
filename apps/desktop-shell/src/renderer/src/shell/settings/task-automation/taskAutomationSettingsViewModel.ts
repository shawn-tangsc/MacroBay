import type {
  ScheduledTaskEntity,
  TaskDeliveryAttemptEntity,
  TaskRunLogEntity
} from '@platform/ai/agent-platform/schemas/taskSchemas'
import type { TaskMutationAuditEntity } from '@platform/ai/agent-platform/runtime/tasks/taskAutomationContracts'

export type TaskAutomationStatusFilter = 'all' | ScheduledTaskEntity['status']

export type DeliveryHealthCounts = {
  delivered: number
  failed: number
  pending: number
  skipped: number
  unknown: number
}

export type TaskRunSnapshot = {
  status: TaskRunLogEntity['status']
  /** 最近一次运行的开始时刻；用于表格「最近结果」时间与聚合「最近更新」。 */
  at: string | null
  health: DeliveryHealthCounts
}

export type TaskAutomationRow = {
  task: ScheduledTaskEntity
  lastRun: TaskRunSnapshot | null
}

export type TaskAutomationEmptyState = 'none' | 'never-created' | 'filter-empty'

export type TaskAutomationSettingsState = {
  filteredTasks: ScheduledTaskEntity[]
  rows: TaskAutomationRow[]
  selectedTask: ScheduledTaskEntity | null
  expandedTaskId: string | null
  auditCount: number
  deliveryHealth: DeliveryHealthCounts
  aggregateHealth: DeliveryHealthCounts
  latestRunAt: string | null
  emptyState: TaskAutomationEmptyState
  hasFilters: boolean
}

const emptyHealth = (): DeliveryHealthCounts => ({
  delivered: 0,
  failed: 0,
  pending: 0,
  skipped: 0,
  unknown: 0
})

/** 投递尝试 → 5 项健康计数。`unknown-*` 一律算未知，不再误记成「已跳过」。 */
export function countDeliveryHealth(
  attempts: readonly Pick<TaskDeliveryAttemptEntity, 'status'>[]
): DeliveryHealthCounts {
  const health = emptyHealth()
  for (const attempt of attempts) {
    if (attempt.status === 'delivered') health.delivered += 1
    else if (attempt.status === 'failed') health.failed += 1
    else if (attempt.status === 'pending') health.pending += 1
    else if (attempt.status === 'unknown-after-restart' || attempt.status === 'unknown-after-send') health.unknown += 1
    else health.skipped += 1
  }
  return health
}

export function resolveTaskEmptyState(input: {
  loadedCount: number
  status: TaskAutomationStatusFilter
  nameQuery: string
}): TaskAutomationEmptyState {
  const hasFilters = input.status !== 'all' || input.nameQuery.trim() !== ''
  if (input.loadedCount > 0 && !hasFilters) return 'none'
  if (!hasFilters) return 'never-created'
  return 'filter-empty'
}

export function buildTaskAutomationSettingsState(input: {
  tasks: readonly ScheduledTaskEntity[]
  selectedTaskId: string | null
  status: TaskAutomationStatusFilter
  nameQuery: string
  audits: readonly Pick<TaskMutationAuditEntity, 'id' | 'taskId' | 'action' | 'outcome' | 'errorCode'>[]
  taskRuns: Readonly<Record<string, TaskRunSnapshot | undefined>>
}): TaskAutomationSettingsState {
  const query = input.nameQuery.trim().toLowerCase()
  const filteredTasks = input.tasks
    .filter((task) => input.status === 'all' || task.status === input.status)
    .filter((task) => query === '' || task.name.toLowerCase().includes(query))
  const selectedTask = filteredTasks.find((task) => task.id === input.selectedTaskId) ?? null
  const rows = filteredTasks.map((task) => ({ task, lastRun: input.taskRuns[task.id] ?? null }))
  const aggregateHealth = emptyHealth()
  let latestRunAt: string | null = null

  for (const task of input.tasks) {
    const snapshot = input.taskRuns[task.id]
    if (!snapshot) continue
    aggregateHealth.delivered += snapshot.health.delivered
    aggregateHealth.failed += snapshot.health.failed
    aggregateHealth.pending += snapshot.health.pending
    aggregateHealth.skipped += snapshot.health.skipped
    aggregateHealth.unknown += snapshot.health.unknown
    if (snapshot.at && (latestRunAt === null || Date.parse(snapshot.at) > Date.parse(latestRunAt))) {
      latestRunAt = snapshot.at
    }
  }

  return {
    filteredTasks,
    rows,
    selectedTask,
    expandedTaskId: selectedTask?.id ?? null,
    auditCount: selectedTask
      ? input.audits.filter((audit) => audit.taskId === selectedTask.id).length
      : 0,
    deliveryHealth: selectedTask ? { ...(input.taskRuns[selectedTask.id]?.health ?? emptyHealth()) } : emptyHealth(),
    aggregateHealth,
    latestRunAt,
    emptyState: resolveTaskEmptyState({
      loadedCount: input.tasks.length,
      status: input.status,
      nameQuery: input.nameQuery
    }),
    hasFilters: input.status !== 'all' || input.nameQuery.trim() !== ''
  }
}
