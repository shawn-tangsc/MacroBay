import { randomUUID } from 'node:crypto'

import { isSoulModeEnabled, normalizePermissionMode } from '../../schemas/agentSchemas'
import type { TaskRunLogEntity } from '../../schemas/taskSchemas'
import type { AgentPlatformServices } from '../../services'
import type { AgentTaskSchedulerRuntimeTask } from '../runtimeTypes'
import type { TaskActor } from './taskAutomationContracts'
import { taskMaxStartsPerAgentPerHour } from './taskAutomationPolicy'
import { buildAgentTaskSchedulerSnapshot } from './taskSchedulerPlanner'

const maxGlobalRuns = 3
const maxRunsPerAgent = 1

type Dependencies = {
  services: AgentPlatformServices
  now?: () => string
  dispatchQueuedRun: (input: { task: AgentTaskSchedulerRuntimeTask; runLog: TaskRunLogEntity }) => Promise<void>
}

export class AgentTaskExecutionCoordinator {
  private readonly activeRunLogIds = new Set<string>()
  private admissionQueue: Promise<void> = Promise.resolve()
  private draining = false

  constructor(private readonly deps: Dependencies) {}

  async enqueueDueTask(taskId: string): Promise<TaskRunLogEntity | null> {
    let result: TaskRunLogEntity | null = null
    const admission = this.admissionQueue.then(async () => {
      result = await this.enqueueDueTaskSerial(taskId)
    })
    this.admissionQueue = admission.catch(() => undefined)
    await admission
    return result
  }

  async enqueueManualRun(input: {
    agentId: string
    taskId: string
    expectedRevision: number
    actor?: TaskActor
  }): Promise<TaskRunLogEntity> {
    const admission = await this.deps.services.tasks.admitRunNow(
      input.agentId,
      input.taskId,
      { expectedRevision: input.expectedRevision, actor: input.actor },
      this.timestamp()
    )
    void this.drain()
    return admission.runLog
  }

  private async enqueueDueTaskSerial(taskId: string): Promise<TaskRunLogEntity | null> {
    const timestamp = this.timestamp()
    let runLog: TaskRunLogEntity | null = null
    const mutate = (state: Awaited<ReturnType<AgentPlatformServices['state']['getState']>>) => {
      const task = buildAgentTaskSchedulerSnapshot(state, { now: timestamp }).tasksById[taskId]
      if (!task || !task.isDue || !task.isRunnable || !isAutonomousTaskAgent(state, task.agentId)) {
        return { state, result: null, runLog: null }
      }
      if (state.taskRunLogs.some((run) => run.scheduleId === taskId && (run.status === 'queued' || run.status === 'running'))) {
        return { state, result: null, runLog: null }
      }
      if (countRecentStarts(state.taskRunLogs, task.agentId, timestamp) >= taskMaxStartsPerAgentPerHour) {
        return { state, result: null, runLog: null }
      }
      runLog = {
        id: randomUUID(),
        scheduleId: task.taskId,
        agentId: task.agentId,
        taskNameSnapshot: task.name,
        startedAt: timestamp,
        durationMs: 0,
        status: 'queued'
      }
      return { state: { ...state, taskRunLogs: [runLog, ...state.taskRunLogs] }, result: runLog, runLog }
    }
    if (this.deps.services.state.transactTaskRunLogMutation) {
      await this.deps.services.state.transactTaskRunLogMutation({ mutate })
    } else {
      await this.deps.services.state.update((state) => mutate(state).state)
    }
    if (!runLog) return null
    void this.drain()
    return runLog
  }

  async drain(): Promise<void> {
    if (this.draining) return
    this.draining = true
    try {
      const state = await this.deps.services.state.getState()
      const queuedRuns = state.taskRunLogs
        .filter((run) => run.status === 'queued')
        .sort((left, right) => Date.parse(left.startedAt) - Date.parse(right.startedAt) || left.id.localeCompare(right.id))

      for (const runLog of queuedRuns) {
        if (this.activeRunLogIds.has(runLog.id)) continue
        const claimed = await this.claimQueuedRun(runLog.id)
        if (!claimed) continue
        this.activeRunLogIds.add(runLog.id)
        void this.dispatch(claimed.task, claimed.runLog).catch(() => {
          // Dispatcher persists terminal truth; detached scheduling must not leak its rejection.
        })
      }
    } finally {
      this.draining = false
    }
  }

