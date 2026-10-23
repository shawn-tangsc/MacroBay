import { getAgentTextParts } from '../../schemas/messageDataHelpers'
import { createHash } from 'node:crypto'
import type { ScheduledTaskEntity, TaskRunLogEntity } from '../../schemas/taskSchemas'
import type { AgentSessionWorkspaceSource } from '../../schemas/workspaceSchemas'
import type { JobCancelReason } from '../../../../jobs'
import type { AgentChatRuntimeRequest, AgentChatRuntimeResult } from '../agentChatRuntime'
import type { AgentPlatformServices } from '../../services'
import type {
  AgentRuntimeStopReason,
  AgentRuntimePrewarmSessionRequest,
  AgentRuntimePrewarmSessionResult,
  AgentTaskSchedulerRuntimeTask
} from '../runtimeTypes'
import {
  buildHeartbeatPrompt,
  HEARTBEAT_CIRCUIT_BREAKER_FAILURES,
  isUserWorkspaceSource
} from './taskHeartbeatRuntime'
import { countConsecutiveTerminalFailures } from './taskFailureCircuit'
import { renderTaskPromptTemplate } from './taskPromptTemplate'
import { buildAgentTaskSchedulerSnapshot } from './taskSchedulerPlanner'

type AgentTaskDispatchRuntime = {
  sendMessage: (request: AgentChatRuntimeRequest) => Promise<AgentChatRuntimeResult>
  prewarmSession?: (request: AgentRuntimePrewarmSessionRequest) => Promise<AgentRuntimePrewarmSessionResult>
  cancelMessage?: (runId: string, reason?: AgentRuntimeStopReason) => boolean
}

export type AgentTaskRunJobPayload = {
  agentId: string
  prompt: string
  timeoutMinutes: number
  workspace: AgentSessionWorkspaceSource
}

export type AgentTaskRunJobBridge = {
  startTaskRun: (input: {
    taskId: string
    sourceTaskId: string | null
    agentId: string
    taskName: string
    runLogId: string
    timeoutMinutes: number
    payload: AgentTaskRunJobPayload
  }) => Promise<{ jobRunId: string; signal?: AbortSignal | null }> | { jobRunId: string; signal?: AbortSignal | null }
  completeTaskRun: (input: {
    jobRunId: string
    taskId: string
    runLogId: string
    sessionId: string
    output: string
  }) => Promise<void> | void
  failTaskRun: (input: {
    jobRunId: string
    taskId: string
    runLogId: string
    sessionId: string
    error: string
  }) => Promise<void> | void
  cancelTaskRun: (input: {
    jobRunId: string
    taskId: string
    runLogId: string
    sessionId: string
    reason: string
    reasonKind?: JobCancelReason['kind']
  }) => Promise<void> | void
}

type AgentTaskDispatchServiceDependencies = {
  services: AgentPlatformServices
  runtime: AgentTaskDispatchRuntime
  jobBridge?: AgentTaskRunJobBridge
  getJobBridge?: () => AgentTaskRunJobBridge | null | undefined
  now?: () => string
  onStateChanged?: () => Promise<void> | void
  deliverTaskResult?: (input: {
    taskId: string
    taskNameSnapshot: string
    sourceTaskId: string | null
    agentId: string
    sessionId: string
    runLogId: string
    channelIds: string[]
    status: 'completed' | 'failed' | 'cancelled'
    text: string
    error: string | null
  }) => Promise<void> | void
  readHeartbeat?: (workspacePath: string) => Promise<string | null | undefined>
}

const defaultNow = (): string => new Date().toISOString()
const taskResultPreviewMaxChars = 200

export class AgentTaskNotRunnableError extends Error {
  readonly code = 'task-not-runnable' as const

  constructor(taskId: string) {
    super(`TASK_NOT_RUNNABLE:${taskId}`)
    this.name = 'AgentTaskNotRunnableError'
  }
}

export class AgentTaskDispatchService {
  private readonly claimedTaskIds = new Set<string>()

  constructor(private readonly deps: AgentTaskDispatchServiceDependencies) {}

