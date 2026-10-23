import type {
  JobCancelReason,
  JobDefinition,
  JobHandler,
  JobRunPage,
  JobRunQuery,
  JobRunRecord
} from '../contracts/jobTypes'
import { DEFAULT_RETRY_POLICY } from '../contracts/jobTypes'
import { createConcurrencyLock } from './concurrencyLock'
import { createHandlerRegistry } from '../registry/handlerRegistry'
import { createJobExecutor } from './jobExecutor'
import { createJobRunStore } from './jobRunStore'
import type { JobRunStore } from './jobRunStore'
import { createJobScheduler } from './jobScheduler'

export type JobRuntime = {
  registerHandler: (handlerId: string, handler: JobHandler) => void
  setSchedule: (definition: JobDefinition) => void
  removeSchedule: (definitionId: string) => void
  /** Definitions currently registered with the runtime scheduler. */
  listSchedules: () => readonly JobDefinition[]
  enqueueManual: (definitionId: string) => Promise<JobRunRecord>
  enqueueStartup: (definitionId: string) => Promise<JobRunRecord>
  enqueueDefinition: (definition: JobDefinition) => Promise<JobRunRecord>
  waitForRunTerminal: (runId: string, options?: WaitForRunTerminalOptions) => Promise<JobRunTerminalObservation>
  cancel: (runId: string, reason?: JobCancelReason) => void
  getRun: (runId: string) => JobRunRecord | undefined
  listRecentRuns: (limit?: number) => JobRunRecord[]
  listRuns: (query?: JobRunQuery) => JobRunRecord[]
  listRunPage: (query?: JobRunQuery) => JobRunPage
  recover: () => JobRunRecord[]
  stopAll: () => void
  createQueuedRun: (definition: JobDefinition) => JobRunRecord
  markRunningForTest: (runId: string) => void
}

export type WaitForRunTerminalOptions = {
  timeoutMs?: number
}

export type JobRunTerminalObservation =
  | { state: 'terminal'; run: JobRunRecord }
  | { state: 'timeout' }
  | { state: 'interrupted' }

export type JobRuntimeOptions = {
  store?: JobRunStore
}