  async recoverAfterRestart(): Promise<void> {
    const state = await this.deps.services.state.getState()
    await Promise.all(state.taskRunLogs
      .filter((run) => run.status === 'queued' || run.status === 'running')
      .map((run) => this.deps.services.tasks.patchRunLog(run.id, {
        status: 'cancelled',
        terminalReason: 'runtime-restarted',
        error: 'Stopped by runtime restart.'
      })))
  }

  private async dispatch(task: AgentTaskSchedulerRuntimeTask, runLog: TaskRunLogEntity): Promise<void> {
    try {
      await this.deps.dispatchQueuedRun({ task, runLog })
    } finally {
      this.activeRunLogIds.delete(runLog.id)
      void this.drain()
    }
  }

  private async claimQueuedRun(runLogId: string): Promise<{ task: AgentTaskSchedulerRuntimeTask; runLog: TaskRunLogEntity } | null> {
    const timestamp = this.timestamp()
    let claimed: { task: AgentTaskSchedulerRuntimeTask; runLog: TaskRunLogEntity } | null = null
    const mutate = (state: Awaited<ReturnType<AgentPlatformServices['state']['getState']>>) => {
      const runLog = state.taskRunLogs.find((run) => run.id === runLogId)
      if (!runLog || runLog.status !== 'queued') return { state, result: null, runLog: null }
      const task = buildAgentTaskSchedulerSnapshot(state, { now: timestamp }).tasksById[runLog.scheduleId]
      const running = state.taskRunLogs.filter((run) => run.status === 'running')
      const eligibilityInvalid = !task || !task.isRunnable || !isAutonomousTaskAgent(state, task.agentId) ||
        (task ? countRecentStarts(state.taskRunLogs, task.agentId, timestamp) >= taskMaxStartsPerAgentPerHour : false)
      if (eligibilityInvalid) {
        const cancelledLog = {
          ...runLog,
          status: 'cancelled' as const,
          terminalReason: 'policy-blocked' as const,
          error: 'Task was no longer runnable before dispatch.'
        }
        return {
          state: { ...state, taskRunLogs: state.taskRunLogs.map((run) => run.id === runLogId ? cancelledLog : run) },
          result: null,
          runLog: cancelledLog
        }
      }
      if (running.length >= maxGlobalRuns || running.some((run) => run.agentId === task.agentId)) {
        return { state, result: null, runLog: null }
      }
      // Queued rows retain admission order; this transition records actual execution start.
      const runningLog = { ...runLog, status: 'running' as const, startedAt: timestamp }
      claimed = { task, runLog: runningLog }
      return {
        state: { ...state, taskRunLogs: state.taskRunLogs.map((run) => run.id === runLogId ? runningLog : run) },
        result: claimed,
        runLog: runningLog
      }
    }
    if (this.deps.services.state.transactTaskRunLogMutation) {
      await this.deps.services.state.transactTaskRunLogMutation({ mutate })
    } else {
      await this.deps.services.state.update((state) => mutate(state).state)
    }
    return claimed
  }

  private timestamp(): string {
    return (this.deps.now ?? (() => new Date().toISOString()))()
  }
}

function isAutonomousTaskAgent(state: Awaited<ReturnType<AgentPlatformServices['state']['getState']>>, agentId: string): boolean {
  const configuration = state.agents.find((agent) => agent.id === agentId)?.configuration
  return isSoulModeEnabled(configuration) || normalizePermissionMode(configuration?.permission_mode) === 'bypassPermissions'
}

function countRecentStarts(runs: readonly TaskRunLogEntity[], agentId: string, now: string): number {
  const cutoff = Date.parse(now) - 60 * 60_000
  return runs.filter((run) => run.agentId === agentId && hasStartedTaskRun(run) && Date.parse(run.startedAt) >= cutoff).length
}

function hasStartedTaskRun(run: TaskRunLogEntity): boolean {
  return run.status !== 'queued' && !(run.status === 'cancelled' && run.terminalReason === 'policy-blocked')
}