  async runTask(agentId: string, taskId: string, expectedRevision: number): Promise<{ taskId: string; runLogId: string }> {
    try {
      if (!this.claimTask(taskId, 'manual')) throw new AgentTaskNotRunnableError(taskId)
    } catch (error) {
      await this.deps.services.tasks.rejectRunNow(agentId, taskId, { expectedRevision })
      throw error
    }
    try {
      const admission = await this.deps.services.tasks.admitRunNow(agentId, taskId, { expectedRevision }, this.timestamp())
      await this.notifyStateChangedSafely()
      await this.dispatchTaskLike(admission.task, { existingRunningLogId: admission.runLog.id })
      return { taskId, runLogId: admission.runLog.id }
    } finally {
      this.claimedTaskIds.delete(taskId)
    }
  }

  async dispatchDueTask(task: AgentTaskSchedulerRuntimeTask): Promise<void> {
    if (task.executionKind === 'heartbeat') {
      await this.dispatchHeartbeatTask(task)
      return
    }
    await this.dispatchScheduledTask(task.taskId, 'due')
  }

  async dispatchQueuedRun(input: {
    task: AgentTaskSchedulerRuntimeTask
    runLog: Pick<TaskRunLogEntity, 'id'>
  }): Promise<void> {
    await this.dispatchTaskLike(input.task, { existingRunningLogId: input.runLog.id })
  }

  async dispatchRuntimeTask(task: AgentTaskSchedulerRuntimeTask): Promise<void> {
    if (task.executionKind === 'heartbeat') {
      await this.dispatchHeartbeatTask(task)
      return
    }

    await this.dispatchScheduledTask(task.taskId, 'due')
  }

  private async dispatchScheduledTask(
    taskId: string,
    mode: 'due' | 'manual',
    expectedRevision?: number
  ): Promise<boolean> {
    if (!this.claimTask(taskId, mode)) return false
    try {
      const state = await this.deps.services.state.getState()
      const persistedTask = state.tasks.find((item) => item.id === taskId)
      if (mode === 'manual' && expectedRevision !== undefined && (persistedTask?.revision ?? 1) !== expectedRevision) {
        throw new AgentTaskNotRunnableError(taskId)
      }
      const snapshot = buildAgentTaskSchedulerSnapshot(state, { now: this.timestamp() })
      const task = snapshot.tasksById[taskId]
      if (!task) {
        throw new Error(`Scheduled task "${taskId}" was not found.`)
      }

      if (!task.isRunnable || state.taskRunLogs.some((log) => log.scheduleId === taskId && log.status === 'running')) {
        if (mode === 'due') return false
        throw new AgentTaskNotRunnableError(taskId)
      }
      if (mode === 'due' && !task.isDue) return false

      await this.dispatchTaskLike(task)
      return true
    } finally {
      this.claimedTaskIds.delete(taskId)
    }
  }

  private async dispatchHeartbeatTask(task: AgentTaskSchedulerRuntimeTask): Promise<void> {
    if (!this.claimTask(task.taskId, 'due')) return
    try {
      const state = await this.deps.services.state.getState()
      if (state.taskRunLogs.some((log) => log.scheduleId === task.taskId && log.status === 'running')) return

      const startedAt = this.timestamp()
      const runningLog = await this.createRunningLog(task, startedAt)
      await this.notifyStateChangedSafely()

      const content = await this.resolveHeartbeatContent(task.workspace)
      if (!content) {
        await this.replaceRunLog(runningLog.id, {
          status: 'completed',
          durationMs: 0,
          resultPreview: 'Skipped (no file)'
        })
        await this.notifyStateChangedSafely()
        return
      }

      await this.dispatchTaskLike(
        { ...task, prompt: buildHeartbeatPrompt(content) },
        { existingRunningLogId: runningLog.id }
      )
    } finally {
      this.claimedTaskIds.delete(task.taskId)
    }
  }

  private claimTask(taskId: string, mode: 'due' | 'manual'): boolean {
    if (!this.claimedTaskIds.has(taskId)) {
      this.claimedTaskIds.add(taskId)
      return true
    }
    if (mode === 'due') return false
    throw new AgentTaskNotRunnableError(taskId)
  }