export function createJobRuntime(options: JobRuntimeOptions = {}): JobRuntime {
  const registry = createHandlerRegistry()
  const store = options.store ?? createJobRunStore()
  const lock = createConcurrencyLock()
  const executor = createJobExecutor({ registry, store })
  const definitions = new Map<string, JobDefinition>()
  const queuedRunWaits = new Map<string, QueuedRunWait>()
  const terminalRunWaits = new Map<string, Set<TerminalRunWait>>()
  let stopped = false

  const scheduler = createJobScheduler({
    enqueue: async (definition) => {
      if (stopped) return
      await dispatch(definition)
    },
    isLocked: (key) => lock.isLocked(key)
  })

  return {
    registerHandler(handlerId, handler) {
      registry.register(handlerId, handler)
    },
    setSchedule(definition) {
      definitions.set(definition.id, definition)
      scheduler.setSchedule(definition)
    },
    removeSchedule(definitionId) {
      definitions.delete(definitionId)
      scheduler.removeSchedule(definitionId)
    },
    listSchedules() {
      return [...definitions.values()]
    },
    async enqueueManual(definitionId) {
      const definition = requireDefinition(definitions, definitionId)
      assertHandlerRegistered(registry, definition.handlerId)
      return dispatch(definition)
    },
    async enqueueStartup(definitionId) {
      const definition = requireDefinition(definitions, definitionId)
      assertHandlerRegistered(registry, definition.handlerId)
      if (definition.trigger.kind !== 'startup') {
        throw new Error(`Startup trigger is not configured for "${definitionId}".`)
      }
      return dispatch(definition)
    },
    async enqueueDefinition(definition) {
      assertHandlerRegistered(registry, definition.handlerId)
      return dispatch(definition)
    },
    waitForRunTerminal(runId, options) {
      const run = store.getRun(runId)
      if (isTerminalRun(run)) {
        return Promise.resolve({ state: 'terminal', run })
      }
      if (stopped) {
        return Promise.resolve({ state: 'interrupted' })
      }
      return beginTerminalRunWait(runId, options?.timeoutMs, terminalRunWaits)
    },
    cancel(runId, reason) {
      const run = store.getRun(runId)
      if (!run) return
      const queuedWait = queuedRunWaits.get(runId)
      if (queuedWait) {
        queuedWait.controller.abort(reason ?? createCancelledReason())
        interruptTerminalRunWaits(runId, terminalRunWaits)
        return
      }
      if (run.status === 'queued') {
        store.markCancelled(runId, reason)
        finalizeTerminalRunWaits(runId, terminalRunWaits, store.getRun(runId))
        return
      }
      executor.cancelRun(runId, reason)
      interruptTerminalRunWaits(runId, terminalRunWaits)
    },
    getRun(runId) {
      return store.getRun(runId)
    },
    listRecentRuns(limit = 20) {
      return store.listRecentRuns(limit)
    },
    listRuns(query) {
      return store.queryRuns(query)
    },
    listRunPage(query) {
      return store.queryRunPage(query)
    },
    recover() {
      // Runs left `running` by a previous process are unfinishable; runs left `queued` were
      // never started and never will be, because the queue lives in this process. Both are
      // settled here, before any product startup work can enqueue current-process runs, so a
      // reader of the job store never sees a row that no process can advance.
      const recoveredRuns = [...store.recoverStaleRunningRuns(), ...store.recoverStaleQueuedRuns()]
      for (const run of recoveredRuns) {
        finalizeTerminalRunWaits(run.id, terminalRunWaits, run)
      }
      return recoveredRuns
    },
    stopAll() {
      stopped = true
      scheduler.stopAll()
      for (const [runId, queuedWait] of queuedRunWaits) {
        queuedWait.controller.abort(createShutdownReason())
        clearQueuedRunWait(runId, queuedRunWaits)
        finalizeQueuedRunWait(store, runId, queuedWait.controller.signal)
        finalizeTerminalRunWaits(runId, terminalRunWaits, store.getRun(runId))
      }
      for (const run of store.queryRuns({ statuses: ['running'] })) {
        executor.cancelRun(run.id, createShutdownReason())
        interruptTerminalRunWaits(run.id, terminalRunWaits)
      }
      definitions.clear()
    },
    createQueuedRun(definition) {
      return store.createRun(toRunInput(definition))
    },
    markRunningForTest(runId) {
      store.markRunning(runId)
    }
  }

  async function dispatch(definition: JobDefinition): Promise<JobRunRecord> {
    if (stopped) {
      throw new Error(`Job runtime is stopped.`)
    }
    const run = store.createRun(toRunInput(definition))
    const queuedRunWait = definition.concurrencyKey
      ? beginQueuedRunWait(run.id, definition.timeoutMs, queuedRunWaits)
      : null

    let release: (() => void) | null = null
    try {
      release = definition.concurrencyKey
        ? await lock.acquire(definition.concurrencyKey, queuedRunWait?.controller.signal)
        : null
    } catch {
      clearQueuedRunWait(run.id, queuedRunWaits)
      finalizeQueuedRunWait(store, run.id, queuedRunWait?.controller.signal)
      finalizeTerminalRunWaits(run.id, terminalRunWaits, store.getRun(run.id))
      return run
    }

    clearQueuedRunWait(run.id, queuedRunWaits)
    if (queuedRunWait?.controller.signal.aborted) {
      release?.()
      finalizeQueuedRunWait(store, run.id, queuedRunWait.controller.signal)
      return run
    }
    if (stopped) {
      release?.()
      store.markCancelled(run.id, createShutdownReason())
      finalizeTerminalRunWaits(run.id, terminalRunWaits, store.getRun(run.id))
      return run
    }

    const remainingTimeoutMs = computeRemainingTimeoutMs(definition.timeoutMs, queuedRunWait?.queuedAtMs)
    if (typeof remainingTimeoutMs === 'number' && remainingTimeoutMs <= 0) {
      release?.()
      store.markFailed(run.id, createTimeoutReason(definition.timeoutMs ?? 0).message)
      finalizeTerminalRunWaits(run.id, terminalRunWaits, store.getRun(run.id))
      return run
    }

    void executor
      .executeRun(run.id, {
        handlerId: definition.handlerId,
        payload: definition.payload,
        retryPolicy: definition.retryPolicy ?? DEFAULT_RETRY_POLICY,
        timeoutMs: remainingTimeoutMs,
        timeoutReason:
          typeof definition.timeoutMs === 'number' && definition.timeoutMs > 0
            ? createTimeoutReason(definition.timeoutMs)
            : undefined,
        redact: definition.redact
      })
      .finally(() => {
        release?.()
        scheduler.notifyRunCompleted(definition.id)
        finalizeTerminalRunWaits(run.id, terminalRunWaits, store.getRun(run.id))
      })

    return run
  }
}

type TerminalRunWait = {
  resolve: (observation: JobRunTerminalObservation) => void
  timeout?: ReturnType<typeof setTimeout>
}

function beginTerminalRunWait(
  runId: string,
  timeoutMs: number | undefined,
  terminalRunWaits: Map<string, Set<TerminalRunWait>>
): Promise<JobRunTerminalObservation> {
  return new Promise((resolve) => {
    const wait: TerminalRunWait = { resolve }
    if (typeof timeoutMs === 'number' && timeoutMs > 0) {
      wait.timeout = setTimeout(() => {
        removeTerminalRunWait(runId, wait, terminalRunWaits)
        resolve({ state: 'timeout' })
      }, timeoutMs)
    }
    const waits = terminalRunWaits.get(runId) ?? new Set<TerminalRunWait>()
    waits.add(wait)
    terminalRunWaits.set(runId, waits)
  })
}

