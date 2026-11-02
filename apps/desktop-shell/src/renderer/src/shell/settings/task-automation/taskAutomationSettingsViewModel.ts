import type {
  ScheduledTaskEntity,
  TaskDeliveryAttemptEntity,
  TaskRunLogEntity
} from '@platform/ai/agent-platform/schemas/taskSchemas'
import type { TaskMutationAuditEntity } from '@platform/ai/agent-platform/runtime/tasks/taskAutomationContracts'
import {
  isChannelDeliverySkipReason,
  type ChannelDeliverySkipReason
} from '@platform/ai/agent-platform/channels/ChannelDeliveryContracts'

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
  /**
   * Why the skipped deliveries were skipped, deduplicated. The reason is written by the delivery
   * kernel and must be explained, not echoed as a code: each one needs a different user action.
   */
  skipReasons: ChannelDeliverySkipReason[]
  /**
   * Skipped attempts that carry no reason or a code we cannot explain. A skipped row without a
   * reason is a defect in the writer, so it is surfaced as such instead of being hidden behind a
   * dash.
   */
  unexplainedSkips: number
}

/**
 * A task whose latest run could not be read.
 *
 * It is a value, not an absence: the row has to stay in the table and say "unreadable". Dropping the
 * entry leaves the row rendering "never ran", which is a different fact and tells the user the task
 * did nothing when in reality the read failed.
 */
export type TaskRunUnreadable = { unreadable: true }

export type TaskRunState = TaskRunSnapshot | TaskRunUnreadable

export function isReadableTaskRun(state: TaskRunState | undefined): state is TaskRunSnapshot {
  return state !== undefined && !(state as TaskRunUnreadable).unreadable
}

export type TaskAutomationRow = {
  task: ScheduledTaskEntity
  lastRun: TaskRunSnapshot | null
  /** True when the latest run exists but could not be read; the row stays and says so. */
  runUnreadable: boolean
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

/**
 * A skipped delivery always has a reason (`finishSkipped` writes it). This separates the reasons we
 * can explain from the ones we cannot, so the interface never shows a raw code and never pretends
 * an unexplained skip is normal.
 */
export function collectDeliverySkipReasons(
  attempts: readonly Pick<TaskDeliveryAttemptEntity, 'status' | 'errorCode'>[]
): { skipReasons: ChannelDeliverySkipReason[]; unexplainedSkips: number } {
  const reasons = new Set<ChannelDeliverySkipReason>()
  let unexplainedSkips = 0
  for (const attempt of attempts) {
    if (attempt.status !== 'skipped-no-active-target' && attempt.status !== 'skipped-channel-inactive') continue
    if (isChannelDeliverySkipReason(attempt.errorCode)) reasons.add(attempt.errorCode)
    else unexplainedSkips += 1
  }
  return { skipReasons: [...reasons].sort(), unexplainedSkips }
}

/**
 * 空态只看两个数：源里有几条（`loadedCount`）、当前可见几条（`visibleCount`）。
 *
 * 不用「筛选是否开启」判断：零任务时计数必然是零，带不带筛选都该说「还没有任务」——让人去清除
 * 一个清除后依然为空的筛选，是把真相藏起来。反过来，`filter-empty` 也不等于「筛选开着」：筛选
 * 开着但仍有匹配行时它是 `none`，否则表格会被一句「没有任务」整块盖掉。
 */
export function resolveTaskEmptyState(input: {
  loadedCount: number
  visibleCount: number
}): TaskAutomationEmptyState {
  if (input.loadedCount === 0) return 'never-created'
  if (input.visibleCount === 0) return 'filter-empty'
  return 'none'
}

export function buildTaskAutomationSettingsState(input: {
  tasks: readonly ScheduledTaskEntity[]
  selectedTaskId: string | null
  status: TaskAutomationStatusFilter
  nameQuery: string
  audits: readonly Pick<TaskMutationAuditEntity, 'id' | 'taskId' | 'action' | 'outcome' | 'errorCode'>[]
  taskRuns: Readonly<Record<string, TaskRunState | undefined>>
}): TaskAutomationSettingsState {
  const query = input.nameQuery.trim().toLowerCase()
  const filteredTasks = input.tasks
    .filter((task) => input.status === 'all' || task.status === input.status)
    .filter((task) => query === '' || task.name.toLowerCase().includes(query))
  const selectedTask = filteredTasks.find((task) => task.id === input.selectedTaskId) ?? null
  const rows = filteredTasks.map((task) => {
    const run = input.taskRuns[task.id]
    return {
      task,
      lastRun: isReadableTaskRun(run) ? run : null,
      runUnreadable: run !== undefined && !isReadableTaskRun(run)
    }
  })
  const aggregateHealth = emptyHealth()
  let latestRunAt: string | null = null

  for (const task of input.tasks) {
    const snapshot = input.taskRuns[task.id]
    // An unreadable run contributes nothing to the counts: guessing zero would report a healthy
    // silence for a task whose run history simply could not be read.
    if (!isReadableTaskRun(snapshot)) continue
    aggregateHealth.delivered += snapshot.health.delivered
    aggregateHealth.failed += snapshot.health.failed
    aggregateHealth.pending += snapshot.health.pending
    aggregateHealth.skipped += snapshot.health.skipped
    aggregateHealth.unknown += snapshot.health.unknown
    if (snapshot.at && (latestRunAt === null || Date.parse(snapshot.at) > Date.parse(latestRunAt))) {
      latestRunAt = snapshot.at
    }
  }

  const selectedRun = selectedTask ? input.taskRuns[selectedTask.id] : undefined

  return {
    filteredTasks,
    rows,
    selectedTask,
    expandedTaskId: selectedTask?.id ?? null,
    auditCount: selectedTask
      ? input.audits.filter((audit) => audit.taskId === selectedTask.id).length
      : 0,
    deliveryHealth: isReadableTaskRun(selectedRun) ? { ...selectedRun.health } : emptyHealth(),
    aggregateHealth,
    latestRunAt,
    emptyState: resolveTaskEmptyState({
      loadedCount: input.tasks.length,
      visibleCount: filteredTasks.length
    }),
    hasFilters: input.status !== 'all' || input.nameQuery.trim() !== ''
  }
}
