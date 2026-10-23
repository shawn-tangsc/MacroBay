import type { AgentTaskRunJobBridge } from '../../ai/agent-platform/runtime/tasks'
import type { JobCancelReason, JobContext, JobRunRecord, JobRuntime } from '../../jobs'

const agentTaskJobHandlerId = 'platform.agent.task.run'
const defaultJobOutput = 'Completed.'
const pendingJobPollIntervalMs = 25

type AgentTaskJobBridgeDependencies = {
  jobRuntime: JobRuntime
}

type PendingTaskJob = {
  context: JobContext
  resolve: () => void
  reject: (error: Error) => void
}

type PendingJobStart = {
  resolve: (signal: AbortSignal | null) => void
}

export function createAgentTaskJobBridge(deps: AgentTaskJobBridgeDependencies): AgentTaskRunJobBridge {
  const pendingJobs = new Map<string, PendingTaskJob>()
  const pendingStarts = new Map<string, PendingJobStart>()

  ensureAgentTaskJobHandler(deps.jobRuntime, pendingJobs, pendingStarts)

  return {
    async startTaskRun(input) {
      const run = await deps.jobRuntime.enqueueDefinition({
        id: `platform.agent.task.${input.runLogId}`,
        owner: 'platform',
        handlerId: agentTaskJobHandlerId,
        title: `Agent task: ${input.taskName}`,
        trigger: { kind: 'manual' },
        payload: {
          ...input.payload,
          taskId: input.taskId,
          sourceTaskId: input.sourceTaskId,
          runLogId: input.runLogId
        },
        concurrencyKey: `platform.agent.task.${input.taskId}`,
        timeoutMs: toTimeoutMs(input.timeoutMinutes),
        redact: redactAgentTaskJobPayload
      })

      return {
        jobRunId: run.id,
        signal: await waitForPendingJobSignal({
          jobRunId: run.id,
          pendingJobs,
          pendingStarts,
          getRun: () => deps.jobRuntime.getRun(run.id)
        })
      }
    },
    async completeTaskRun(input) {
      const pending = pendingJobs.get(input.jobRunId)
      if (!pending) return
      await pending.context.progress({
        current: 1,
        total: 1,
        message: input.output || defaultJobOutput
      })
      await pending.context.log({
        level: 'info',
        message: 'Agent task completed.',
        metadata: {
          taskId: input.taskId,
          runLogId: input.runLogId,
          sessionId: input.sessionId,
          output: input.output || defaultJobOutput
        }
      })
      pending.resolve()
    },
    async failTaskRun(input) {
      const pending = pendingJobs.get(input.jobRunId)
      if (!pending) return
      await pending.context.log({
        level: 'error',
        message: 'Agent task failed.',
        metadata: {
          taskId: input.taskId,
          runLogId: input.runLogId,
          sessionId: input.sessionId,
          error: input.error
        }
      })
      pending.reject(new Error(input.error || 'Agent task failed.'))
    },
    async cancelTaskRun(input) {
      const pending = pendingJobs.get(input.jobRunId)
      if (!pending) return
      await pending.context.log({
        level: 'warn',
        message: 'Agent task cancelled.',
        metadata: {
          taskId: input.taskId,
          runLogId: input.runLogId,
          sessionId: input.sessionId,
          reason: input.reason
        }
      })
      deps.jobRuntime.cancel(input.jobRunId, {
        kind: input.reasonKind ?? 'cancelled',
        message: input.reason
      })
      pending.resolve()
    }
  }
}

function ensureAgentTaskJobHandler(
  jobRuntime: JobRuntime,
  pendingJobs: Map<string, PendingTaskJob>,
  pendingStarts: Map<string, PendingJobStart>
): void {
  jobRuntime.registerHandler(agentTaskJobHandlerId, async (_payload, context) => {
    await new Promise<void>((resolve, reject) => {
      const pending = { context, resolve, reject }
      pendingJobs.set(context.jobRunId, pending)
      pendingStarts.get(context.jobRunId)?.resolve(context.signal)
      pendingStarts.delete(context.jobRunId)
      if (context.signal.aborted) {
        resolve()
        return
      }
      context.signal.addEventListener(
        'abort',
        () => {
          resolve()
        },
        { once: true }
      )
    }).finally(() => {
      pendingJobs.delete(context.jobRunId)
    })
  })
}

function toTimeoutMs(timeoutMinutes: number): number | undefined {
  if (!Number.isFinite(timeoutMinutes) || timeoutMinutes <= 0) return undefined
  return Math.max(1, Math.round(timeoutMinutes * 60_000))
}

function waitForPendingJobSignal(input: {
  jobRunId: string
  pendingJobs: Map<string, PendingTaskJob>
  pendingStarts: Map<string, PendingJobStart>
  getRun: () => JobRunRecord | undefined
}): Promise<AbortSignal | null> {
  const existingPendingSignal = input.pendingJobs.get(input.jobRunId)?.context.signal
  if (existingPendingSignal) {
    return Promise.resolve(existingPendingSignal)
  }

  const existingTerminalSignal = createTerminalRunSignal(input.getRun())
  if (existingTerminalSignal) {
    return Promise.resolve(existingTerminalSignal)
  }

  return new Promise((resolve) => {
    let settled = false
    const settle = (signal: AbortSignal | null) => {
      if (settled) return
      settled = true
      clearInterval(pollTimer)
      input.pendingStarts.delete(input.jobRunId)
      resolve(signal)
    }

    const pollTimer = setInterval(() => {
      const pendingSignal = input.pendingJobs.get(input.jobRunId)?.context.signal
      if (pendingSignal) {
        settle(pendingSignal)
        return
      }
      const terminalSignal = createTerminalRunSignal(input.getRun())
      if (terminalSignal) {
        settle(terminalSignal)
      }
    }, pendingJobPollIntervalMs)

    input.pendingStarts.set(input.jobRunId, { resolve: settle })

    const immediatePendingSignal = input.pendingJobs.get(input.jobRunId)?.context.signal
    if (immediatePendingSignal) {
      settle(immediatePendingSignal)
      return
    }

    const immediateTerminalSignal = createTerminalRunSignal(input.getRun())
    if (immediateTerminalSignal) {
      settle(immediateTerminalSignal)
    }
  })
}

function redactAgentTaskJobPayload(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return value
  }
  const record = value as Record<string, unknown>
  return {
    ...record,
    prompt: typeof record.prompt === 'string' ? `[${record.prompt.length} chars]` : record.prompt
  }
}

function createTerminalRunSignal(run: JobRunRecord | undefined): AbortSignal | null {
  if (!run || (run.status !== 'cancelled' && run.status !== 'failed')) {
    return null
  }

  const message = typeof run.lastError === 'string' && run.lastError.trim() ? run.lastError.trim() : 'Task run was aborted.'
  const controller = new AbortController()
  if (run.status === 'cancelled') {
    controller.abort(createCancelledTerminalReason(message))
    return controller.signal
  }

  if (message.startsWith('Job timed out after ')) {
    controller.abort({
      kind: 'timeout',
      message
    })
    return controller.signal
  }

  controller.abort(new Error(message))
  return controller.signal
}

function createCancelledTerminalReason(message: string): JobCancelReason {
  if (message === 'Stopped by runtime shutdown.') {
    return {
      kind: 'shutdown',
      message
    }
  }

  return {
    kind: 'cancelled',
    message
  }
}
