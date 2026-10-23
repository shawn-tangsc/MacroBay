import type { JobCancelReason, JobContext, RetryPolicy } from '../contracts/jobTypes'
import type { HandlerRegistry } from '../registry/handlerRegistry'
import { redactJobLogEntry } from './logRedaction'
import type { JobRunStore } from './jobRunStore'

export type ExecuteRunInput = {
  handlerId: string
  payload: unknown
  retryPolicy: RetryPolicy
  timeoutMs?: number
  timeoutReason?: JobCancelReason
  redact?: (value: unknown) => unknown
}

export type JobExecutor = {
  executeRun: (runId: string, input: ExecuteRunInput) => Promise<void>
  cancelRun: (runId: string, reason?: JobCancelReason) => void
}

type ActiveRun = {
  controller: AbortController
  cancelReason?: JobCancelReason
  timeout?: ReturnType<typeof setTimeout>
}

export function createJobExecutor(deps: {
  registry: HandlerRegistry
  store: JobRunStore
}): JobExecutor {
  const activeRuns = new Map<string, ActiveRun>()

  return {
    async executeRun(runId, input) {
      const run = deps.store.markRunning(runId)
      if (!run) return

      const controller = new AbortController()
      const activeRun: ActiveRun = {
        controller
      }
      const timeout =
        typeof input.timeoutMs === 'number' && input.timeoutMs > 0
          ? (() => {
              const timeoutMs = input.timeoutMs
              return setTimeout(() => {
                activeRun.cancelReason = input.timeoutReason ?? createTimeoutReason(timeoutMs)
                controller.abort(activeRun.cancelReason)
              }, timeoutMs)
            })()
          : undefined
      activeRun.timeout = timeout
      activeRuns.set(runId, activeRun)

      const context = createJobContext(runId, controller.signal, deps.store, input.redact)

      try {
        await executeWithRetry({
          registry: deps.registry,
          store: deps.store,
          runId,
          input,
          context,
          signal: controller.signal
        })
        if (controller.signal.aborted) {
          const reason = activeRun.cancelReason ?? readCancelReason(controller.signal)
          if (reason?.kind === 'timeout') {
            deps.store.markFailed(runId, reason.message)
          } else {
            deps.store.markCancelled(runId, reason)
          }
          return
        }
        deps.store.markCompleted(runId)
      } catch (error) {
        if (controller.signal.aborted) {
          const reason = activeRun.cancelReason ?? readCancelReason(controller.signal)
          if (reason?.kind === 'timeout') {
            deps.store.markFailed(runId, reason.message)
          } else {
            deps.store.markCancelled(runId, reason)
          }
        } else {
          deps.store.markFailed(runId, error instanceof Error ? error.message : 'Job failed.')
        }
      } finally {
        if (timeout) clearTimeout(timeout)
        activeRuns.delete(runId)
      }
    },
    cancelRun(runId, reason) {
      const activeRun = activeRuns.get(runId)
      if (!activeRun) return
      activeRun.cancelReason = reason ?? createCancelledReason()
      activeRun.controller.abort(activeRun.cancelReason)
    }
  }
}

async function executeWithRetry(args: {
  registry: HandlerRegistry
  store: JobRunStore
  runId: string
  input: ExecuteRunInput
  context: JobContext
  signal: AbortSignal
}): Promise<void> {
  const maxAttempts = Math.max(1, args.input.retryPolicy.maxAttempts)
  let attempt = 1

  while (attempt <= maxAttempts) {
    if (args.signal.aborted) return

    try {
      await args.registry.invoke(args.input.handlerId, args.input.payload, args.context)
      return
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Job failed.'
      if (attempt >= maxAttempts) throw new Error(message)

      const delayMs = computeBackoffDelay(args.input.retryPolicy, attempt)
      await args.store.incrementAttempt(args.runId)
      await args.context.log({
        level: 'warn',
        message: `Retrying after failure: ${message}`,
        metadata: { attempt: attempt + 1, delayMs }
      })
      await delay(delayMs, args.signal)
      attempt += 1
    }
  }
}

function createJobContext(
  runId: string,
  signal: AbortSignal,
  store: JobRunStore,
  redact?: (value: unknown) => unknown
): JobContext {
  return {
    jobRunId: runId,
    signal,
    async log(entry) {
      const redacted = redactJobLogEntry(
        {
          at: entry.at,
          level: entry.level,
          message: entry.message,
          metadata: entry.metadata
        },
        redact
      )
      store.appendLog(runId, redacted)
    },
    async progress(progress) {
      store.setProgress(runId, progress)
    }
  }
}

function computeBackoffDelay(policy: RetryPolicy, attempt: number): number {
  if (policy.backoff === 'none') return 0
  if (policy.backoff === 'fixed') return policy.baseDelayMs
  const exponential = policy.baseDelayMs * 2 ** (attempt - 1)
  return Math.min(exponential, policy.maxDelayMs)
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0 || signal?.aborted) return Promise.resolve()
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      signal?.removeEventListener('abort', handleAbort)
      resolve()
    }, ms)

    const handleAbort = () => {
      clearTimeout(timeout)
      signal?.removeEventListener('abort', handleAbort)
      resolve()
    }

    signal?.addEventListener('abort', handleAbort, { once: true })
  })
}

function createCancelledReason(message = 'Cancelled by user.'): JobCancelReason {
  return { kind: 'cancelled', message }
}

function createTimeoutReason(timeoutMs: number): JobCancelReason {
  return {
    kind: 'timeout',
    message: `Job timed out after ${timeoutMs}ms.`
  }
}

function readCancelReason(signal: AbortSignal): JobCancelReason | undefined {
  const reason = signal.reason
  if (!reason || typeof reason !== 'object') return undefined
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
  return undefined
}
