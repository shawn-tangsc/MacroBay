import { isSoulModeEnabled, normalizePermissionMode, type AgentEntity } from '../../schemas/agentSchemas'
import type { AgentChannelEntity } from '../../schemas/channelSchemas'
import type { AgentSessionEntity } from '../../schemas/sessionSchemas'
import type { ScheduledTaskEntity, TaskRunLogEntity } from '../../schemas/taskSchemas'
import type { AgentStoreState } from '../../store/agentStore'
import {
  advanceToFutureRun,
  computeNextRunAt,
  isLegacyTriggerValid
} from './taskScheduleMath'
import type { AgentTaskRuntimeStatus, AgentTaskSchedulerRuntimeTask, AgentTaskSchedulerSnapshot } from '../runtimeTypes'
import {
  getHeartbeatIntervalMs,
  getHeartbeatTaskId,
  HEARTBEAT_CIRCUIT_BREAKER_FAILURES,
  HEARTBEAT_PROMPT_SENTINEL,
  HEARTBEAT_TASK_NAME,
  isHeartbeatEnabled,
  selectHeartbeatSession
} from './taskHeartbeatRuntime'
import { countConsecutiveTerminalFailures } from './taskFailureCircuit'

type BuildSchedulerSnapshotOptions = {
  now?: string
  startupAt?: string
  /**
   * 读者当前的设置时区。**排程时解析，不写回任务**（契约 `task-timezone-scheduling-contract.md`）：
   * `trigger.timezone` 为空表示「跟随读者设置」，非空表示这条任务被显式指定过、不再跟随。
   *
   * 生产路径的四个调用方都必须传（`app.ts` 里由 `shellTimeZone.get()` 提供）。
   * 不传时退回引擎行为（无时区＝按 UTC）——那只该出现在没有读者时区来源的测试里。
   */
  timeZone?: string
}

export function buildAgentTaskSchedulerSnapshot(
  state: AgentStoreState,
  options: BuildSchedulerSnapshotOptions = {}
): AgentTaskSchedulerSnapshot {
  const nowIso = options.now ?? new Date().toISOString()
  const nowMs = Date.parse(nowIso)
  const startupMs = options.startupAt ? Date.parse(options.startupAt) : null
  const readerTimeZone = options.timeZone
  const channelsById = new Map(state.channels.map((channel) => [channel.id, channel]))
  const workspacesById = new Map(state.workspaces.map((workspace) => [workspace.id, workspace]))
  const lastRunLogByTaskId = buildLastRunLogByTaskId(state.taskRunLogs)
  const subscriptionsByTaskId = buildSubscriptionsByTaskId(state.channelTaskSubscriptions)
  const runLogsByTaskId = buildRunLogsByTaskId(state.taskRunLogs)

  const agentsById = new Map(state.agents.map((agent) => [agent.id, agent]))
  const explicitTasks = state.tasks
    .map((task) => toRuntimeTask(task, {
      nowMs,
      startupMs,
      readerTimeZone,
      channelsById,
      agent: agentsById.get(task.agentId) ?? null,
      lastRunLog: lastRunLogByTaskId.get(task.id) ?? null,
      failureStreak: countConsecutiveTerminalFailures(runLogsByTaskId.get(task.id) ?? [], task.failureResetAt ?? null),
      subscribedChannelIds: subscriptionsByTaskId.get(task.id) ?? task.channelIds ?? []
    }))
  const heartbeatTasks = state.agents.flatMap((agent) =>
    toHeartbeatRuntimeTasks(agent, {
      sessions: state.sessions,
      workspacesById,
      nowMs,
      startupMs,
      readerTimeZone,
      channelsById,
      lastRunLogByTaskId,
      runLogsByTaskId
    })
  )
  const tasks = [...explicitTasks, ...heartbeatTasks].sort(compareRuntimeTasks)

  return {
    tasksById: Object.fromEntries(tasks.map((task) => [task.taskId, task])),
    dueTaskIds: tasks.filter((task) => task.isDue).map((task) => task.taskId),
    updatedAt: nowIso
  }
}