  private async dispatchTaskLike(
    task: AgentTaskSchedulerRuntimeTask,
    options: { existingRunningLogId?: string } = {}
  ): Promise<void> {
    const startedAt = this.timestamp()
    const renderedPrompt = renderTaskPromptTemplate(task.prompt, {
      now: startedAt,
      timezone: resolveTaskTimezone(task),
      taskName: task.name
    })
    const runningLogId = options.existingRunningLogId ?? (await this.createRunningLog(task, startedAt)).id
    if (!options.existingRunningLogId) {
      await this.notifyStateChangedSafely()
    }

    let session
    try {
      session = await this.deps.services.sessions.create({
        agentId: task.agentId,
        name: task.name,
        workspace: task.workspace
      })
    } catch (error) {
      await this.replaceRunLog(runningLogId, {
        status: 'failed',
        durationMs: 0,
        error: error instanceof Error ? error.message : String(error)
      })
      await this.notifyStateChangedSafely()
      throw error
    }

    await this.replaceRunLog(runningLogId, {
      sessionId: session.id
    })
    await this.notifyStateChangedSafely()

    const dispatchStartedAt = Date.parse(startedAt)
    const runtimeRunId = createId('task-dispatch')
    const jobRun = await this.startJobRun(task, runningLogId, renderedPrompt)
    let jobAbortListener: (() => void) | null = null
    if (jobRun?.signal) {
      jobAbortListener = () => {
        this.deps.runtime.cancelMessage?.(runtimeRunId, {
          kind: 'runtime-stop',
          message: readAbortMessage(jobRun.signal) ?? 'Task run was aborted.'
        })
      }
      jobRun.signal.addEventListener('abort', jobAbortListener, { once: true })
    }
    try {
      if (jobRun?.signal?.aborted) {
        throw new Error(readAbortMessage(jobRun.signal) ?? 'Task run was aborted.')
      }
      await this.prewarmSession({
        agentId: task.agentId,
        sessionId: session.id
      })
      if (jobRun?.signal?.aborted) {
        throw new Error(readAbortMessage(jobRun.signal) ?? 'Task run was aborted.')
      }
      const runtimeResult = await this.deps.runtime.sendMessage({
        agentId: task.agentId,
        sessionId: session.id,
        text: renderedPrompt,
        runId: runtimeRunId
      })
      const result = summarizeTaskResult(runtimeResult)
      await this.updateTaskAfterRun(task.taskId, startedAt)
      await this.replaceRunLog(runningLogId, {
        sessionId: session.id,
        status: 'completed',
        durationMs: Math.max(0, Date.parse(this.timestamp()) - dispatchStartedAt),
        resultPreview: result.preview,
        resultHash: result.hash,
        resultCharCount: result.charCount,
        usage: result.usage
      })
      await this.completeJobRun(jobRun?.jobRunId, task.taskId, runningLogId, session.id, result.preview)
      await this.deliverTaskResult({
        task,
        sessionId: session.id,
        runLogId: runningLogId,
        status: 'completed',
        text: result.fullText,
        error: null
      })
      await this.notifyStateChangedSafely()
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      const abortReason = readAbortReason(jobRun?.signal)
      const aborted = Boolean(jobRun?.signal?.aborted)
      const cancelled =
        abortReason?.kind === 'cancelled' || abortReason?.kind === 'shutdown' || (aborted && !abortReason)
      const finalError = abortReason?.message ?? errorMessage
      await this.replaceRunLog(runningLogId, {
        sessionId: session.id,
        status: cancelled ? 'cancelled' : 'failed',
        durationMs: Math.max(0, Date.parse(this.timestamp()) - dispatchStartedAt),
        error: finalError
      })
      if (cancelled) {
        await this.cancelJobRun(jobRun?.jobRunId, task.taskId, runningLogId, session.id, finalError, abortReason?.kind)
      } else {
        await this.maybePauseTaskAfterFailure(task.taskId)
        await this.failJobRun(jobRun?.jobRunId, task.taskId, runningLogId, session.id, finalError)
      }
      await this.deliverTaskResult({
        task,
        sessionId: session.id,
        runLogId: runningLogId,
        status: cancelled ? 'cancelled' : 'failed',
        text: '',
        error: finalError
      })
      await this.notifyStateChangedSafely()
      throw error
    } finally {
      if (jobRun?.signal && jobAbortListener) {
        jobRun.signal.removeEventListener('abort', jobAbortListener)
      }
    }
  }