function finalizeTerminalRunWaits(
  runId: string,
  terminalRunWaits: Map<string, Set<TerminalRunWait>>,
  run: JobRunRecord | undefined
): void {
  if (!isTerminalRun(run)) return
  settleTerminalRunWaits(runId, terminalRunWaits, { state: 'terminal', run })
}

function interruptTerminalRunWaits(
  runId: string,
  terminalRunWaits: Map<string, Set<TerminalRunWait>>
): void {
  settleTerminalRunWaits(runId, terminalRunWaits, { state: 'interrupted' })
}

function settleTerminalRunWaits(
  runId: string,
  terminalRunWaits: Map<string, Set<TerminalRunWait>>,
  observation: JobRunTerminalObservation
): void {
  const waits = terminalRunWaits.get(runId)
  if (!waits) return
  terminalRunWaits.delete(runId)
  for (const wait of waits) {
    if (wait.timeout) clearTimeout(wait.timeout)
    wait.resolve(observation)
  }
}

function removeTerminalRunWait(
  runId: string,
  wait: TerminalRunWait,
  terminalRunWaits: Map<string, Set<TerminalRunWait>>
): void {
  const waits = terminalRunWaits.get(runId)
  if (!waits) return
  waits.delete(wait)
  if (waits.size === 0) terminalRunWaits.delete(runId)
}

function isTerminalRun(run: JobRunRecord | undefined): run is JobRunRecord {
  return run?.status === 'completed' || run?.status === 'failed' || run?.status === 'cancelled'
}

function requireDefinition(definitions: Map<string, JobDefinition>, definitionId: string): JobDefinition {
  const definition = definitions.get(definitionId)
  if (!definition) {
    throw new Error(`Unknown job definition "${definitionId}".`)
  }
  return definition
}

function assertHandlerRegistered(registry: ReturnType<typeof createHandlerRegistry>, handlerId: string): void {
  if (!registry.has(handlerId)) {
    throw new Error(`Unknown job handler "${handlerId}".`)
  }
}

function toRunInput(definition: JobDefinition) {
  return {
    definitionId: definition.id,
    handlerId: definition.handlerId,
    owner: definition.owner,
    productId: definition.productId,
    title: definition.title,
    trigger: definition.trigger,
    payload: definition.payload,
    concurrencyKey: definition.concurrencyKey,
    maxAttempts: definition.retryPolicy?.maxAttempts ?? DEFAULT_RETRY_POLICY.maxAttempts
  }
}

type QueuedRunWait = {
  controller: AbortController
  queuedAtMs: number
  timeout?: ReturnType<typeof setTimeout>
}

function beginQueuedRunWait(
  runId: string,
  timeoutMs: number | undefined,
  queuedRunWaits: Map<string, QueuedRunWait>
): QueuedRunWait {
  const controller = new AbortController()
  const queuedRunWait: QueuedRunWait = {
    controller,
    queuedAtMs: Date.now()
  }
  if (typeof timeoutMs === 'number' && timeoutMs > 0) {
    queuedRunWait.timeout = setTimeout(() => {
      controller.abort(createTimeoutReason(timeoutMs))
    }, timeoutMs)
  }
  queuedRunWaits.set(runId, queuedRunWait)
  return queuedRunWait
}

function clearQueuedRunWait(runId: string, queuedRunWaits: Map<string, QueuedRunWait>): void {
  const queuedRunWait = queuedRunWaits.get(runId)
  if (!queuedRunWait) return
  if (queuedRunWait.timeout) {
    clearTimeout(queuedRunWait.timeout)
  }
  queuedRunWaits.delete(runId)
}

function finalizeQueuedRunWait(
  store: JobRunStore,
  runId: string,
  signal: AbortSignal | undefined
): JobRunRecord | undefined {
  const reason = readCancelReason(signal)
  if (reason?.kind === 'timeout') {
    return store.markFailed(runId, reason.message)
  }
  return store.markCancelled(runId, reason ?? createCancelledReason())
}

function computeRemainingTimeoutMs(timeoutMs: number | undefined, queuedAtMs: number | undefined): number | undefined {
  if (typeof timeoutMs !== 'number' || timeoutMs <= 0) return undefined
  if (typeof queuedAtMs !== 'number') return timeoutMs
  return Math.max(0, timeoutMs - (Date.now() - queuedAtMs))
}

function createCancelledReason(message = 'Cancelled by user.'): JobCancelReason {
  return { kind: 'cancelled', message }
}

function createShutdownReason(): JobCancelReason {
  return {
    kind: 'shutdown',
    message: 'Stopped by runtime shutdown.'
  }
}

function createTimeoutReason(timeoutMs: number): JobCancelReason {
  return {
    kind: 'timeout',
    message: `Job timed out after ${timeoutMs}ms.`
  }
}

function readCancelReason(signal: AbortSignal | undefined): JobCancelReason | undefined {
  if (!signal?.aborted) return undefined
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