function toRuntimeTask(
  task: ScheduledTaskEntity,
  input: {
    nowMs: number
    startupMs: number | null
    /** 空 `trigger.timezone` 用它解析；见 `BuildSchedulerSnapshotOptions.timeZone`。 */
    readerTimeZone: string | undefined
    channelsById: Map<string, AgentChannelEntity>
    agent: AgentEntity | null
    lastRunLog: TaskRunLogEntity | null
    failureStreak: number
    subscribedChannelIds: string[]
  }
): AgentTaskSchedulerRuntimeTask {
  const lastRunAt = coalesceLastRunAt(task, input.lastRunLog)
  const lastRunInvalid = hasInvalidPersistedLastRun(task, input.lastRunLog)
  const triggerValid = isLegacyTriggerValid(task.trigger, input.nowMs, input.readerTimeZone)
  const persistedNextRunValid = task.nextRun === undefined || task.nextRun === null || Number.isFinite(Date.parse(task.nextRun))
  const intrinsicNextRunAt = computeNextRunAt(task, lastRunAt, input.readerTimeZone)
  const recovery = resolveCatchUpState(task, {
    nextRunAt: intrinsicNextRunAt,
    lastRunAt,
    lastRunLog: input.lastRunLog,
    nowMs: input.nowMs,
    startupMs: input.startupMs,
    readerTimeZone: input.readerTimeZone
  })
  const nextRunAt = recovery.nextRunAt
  const exhausted = recovery.exhausted
  const circuitBroken = input.failureStreak >= HEARTBEAT_CIRCUIT_BREAKER_FAILURES
  const autonomyBlocked = !isAgentAutonomous(input.agent)
  const scheduleInvalid = task.status === 'active' && (lastRunInvalid || !triggerValid || !persistedNextRunValid || (!lastRunAt && intrinsicNextRunAt === null))
  const runtimeBlockReason = scheduleInvalid ? 'schedule-invalid' : autonomyBlocked ? 'autonomy-disabled' : null
  const isRunnable = task.enabled && task.status === 'active' && !exhausted && !circuitBroken && !autonomyBlocked && !scheduleInvalid
  const visibleNextRunAt = scheduleInvalid ? null : nextRunAt
  const nextRunMs = visibleNextRunAt ? Date.parse(visibleNextRunAt) : null
  const isDue = isRunnable && input.lastRunLog?.status !== 'queued' && input.lastRunLog?.status !== 'running' && nextRunMs !== null && nextRunMs <= input.nowMs
  const activeChannelIds: string[] = []
  const inactiveChannelIds: string[] = []

  for (const channelId of input.subscribedChannelIds) {
    const channel = input.channelsById.get(channelId)
    if (channel?.isActive) {
      activeChannelIds.push(channelId)
    } else {
      inactiveChannelIds.push(channelId)
    }
  }

  return {
    taskId: task.id,
    sourceTaskId: task.id,
    sourceSessionId: null,
    agentId: task.agentId,
    executionKind: 'scheduled',
    name: task.name,
    prompt: task.prompt,
    workspace: task.workspace,
    trigger: cloneTrigger(task.trigger),
    status: task.status,
    timeoutMinutes: task.timeoutMinutes,
    enabled: task.enabled,
    isRunnable,
    isDue,
    exhausted,
    runtimeStatus: deriveRuntimeStatus(task, input.lastRunLog, isDue, exhausted, circuitBroken, autonomyBlocked, scheduleInvalid),
    runtimeBlockReason,
    nextRunAt: visibleNextRunAt,
    lastRunAt,
    lastRunLogId: input.lastRunLog?.id ?? null,
    failureStreak: input.failureStreak,
    circuitBroken,
    subscribedChannelIds: [...input.subscribedChannelIds],
    activeChannelIds,
    inactiveChannelIds
  }
}

function deriveRuntimeStatus(
  task: ScheduledTaskEntity,
  lastRunLog: TaskRunLogEntity | null,
  isDue: boolean,
  exhausted: boolean,
  circuitBroken: boolean,
  autonomyBlocked: boolean,
  scheduleInvalid: boolean
): AgentTaskRuntimeStatus {
  if (scheduleInvalid) return 'paused'
  if (task.status === 'completed' || exhausted) return 'completed'
  if (autonomyBlocked) return 'paused'
  if (circuitBroken || task.status === 'paused' || task.enabled === false) return 'paused'
  if (lastRunLog?.status === 'queued') return 'queued'
  if (lastRunLog?.status === 'running') return 'running'
  if (lastRunLog?.status === 'failed') return 'failed'
  if (lastRunLog?.status === 'cancelled') return 'cancelled'
  if (isDue) return 'due'
  return 'idle'
}

