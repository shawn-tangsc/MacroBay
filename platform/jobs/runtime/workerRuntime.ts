import type { RetryPolicy } from '../contracts/jobTypes'
import type {
  ManagedWorkerContext,
  ManagedWorkerDefinition,
  ManagedWorkerHandler,
  WorkerRunRecord
} from '../contracts/workerTypes'
import { createConcurrencyLock } from './concurrencyLock'
import { redactJobLogEntry } from './logRedaction'
import { createWorkerRunStore } from './workerRunStore'

export type ManagedWorkerRuntime = {
  registerHandler: (handlerId: string, handler: ManagedWorkerHandler) => void
  setDesiredWorker: (definition: ManagedWorkerDefinition) => Promise<WorkerRunRecord>
  removeDesiredWorker: (definitionId: string) => Promise<void>
  restartWorker: (definitionId: string) => Promise<WorkerRunRecord>
  stopWorker: (definitionId: string) => Promise<void>
  getWorker: (definitionId: string) => WorkerRunRecord | undefined
  listWorkers: () => WorkerRunRecord[]
  recover: () => Promise<WorkerRunRecord[]>
  stopAll: () => void
  simulateStaleStateForTest: () => WorkerRunRecord[]
}

type ActiveWorker = {
  controller: AbortController
  runId: string
  heartbeatCheckTimer?: ReturnType<typeof setInterval>
  completion: Promise<void>
}

// An explicit start owns a retry budget and cancellation across successor runs.
type WorkerRestartChain = {
  controller: AbortController
  initial?: Promise<WorkerRunRecord>
}