  private async startJobRun(
    task: AgentTaskSchedulerRuntimeTask,
    runLogId: string,
    prompt: string
  ): Promise<{ jobRunId: string; signal?: AbortSignal | null } | null> {
    const jobBridge = this.resolveJobBridge()
    if (!jobBridge) return null
    try {
      return await jobBridge.startTaskRun({
        taskId: task.taskId,
        sourceTaskId: task.sourceTaskId,
        agentId: task.agentId,
        taskName: task.name,
        runLogId,
        timeoutMinutes: task.timeoutMinutes,
        payload: {
          agentId: task.agentId,
          prompt,
          timeoutMinutes: task.timeoutMinutes,
          workspace: cloneWorkspaceSource(task.workspace)
        }
      })
    } catch {
      return null
    }
  }

  private async completeJobRun(
    jobRunId: string | undefined,
    taskId: string,
    runLogId: string,
    sessionId: string,
    output: string
  ): Promise<void> {
    const jobBridge = this.resolveJobBridge()
    if (!jobRunId || !jobBridge) return
    try {
      await jobBridge.completeTaskRun({ jobRunId, taskId, runLogId, sessionId, output })
    } catch {
      // Best-effort only: persisted task run logs remain authoritative.
    }
  }

  private async failJobRun(
    jobRunId: string | undefined,
    taskId: string,
    runLogId: string,
    sessionId: string,
    error: string
  ): Promise<void> {
    const jobBridge = this.resolveJobBridge()
    if (!jobRunId || !jobBridge) return
    try {
      await jobBridge.failTaskRun({ jobRunId, taskId, runLogId, sessionId, error })
    } catch {
      // Best-effort only: persisted task run logs remain authoritative.
    }
  }

  private async cancelJobRun(
    jobRunId: string | undefined,
    taskId: string,
    runLogId: string,
    sessionId: string,
    reason: string,
    reasonKind?: JobCancelReason['kind']
  ): Promise<void> {
    const jobBridge = this.resolveJobBridge()
    if (!jobRunId || !jobBridge) return
    try {
      await jobBridge.cancelTaskRun({ jobRunId, taskId, runLogId, sessionId, reason, reasonKind })
    } catch {
      // Best-effort only: persisted task run logs remain authoritative.
    }
  }

  private resolveJobBridge(): AgentTaskRunJobBridge | null {
    return this.deps.jobBridge ?? this.deps.getJobBridge?.() ?? null
  }

  private async deliverTaskResult(input: {
    task: AgentTaskSchedulerRuntimeTask
    sessionId: string
    runLogId: string
    status: 'completed' | 'failed' | 'cancelled'
    text: string
    error: string | null
  }): Promise<void> {
    const channelIds = input.task.activeChannelIds
    if (channelIds.length === 0 || !this.deps.deliverTaskResult) return

    try {
      await this.deps.deliverTaskResult({
        taskId: input.task.taskId,
        taskNameSnapshot: input.task.name,
        sourceTaskId: input.task.sourceTaskId,
        agentId: input.task.agentId,
        sessionId: input.sessionId,
        runLogId: input.runLogId,
        channelIds: [...channelIds],
        status: input.status,
        text: input.text,
        error: input.error
      })
    } catch {
      // Best-effort only: task execution/logging remains authoritative even if delivery fails.
    }
  }

  private async prewarmSession(request: AgentRuntimePrewarmSessionRequest): Promise<void> {
    if (!this.deps.runtime.prewarmSession) return
    try {
      await this.deps.runtime.prewarmSession(request)
    } catch {
      // Best-effort only: the real send path still owns failure/fallback semantics.
    }
  }

  private async createRunningLog(task: AgentTaskSchedulerRuntimeTask, startedAt: string): Promise<TaskRunLogEntity> {
    const runningLog: TaskRunLogEntity = {
      id: createId('task-run'),
      scheduleId: task.taskId,
      agentId: task.agentId,
      taskNameSnapshot: task.name,
      startedAt,
      durationMs: 0,
      status: 'running'
    }
    await this.deps.services.tasks.addRunLog(runningLog)
    return runningLog
  }

  private async notifyStateChangedSafely(): Promise<void> {
    try {
      await this.deps.onStateChanged?.()
    } catch {
      // Renderer/state refresh is observational and must not alter durable run truth.
    }
  }