function toHeartbeatRuntimeTasks(
  agent: AgentEntity,
  input: {
    sessions: readonly AgentSessionEntity[]
    workspacesById: ReadonlyMap<string, AgentStoreState['workspaces'][number]>
    nowMs: number
    startupMs: number | null
    /** 心跳任务只可能是 interval，时区不参与排程；传下来只是为了让跨任务复用的签名保持一致。 */
    readerTimeZone: string | undefined
    channelsById: Map<string, AgentChannelEntity>
    lastRunLogByTaskId: ReadonlyMap<string, TaskRunLogEntity>
    runLogsByTaskId: ReadonlyMap<string, TaskRunLogEntity[]>
  }
): AgentTaskSchedulerRuntimeTask[] {
  if (!isHeartbeatEnabled(agent)) return []
  const intervalMs = getHeartbeatIntervalMs(agent)
  if (!intervalMs) return []
  const session = selectHeartbeatSession(input.sessions, input.workspacesById, agent.id)
  if (!session) return []

  const taskId = getHeartbeatTaskId(agent.id, session.workspaceId)
  const lastRunLog = input.lastRunLogByTaskId.get(taskId) ?? null
  const failureStreak = countConsecutiveTerminalFailures(input.runLogsByTaskId.get(taskId) ?? [])
  const circuitBroken = failureStreak >= HEARTBEAT_CIRCUIT_BREAKER_FAILURES
  const heartbeatTask: ScheduledTaskEntity = {
    id: taskId,
    agentId: agent.id,
    name: HEARTBEAT_TASK_NAME,
    prompt: HEARTBEAT_PROMPT_SENTINEL,
    trigger: { kind: 'interval', ms: intervalMs, anchor: 'lastRun' },
    catchUpPolicy: { kind: 'skip-missed' },
    timeoutMinutes: 2,
    workspace: { type: 'user', workspaceId: session.workspaceId },
    enabled: true,
    status: 'active',
    createdAt: session.createdAt || agent.createdAt,
    updatedAt: agent.updatedAt
  }
  const lastRunAt = coalesceLastRunAt(heartbeatTask, lastRunLog)
  const recovery = resolveCatchUpState(heartbeatTask, {
    nextRunAt: lastRunAt
      ? new Date(Date.parse(lastRunAt) + intervalMs).toISOString()
      : new Date(Date.parse(session.createdAt || agent.createdAt) + intervalMs).toISOString(),
    lastRunAt,
    lastRunLog,
    nowMs: input.nowMs,
    startupMs: input.startupMs,
    // 心跳任务只可能是 interval（没有钟点），时区对它没有意义；传同一条来源保持签名一致。
    readerTimeZone: input.readerTimeZone
  })
  const nextRunAt = recovery.nextRunAt
  if (!nextRunAt) return []
  const nextRunMs = Date.parse(nextRunAt)
  const isRunnable = !circuitBroken && !recovery.exhausted
  const isDue = isRunnable && lastRunLog?.status !== 'queued' && lastRunLog?.status !== 'running' && nextRunMs <= input.nowMs

  return [
    {
      taskId,
      sourceTaskId: null,
      sourceSessionId: session.id,
      agentId: agent.id,
      executionKind: 'heartbeat',
      name: HEARTBEAT_TASK_NAME,
      prompt: HEARTBEAT_PROMPT_SENTINEL,
      workspace: { type: 'user', workspaceId: session.workspaceId },
      trigger: { kind: 'interval', ms: intervalMs, anchor: 'lastRun' },
      status: 'active',
      timeoutMinutes: 2,
      enabled: true,
      isRunnable,
      isDue,
      exhausted: recovery.exhausted,
      runtimeStatus: circuitBroken ? 'paused' : isDue ? 'due' : lastRunLog?.status === 'queued' ? 'queued' : lastRunLog?.status === 'running' ? 'running' : lastRunLog?.status === 'failed' ? 'failed' : 'idle',
      nextRunAt,
      lastRunAt,
      lastRunLogId: lastRunLog?.id ?? null,
      failureStreak,
      circuitBroken,
      subscribedChannelIds: [],
      activeChannelIds: [],
      inactiveChannelIds: []
    }
  ]
}

function resolveCatchUpState(
  task: Pick<ScheduledTaskEntity, 'trigger' | 'catchUpPolicy' | 'createdAt'>,
  input: {
    nextRunAt: string | null
    lastRunAt: string | null
    lastRunLog: TaskRunLogEntity | null
    nowMs: number
    startupMs: number | null
    readerTimeZone: string | undefined
  }
): { nextRunAt: string | null; exhausted: boolean } {
  if (task.trigger.kind === 'once' && input.lastRunAt !== null) {
    return { nextRunAt: null, exhausted: true }
  }

  const nextRunAt = input.nextRunAt
  if (!nextRunAt) {
    return { nextRunAt: null, exhausted: false }
  }

  const nextRunMs = Date.parse(nextRunAt)
  if (!Number.isFinite(nextRunMs) || nextRunMs > input.nowMs) {
    return { nextRunAt, exhausted: false }
  }

  if (input.lastRunLog?.status === 'running') {
    return { nextRunAt, exhausted: false }
  }

  if (input.startupMs === null || nextRunMs > input.startupMs) {
    return { nextRunAt, exhausted: false }
  }

  const policy = task.catchUpPolicy ?? { kind: 'skip-missed' as const }
  if (policy.kind === 'after-startup') {
    const maxMissedAgeMs = policy.minutes * 60_000
    if (input.startupMs - nextRunMs <= maxMissedAgeMs) {
      return { nextRunAt, exhausted: false }
    }
  }

  if (task.trigger.kind === 'once') {
    return { nextRunAt: null, exhausted: true }
  }

  return {
    nextRunAt: advanceToFutureRun(task, nextRunMs, input.nowMs, input.readerTimeZone),
    exhausted: false
  }
}