export function createManagedWorkerRuntime(): ManagedWorkerRuntime {
  const handlers = new Map<string, ManagedWorkerHandler>()
  const store = createWorkerRunStore()
  const desiredWorkers = new Map<string, ManagedWorkerDefinition>()
  const activeWorkers = new Map<string, ActiveWorker>()
  const restartChains = new Map<string, WorkerRestartChain>()
  const lock = createConcurrencyLock()

  return {
    registerHandler(handlerId, handler) {
      if (handlers.has(handlerId)) {
        throw new Error(`Worker handler "${handlerId}" is already registered.`)
      }
      handlers.set(handlerId, handler)
    },
    async setDesiredWorker(definition) {
      assertHandlerRegistered(handlers, definition.handlerId)
      desiredWorkers.set(definition.id, definition)
      const chain = restartChains.get(definition.id)
      if (chain) {
        const current = store.getRunByDefinitionId(definition.id)
        if (current) return current
        if (chain.initial) return chain.initial
      }

      return startWorker(definition)
    },
    async removeDesiredWorker(definitionId) {
      desiredWorkers.delete(definitionId)
      await stopActiveWorker(definitionId, 'removed')
      restartChains.delete(definitionId)
      store.clearRunForDefinition(definitionId)
    },
    async restartWorker(definitionId) {
      const definition = requireDesiredWorker(desiredWorkers, definitionId)
      assertHandlerRegistered(handlers, definition.handlerId)
      await stopActiveWorker(definitionId, 'restart')
      return startWorker(definition)
    },
    async stopWorker(definitionId) {
      await stopActiveWorker(definitionId, 'stop')
    },
    getWorker(definitionId) {
      return store.getRunByDefinitionId(definitionId)
    },
    listWorkers() {
      return store.listRuns()
    },
    async recover() {
      for (const chain of restartChains.values()) chain.controller.abort()
      restartChains.clear()
      const recovered = store.recoverStaleActiveRuns()
      activeWorkers.clear()

      const restarted: WorkerRunRecord[] = []
      for (const definition of desiredWorkers.values()) {
        if (!handlers.has(definition.handlerId)) continue
        restarted.push(await startWorker(definition))
      }

      return [...recovered, ...restarted]
    },
    stopAll() {
      for (const chain of restartChains.values()) chain.controller.abort()
      for (const definitionId of [...activeWorkers.keys()]) {
        void stopActiveWorker(definitionId, 'shutdown')
      }
      desiredWorkers.clear()
      restartChains.clear()
    },
    simulateStaleStateForTest() {
      for (const active of activeWorkers.values()) {
        active.controller.abort()
        clearActiveTimers(active)
      }
      activeWorkers.clear()
      return store.recoverStaleActiveRuns()
    }
  }

  function startWorker(definition: ManagedWorkerDefinition): Promise<WorkerRunRecord> {
    const chain: WorkerRestartChain = { controller: new AbortController() }
    restartChains.set(definition.id, chain)
    chain.initial = startWorkerInternal(definition, chain, 0)
    return chain.initial
  }

  async function startWorkerInternal(
    definition: ManagedWorkerDefinition, chain: WorkerRestartChain, restartAttempt: number
  ): Promise<WorkerRunRecord> {
    let heldRelease = definition.concurrencyKey
      ? await lock.acquire(definition.concurrencyKey, chain.controller.signal) : null
    const release = () => {
      const ownedRelease = heldRelease
      heldRelease = null
      ownedRelease?.()
    }
    if (chain.controller.signal.aborted) {
      release()
      throw chain.controller.signal.reason
    }

    const run = store.createRun({
      definitionId: definition.id,
      handlerId: definition.handlerId,
      owner: definition.owner,
      productId: definition.productId,
      title: definition.title,
      payload: definition.payload,
      concurrencyKey: definition.concurrencyKey,
      restartAttempt
    })

    const controller = new AbortController()
    let resolveCompletion!: () => void
    const completion = new Promise<void>((resolve) => {
      resolveCompletion = resolve
    })

    const active: ActiveWorker = { controller, runId: run.id, completion }
    activeWorkers.set(definition.id, active)

    if (definition.heartbeatPolicy) {
      active.heartbeatCheckTimer = setInterval(() => {
        checkHeartbeat(definition, active)
      }, definition.heartbeatPolicy.expectedIntervalMs)
    }

    void executeWorker(definition, active, chain, release, resolveCompletion)

    return run
  }

  async function executeWorker(
    definition: ManagedWorkerDefinition,
    active: ActiveWorker,
    chain: WorkerRestartChain,
    releaseLock: (() => void) | null,
    resolveCompletion: () => void
  ): Promise<void> {
    const context = createWorkerContext(definition, active)

    try {
      const handler = handlers.get(definition.handlerId)
      if (!handler) {
        throw new Error(`Unknown worker handler "${definition.handlerId}".`)
      }
      await handler(definition.payload, context)

      if (active.controller.signal.aborted) {
        store.markStopped(active.runId)
        return
      }

      if (desiredWorkers.has(definition.id)) {
        await scheduleRestart(definition, active, chain, releaseLock)
        return
      }

      store.markStopped(active.runId)
    } catch (error) {
      const message = redactErrorMessage(error, definition.redact)
      if (active.controller.signal.aborted) {
        store.markStopped(active.runId)
      } else {
        store.markFailed(active.runId, message)
        if (desiredWorkers.has(definition.id)) {
          await scheduleRestart(definition, active, chain, releaseLock)
          return
        }
      }
    } finally {
      clearActiveTimers(active)
      if (activeWorkers.get(definition.id) === active) activeWorkers.delete(definition.id)
      releaseLock?.()
      resolveCompletion()
    }
  }

  async function scheduleRestart(
    definition: ManagedWorkerDefinition,
    active: ActiveWorker,
    chain: WorkerRestartChain,
    releaseLock: (() => void) | null
  ): Promise<void> {
    releaseLock?.()
    clearActiveTimers(active)

    const run = store.getRun(active.runId)
    if (!run) return

    const attempt = run.restartAttempt + 1
    const maxAttempts = Math.max(1, definition.restartPolicy.maxAttempts)

    if (attempt > maxAttempts) {
      store.markFailed(active.runId, 'Worker exceeded restart policy limit.')
      return
    }

    store.markReconnecting(active.runId)

    const delayMs = computeBackoffDelay(definition.restartPolicy, attempt)
    await delay(delayMs, chain.controller.signal)

    if (chain.controller.signal.aborted || restartChains.get(definition.id) !== chain || !desiredWorkers.has(definition.id)) {
      store.markStopped(active.runId)
      return
    }

    store.markStopped(active.runId)
    try {
      await startWorkerInternal(definition, chain, attempt)
    } catch (error) {
      if (!chain.controller.signal.aborted) throw error
    }
  }

  async function stopActiveWorker(definitionId: string, reason: string): Promise<void> {
    restartChains.get(definitionId)?.controller.abort()
    const active = activeWorkers.get(definitionId)
    if (!active) {
      const run = store.getRunByDefinitionId(definitionId)
      if (run && isActiveStatus(run.status)) {
        store.markStopped(run.id)
      }
      return
    }

    store.markStopping(active.runId)
    store.appendLog(active.runId, {
      level: 'info',
      message: `Stopping worker (${reason}).`
    })
    active.controller.abort()
    clearActiveTimers(active)
    await active.completion
  }

  function checkHeartbeat(definition: ManagedWorkerDefinition, active: ActiveWorker): void {
    const policy = definition.heartbeatPolicy
    if (!policy) return

    const run = store.getRun(active.runId)
    if (!run || !isActiveStatus(run.status)) return

    const lastHeartbeat = run.lastHeartbeatAt ?? run.liveAt ?? run.startedAt
    if (!lastHeartbeat) return

    const elapsedMs = Date.now() - new Date(lastHeartbeat).getTime()
    if (elapsedMs < policy.expectedIntervalMs) return

    const updated = store.incrementMissedHeartbeats(active.runId)
    if (!updated) return

    if (updated.missedHeartbeats >= policy.missedHeartbeatLimit) {
      store.markDegraded(active.runId, 'Missed heartbeat limit exceeded.')
    }
  }

  function createWorkerContext(
    definition: ManagedWorkerDefinition,
    active: ActiveWorker
  ): ManagedWorkerContext {
    return {
      workerRunId: active.runId,
      signal: active.controller.signal,
      async log(entry) {
        const redacted = redactJobLogEntry(entry, definition.redact)
        store.appendLog(active.runId, redacted)
      },
      async heartbeat(metadata) {
        store.recordHeartbeat(active.runId)
        void metadata
      },
      async markLive() {
        store.markLive(active.runId)
        store.recordHeartbeat(active.runId)
      },
      async markDegraded(reason) {
        store.markDegraded(active.runId, reason)
      }
    }
  }
}