  private async replaceRunLog(runLogId: string, patch: Partial<TaskRunLogEntity>): Promise<void> {
    await this.deps.services.tasks.patchRunLog(runLogId, patch)
  }

  private async updateTaskAfterRun(taskId: string, startedAt: string): Promise<void> {
    await this.deps.services.tasks.recordRuntimeTaskRun(taskId, {
      startedAt,
      updatedAt: this.timestamp()
    })
  }

  private async maybePauseTaskAfterFailure(taskId: string): Promise<void> {
    const pausedAt = this.timestamp()
    const state = await this.deps.services.state.getState()
    const task = state.tasks.find((item) => item.id === taskId)
    const shouldPause = Boolean(
      task &&
      task.enabled &&
      task.status === 'active' &&
      countConsecutiveTerminalFailures(
        state.taskRunLogs.filter((log) => log.scheduleId === taskId),
        task.failureResetAt
      ) >= HEARTBEAT_CIRCUIT_BREAKER_FAILURES
    )
    if (shouldPause) await this.deps.services.tasks.pauseTaskForFailureCircuit(taskId, pausedAt)
  }

  private async resolveHeartbeatContent(workspace: AgentSessionWorkspaceSource): Promise<string | null> {
    if (!isUserWorkspaceSource(workspace)) {
      return null
    }
    const state = await this.deps.services.state.getState()
    const workspaceRow = state.workspaces.find((item) => item.id === workspace.workspaceId && item.type === 'user')
    if (!workspaceRow || !this.deps.readHeartbeat) {
      return null
    }

    const content = await this.deps.readHeartbeat(workspaceRow.path)
    const trimmed = typeof content === 'string' ? content.trim() : ''
    return trimmed || null
  }

  private timestamp(): string {
    return (this.deps.now ?? defaultNow)()
  }
}

function createId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

function cloneWorkspaceSource(workspace: AgentSessionWorkspaceSource): AgentSessionWorkspaceSource {
  return { ...workspace }
}

function resolveTaskTimezone(task: AgentTaskSchedulerRuntimeTask): string {
  const timezone = task.trigger.kind === 'cron' ? task.trigger.timezone : undefined
  if (timezone) return timezone
  const systemTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone
  return systemTimezone || 'UTC'
}

function readAbortReason(signal: AbortSignal | null | undefined): JobCancelReason | null {
  if (!signal?.aborted) return null
  const reason = signal.reason
  if (!reason || typeof reason !== 'object') return null
  const candidate = reason as Partial<JobCancelReason>
  if (
    (candidate.kind === 'cancelled' || candidate.kind === 'timeout' || candidate.kind === 'shutdown') &&
    typeof candidate.message === 'string'
  ) {
    return {
      kind: candidate.kind,
      message: candidate.message
    }
  }
  return null
}

function readAbortMessage(signal: AbortSignal | null | undefined): string | null {
  return readAbortReason(signal)?.message ?? null
}

function summarizeTaskResult(result: AgentChatRuntimeResult): {
  fullText: string
  preview: string
  hash: string
  charCount: number
  usage: TaskRunLogEntity['usage']
} {
  const assistantText = getAgentTextParts(result.assistantMessage.data).join('\n').trim()
  const fullText = assistantText || 'Completed.'
  const usage = normalizeTaskRunUsage(result.assistantMessage.stats)
  const preview = fullText.length <= taskResultPreviewMaxChars
    ? fullText
    : `${fullText.slice(0, taskResultPreviewMaxChars - 3)}...`
  return {
    fullText,
    preview,
    hash: createHash('sha256').update(fullText).digest('hex'),
    charCount: fullText.length,
    usage
  }
}

function normalizeTaskRunUsage(stats: AgentChatRuntimeResult['assistantMessage']['stats']): TaskRunLogEntity['usage'] {
  if (!stats) return null
  const inputTokens = safeTokenCount(stats.promptTokens)
  const outputTokens = safeTokenCount(stats.completionTokens)
  const totalTokens = safeTokenCount(stats.totalTokens)
  if (inputTokens === undefined && outputTokens === undefined && totalTokens === undefined) return null
  return { inputTokens, outputTokens, totalTokens }
}

function safeTokenCount(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined
}