function coalesceLastRunAt(task: ScheduledTaskEntity, lastRunLog: TaskRunLogEntity | null): string | null {
  if (task.lastRun && Number.isFinite(Date.parse(task.lastRun))) return task.lastRun
  return lastRunLog?.startedAt && Number.isFinite(Date.parse(lastRunLog.startedAt)) ? lastRunLog.startedAt : null
}

function hasInvalidPersistedLastRun(task: ScheduledTaskEntity, lastRunLog: TaskRunLogEntity | null): boolean {
  return Boolean((task.lastRun && !Number.isFinite(Date.parse(task.lastRun))) || (lastRunLog?.startedAt && !Number.isFinite(Date.parse(lastRunLog.startedAt))))
}

function buildLastRunLogByTaskId(taskRunLogs: readonly TaskRunLogEntity[]): Map<string, TaskRunLogEntity> {
  const lastRunLogByTaskId = new Map<string, TaskRunLogEntity>()

  for (const log of taskRunLogs) {
    const current = lastRunLogByTaskId.get(log.scheduleId)
    if (!current) {
      lastRunLogByTaskId.set(log.scheduleId, log)
      continue
    }
    const currentMs = Date.parse(current.startedAt)
    const nextMs = Date.parse(log.startedAt)
    if (nextMs > currentMs || (nextMs === currentMs && log.id.localeCompare(current.id) < 0)) {
      lastRunLogByTaskId.set(log.scheduleId, log)
    }
  }

  return lastRunLogByTaskId
}

function buildRunLogsByTaskId(taskRunLogs: readonly TaskRunLogEntity[]): Map<string, TaskRunLogEntity[]> {
  const runLogsByTaskId = new Map<string, TaskRunLogEntity[]>()

  for (const log of taskRunLogs) {
    const current = runLogsByTaskId.get(log.scheduleId) ?? []
    current.push(log)
    runLogsByTaskId.set(log.scheduleId, current)
  }

  for (const [taskId, logs] of runLogsByTaskId.entries()) {
    logs.sort((a, b) => {
      const delta = Date.parse(b.startedAt) - Date.parse(a.startedAt)
      if (delta !== 0) return delta
      return a.id.localeCompare(b.id)
    })
    runLogsByTaskId.set(taskId, logs)
  }

  return runLogsByTaskId
}

function isAgentAutonomous(agent: AgentEntity | null): boolean {
  if (!agent) return false
  return isSoulModeEnabled(agent.configuration) || normalizePermissionMode(agent.configuration?.permission_mode) === 'bypassPermissions'
}

function buildSubscriptionsByTaskId(
  subscriptions: readonly AgentStoreState['channelTaskSubscriptions'][number][]
): Map<string, string[]> {
  const subscriptionsByTaskId = new Map<string, string[]>()

  for (const subscription of subscriptions) {
    const current = subscriptionsByTaskId.get(subscription.taskId) ?? []
    if (!current.includes(subscription.channelId)) {
      current.push(subscription.channelId)
    }
    subscriptionsByTaskId.set(subscription.taskId, current)
  }

  return subscriptionsByTaskId
}

function compareRuntimeTasks(a: AgentTaskSchedulerRuntimeTask, b: AgentTaskSchedulerRuntimeTask): number {
  const dueOrder = Number(b.isDue) - Number(a.isDue)
  if (dueOrder !== 0) return dueOrder

  const nextRunA = a.nextRunAt ? Date.parse(a.nextRunAt) : Number.POSITIVE_INFINITY
  const nextRunB = b.nextRunAt ? Date.parse(b.nextRunAt) : Number.POSITIVE_INFINITY
  if (nextRunA !== nextRunB) return nextRunA - nextRunB

  return a.taskId.localeCompare(b.taskId)
}

function cloneTrigger(trigger: ScheduledTaskEntity['trigger']): ScheduledTaskEntity['trigger'] {
  switch (trigger.kind) {
    case 'cron':
      return { ...trigger }
    case 'interval':
      return { ...trigger }
    case 'once':
      return { ...trigger }
    default:
      return trigger
  }
}
