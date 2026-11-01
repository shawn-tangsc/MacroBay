import type { ChannelDeliveryStatus } from './ChannelDeliveryContracts'
import { parseTaskResultSourceId } from './taskResultSourceId'

/**
 * 「我的任务结果送到了吗」的聚合口径（`MI-11-R42`，架构师裁定读口切到 `channel_delivery_attempts`）。
 *
 * 六状态六计数，与状态机 1:1：`pending` 是排队中，`sending` 是已发出但结果未定，两者**不许合并**——
 * 合并后「待投递 3」永远看不出有 1 条在路上。
 *
 * 分组按**任务**（读者问的是「我的任务送到了吗」），通道是行不是分组维度：
 * 同一任务多通道不会被算成多个任务。
 */
export type TaskResultDeliveryCounts = {
  pending: number
  sending: number
  delivered: number
  failed: number
  /** 「已发出但没收到确认」，中文写「未确认」，不写「未知」。 */
  unknown: number
  skipped: number
}

/** 一条通道投递；`errorCode` 原样带出，本地化留给界面层（`MI-11-R44`）。 */
export type TaskResultDeliveryChannelRow = {
  channelId: string
  status: ChannelDeliveryStatus
  errorCode: string | null
  attemptCount: number
  completedAt: string | null
}

/**
 * 空态三原因，界面按这个渲染，不许把「没有通道」写成「暂无投递记录」：
 * - `no-channel`：任务没绑任何通道，永远不会有投递；
 * - `not-yet`：绑了通道，但最近这次运行还没产生投递行；
 * - `has-attempts`：有真实投递。
 */
export type TaskResultDeliveryHealthState = 'no-channel' | 'not-yet' | 'has-attempts'

export type TaskResultDeliveryHealth = {
  state: TaskResultDeliveryHealthState
  counts: TaskResultDeliveryCounts
  channels: TaskResultDeliveryChannelRow[]
}

export type TaskResultDeliveryAttemptRow = {
  channelId: string
  /** `${runLogId}:${outcome}`，编码与解码只在 `taskResultSourceId.ts` 一处。 */
  sourceId: string
  status: ChannelDeliveryStatus
  errorCode: string | null
  attemptCount: number
  completedAt: string | null
}

export type TaskResultDeliveryHealthInput = {
  rows: readonly TaskResultDeliveryAttemptRow[]
  /** runLogId → taskId；来自任务运行记录，聚合只做查表，不自己推断。 */
  taskIdByRunLogId: ReadonlyMap<string, string>
  /** taskId → 该任务绑定的通道；空数组即「没绑通道」，决定 `no-channel` 而不是 `not-yet`。 */
  subscribedChannelIdsByTaskId: ReadonlyMap<string, readonly string[]>
}

export type TaskResultDeliveryHealthResult = {
  byTask: Record<string, TaskResultDeliveryHealth>
  /** 解不出 `runLogId` 的投递行数：**不静默丢**，交给上层记异常。 */
  unreadableRows: number
  /** 解出了 runLogId 但查不到对应任务的投递行数（任务已删等），同样计数不静默。 */
  unmappedRows: number
}

export function emptyTaskResultDeliveryCounts(): TaskResultDeliveryCounts {
  return { pending: 0, sending: 0, delivered: 0, failed: 0, unknown: 0, skipped: 0 }
}

export function aggregateTaskResultDeliveryHealth(
  input: TaskResultDeliveryHealthInput
): TaskResultDeliveryHealthResult {
  const countsByTask = new Map<string, TaskResultDeliveryCounts>()
  const channelsByTask = new Map<string, TaskResultDeliveryChannelRow[]>()
  let unreadableRows = 0
  let unmappedRows = 0

  for (const row of input.rows) {
    const parsed = parseTaskResultSourceId(row.sourceId)
    if (!parsed) {
      unreadableRows += 1
      continue
    }
    const taskId = input.taskIdByRunLogId.get(parsed.runLogId)
    if (!taskId) {
      unmappedRows += 1
      continue
    }

    const counts = countsByTask.get(taskId) ?? emptyTaskResultDeliveryCounts()
    counts[countKeyFor(row.status)] += 1
    countsByTask.set(taskId, counts)

    const channels = channelsByTask.get(taskId) ?? []
    channels.push({
      channelId: row.channelId,
      status: row.status,
      errorCode: row.errorCode,
      attemptCount: row.attemptCount,
      completedAt: row.completedAt
    })
    channelsByTask.set(taskId, channels)
  }

  const byTask: Record<string, TaskResultDeliveryHealth> = {}
  for (const [taskId, subscribedChannelIds] of input.subscribedChannelIdsByTaskId) {
    const channels = channelsByTask.get(taskId) ?? []
    byTask[taskId] = {
      state: stateFor(subscribedChannelIds.length, channels.length),
      counts: countsByTask.get(taskId) ?? emptyTaskResultDeliveryCounts(),
      channels
    }
  }

  return { byTask, unreadableRows, unmappedRows }
}

function stateFor(subscribedChannelCount: number, channelRowCount: number): TaskResultDeliveryHealthState {
  if (subscribedChannelCount === 0) return 'no-channel'
  return channelRowCount === 0 ? 'not-yet' : 'has-attempts'
}

function countKeyFor(status: ChannelDeliveryStatus): keyof TaskResultDeliveryCounts {
  switch (status) {
    case 'pending':
    case 'sending':
    case 'delivered':
    case 'failed':
    case 'skipped':
      return status
    case 'unknown-after-send':
      return 'unknown'
  }
}