function assertHandlerRegistered(handlers: Map<string, ManagedWorkerHandler>, handlerId: string): void {
  if (!handlers.has(handlerId)) {
    throw new Error(`Unknown worker handler "${handlerId}".`)
  }
}

function requireDesiredWorker(
  desiredWorkers: Map<string, ManagedWorkerDefinition>,
  definitionId: string
): ManagedWorkerDefinition {
  const definition = desiredWorkers.get(definitionId)
  if (!definition) {
    throw new Error(`Unknown worker definition "${definitionId}".`)
  }
  return definition
}

function isActiveStatus(status: WorkerRunRecord['status']): boolean {
  return status === 'starting' || status === 'live' || status === 'degraded' || status === 'reconnecting'
}

function clearActiveTimers(active: ActiveWorker): void {
  if (active.heartbeatCheckTimer) clearInterval(active.heartbeatCheckTimer)
}

function computeBackoffDelay(policy: RetryPolicy, attempt: number): number {
  if (policy.backoff === 'none') return 0
  if (policy.backoff === 'fixed') return policy.baseDelayMs
  const exponential = policy.baseDelayMs * 2 ** (attempt - 1)
  return Math.min(exponential, policy.maxDelayMs)
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  if (ms <= 0 || signal.aborted) return Promise.resolve()
  return new Promise((resolve) => {
    const complete = () => {
      clearTimeout(timer)
      signal.removeEventListener('abort', complete)
      resolve()
    }
    const timer = setTimeout(complete, ms)
    signal.addEventListener('abort', complete, { once: true })
  })
}

function redactErrorMessage(error: unknown, redact?: (value: unknown) => unknown): string {
  const message = error instanceof Error ? error.message : 'Worker failed.'
  const redacted = redactJobLogEntry({ level: 'error', message }, redact)
  return redacted.message
}
