import { describe, expect, it, vi } from 'vitest'

import { DEFAULT_RETRY_POLICY } from '../contracts/jobTypes'
import { createWorkerRunStore } from './workerRunStore'
import { createManagedWorkerRuntime } from './workerRuntime'

describe('workerRunStore', () => {
  it('creates a worker run in starting status', () => {
    const store = createWorkerRunStore()
    const run = store.createRun(baseInput())

    expect(run.status).toBe('starting')
    expect(run.startedAt).toBeTruthy()
  })

  it('markLive updates status and timestamp', () => {
    const store = createWorkerRunStore()
    const run = store.createRun(baseInput())

    const live = store.markLive(run.id)
    expect(live?.status).toBe('live')
    expect(live?.liveAt).toBeTruthy()
  })

  it('missed heartbeat changes status to degraded', () => {
    const store = createWorkerRunStore()
    const run = store.createRun(baseInput())
    store.markLive(run.id)

    store.incrementMissedHeartbeats(run.id)
    store.incrementMissedHeartbeats(run.id)
    const degraded = store.markDegraded(run.id, 'Missed heartbeat limit exceeded.')

    expect(degraded?.status).toBe('degraded')
    expect(degraded?.degradedReason).toContain('heartbeat')
  })

  it('stop changes status to stopping then stopped', () => {
    const store = createWorkerRunStore()
    const run = store.createRun(baseInput())
    store.markLive(run.id)

    const stopping = store.markStopping(run.id)
    expect(stopping?.status).toBe('stopping')

    const stopped = store.markStopped(run.id)
    expect(stopped?.status).toBe('stopped')
    expect(stopped?.stoppedAt).toBeTruthy()
  })

  it('failed handler stores redacted error summary', () => {
    const store = createWorkerRunStore()
    const run = store.createRun(baseInput())

    const failed = store.markFailed(run.id, 'apiKey=secret-value failed')
    expect(failed?.status).toBe('failed')
    expect(failed?.lastError).not.toContain('secret-value')
    expect(failed?.lastError).toContain('[REDACTED]')
  })

  it('caps retained worker logs to prevent long-running stream workers from growing unbounded', () => {
    const store = createWorkerRunStore()
    const run = store.createRun(baseInput())

    for (let index = 0; index < 250; index += 1) {
      store.appendLog(run.id, {
        level: 'debug',
        message: `log-${index}`
      })
    }

    const updated = store.getRun(run.id)
    expect(updated?.logs).toHaveLength(200)
    expect(updated?.logs[0]?.message).toBe('log-50')
    expect(updated?.logs.at(-1)?.message).toBe('log-249')
  })
})

describe('managedWorkerRuntime', () => {
  it.each(['throw', 'return'] as const)('bounds a live-marked %s restart chain with increasing capped backoff', async (outcome) => {
    vi.useFakeTimers()
    const runtime = createManagedWorkerRuntime()
    const starts: number[] = []
    runtime.registerHandler('failing', async (_payload, context) => {
      starts.push(Date.now())
      await context.markLive()
      if (outcome === 'throw') throw new Error('synthetic failure')
    })
    const definition = workerDefinition('chain', 'failing', {
      maxAttempts: 4, backoff: 'exponential', baseDelayMs: 2000, maxDelayMs: 5000
    })
    try {
      await runtime.setDesiredWorker(definition)
      await vi.advanceTimersByTimeAsync(0)
      const initial = starts[0]
      await vi.advanceTimersByTimeAsync(2000)
      expect(starts.map((at) => at - initial)).toEqual([0, 2000])
      await vi.advanceTimersByTimeAsync(3999)
      expect(starts).toHaveLength(2)
      await vi.advanceTimersByTimeAsync(10001)
      expect(starts.map((at) => at - initial)).toEqual([0, 2000, 6000, 11000, 16000])
      expect(runtime.getWorker('chain')).toMatchObject({ status: 'failed', restartAttempt: 4 })
      await runtime.setDesiredWorker(definition)
      await vi.advanceTimersByTimeAsync(60000)
      expect(starts).toHaveLength(5)
      await runtime.restartWorker('chain')
      await vi.advanceTimersByTimeAsync(2000)
      expect(starts).toHaveLength(7)
    } finally {
      runtime.stopAll()
      await vi.advanceTimersByTimeAsync(0)
      vi.useRealTimers()
    }
  })

  it.each(['stop', 'remove', 'shutdown'] as const)('cancels backoff on %s without resurrecting an old chain', async (operation) => {
    vi.useFakeTimers()
    const runtime = createManagedWorkerRuntime()
    let starts = 0
    runtime.registerHandler('early-return', async () => { starts += 1 })
    const definition = workerDefinition('chain', 'early-return', {
      maxAttempts: 3, backoff: 'fixed', baseDelayMs: 2000, maxDelayMs: 2000
    })
    try {
      await runtime.setDesiredWorker(definition)
      await vi.advanceTimersByTimeAsync(0)
      const waitingId = runtime.getWorker('chain')?.id
      await runtime.setDesiredWorker(definition)
      expect(runtime.getWorker('chain')?.id).toBe(waitingId)
      expect(starts).toBe(1)
      if (operation === 'stop') await runtime.stopWorker('chain')
      if (operation === 'remove') await runtime.removeDesiredWorker('chain')
      if (operation === 'shutdown') runtime.stopAll()
      await vi.advanceTimersByTimeAsync(20000)
      expect(starts).toBe(1)
      if (operation !== 'remove') expect(runtime.getWorker('chain')?.status).toBe('stopped')
      if (operation === 'remove') {
        await runtime.setDesiredWorker(definition)
        await vi.advanceTimersByTimeAsync(2000)
        expect(starts).toBe(3)
      }
    } finally {
      runtime.stopAll()
      await vi.advanceTimersByTimeAsync(0)
      vi.useRealTimers()
    }
  })

  it('isolates automatic budgets between definitions and preserves zero normalization', async () => {
    vi.useFakeTimers()
    const runtime = createManagedWorkerRuntime()
    const counts = new Map<string, number>()
    runtime.registerHandler('returns', async (payload) => {
      const id = (payload as { id: string }).id
      counts.set(id, (counts.get(id) ?? 0) + 1)
    })
    try {
      for (const [id, maxAttempts] of [['zero', 0], ['two', 2]] as const) {
        await runtime.setDesiredWorker(workerDefinition(id, 'returns', {
          maxAttempts, backoff: 'fixed', baseDelayMs: 10, maxDelayMs: 10
        }))
      }
      await vi.advanceTimersByTimeAsync(100)
      expect(Object.fromEntries(counts)).toEqual({ zero: 2, two: 3 })
    } finally {
      runtime.stopAll()
      await vi.advanceTimersByTimeAsync(0)
      vi.useRealTimers()
    }
  })

  it('keeps successor ownership and does not release its lock from predecessor cleanup', async () => {
    vi.useFakeTimers()
    const runtime = createManagedWorkerRuntime()
    let starts = 0
    let otherStarts = 0
    runtime.registerHandler('successor', async (_payload, context) => {
      starts += 1
      if (starts === 1) return
      await context.markLive()
      await new Promise<void>((resolve) => context.signal.addEventListener('abort', () => resolve(), { once: true }))
    })
    runtime.registerHandler('other', async (_payload, context) => {
      otherStarts += 1
      await new Promise<void>((resolve) => context.signal.addEventListener('abort', () => resolve(), { once: true }))
    })
    try {
      await runtime.setDesiredWorker({ ...workerDefinition('chain', 'successor', {
        maxAttempts: 1, backoff: 'fixed', baseDelayMs: 10, maxDelayMs: 10
      }), concurrencyKey: 'shared' })
      await vi.advanceTimersByTimeAsync(10)
      expect(starts).toBe(2)
      const other = runtime.setDesiredWorker({ ...workerDefinition('other', 'other'), concurrencyKey: 'shared' })
      await vi.advanceTimersByTimeAsync(0)
      expect(otherStarts).toBe(0)
      await runtime.stopWorker('chain')
      await other
      await vi.advanceTimersByTimeAsync(0)
      expect(otherStarts).toBe(1)
      expect(runtime.getWorker('chain')?.status).toBe('stopped')
      await runtime.stopWorker('other')
    } finally {
      runtime.stopAll()
      await vi.advanceTimersByTimeAsync(0)
      vi.useRealTimers()
    }
  })

  it('throws when handler is unknown before starting', async () => {
    const runtime = createManagedWorkerRuntime()

    await expect(
      runtime.setDesiredWorker({
        id: 'worker-1',
        owner: 'product',
        productId: 'demo-product',
        handlerId: 'missing',
        title: 'Missing',
        payload: {},
        restartPolicy: DEFAULT_RETRY_POLICY
      })
    ).rejects.toThrow('Unknown worker handler "missing".')
  })

  it('setDesiredWorker starts one worker', async () => {
    const runtime = createManagedWorkerRuntime()
    let started = false

    runtime.registerHandler('live-worker', async (_payload, context) => {
      started = true
      await context.markLive()
      await new Promise((resolve) => setTimeout(resolve, 50))
    })

    const record = await runtime.setDesiredWorker(workerDefinition('worker-live', 'live-worker'))

    await vi.waitFor(() => {
      expect(started).toBe(true)
      expect(runtime.getWorker('worker-live')?.status).toBe('live')
    })

    expect(record.status).toBe('starting')
    runtime.stopAll()
  })

  it('setting the same worker twice does not create two live workers', async () => {
    const runtime = createManagedWorkerRuntime()
    let startCount = 0

    runtime.registerHandler('counter', async (_payload, context) => {
      startCount += 1
      await context.markLive()
      await new Promise((resolve) => setTimeout(resolve, 100))
    })

    const definition = workerDefinition('worker-counter', 'counter')
    await runtime.setDesiredWorker(definition)
    await runtime.setDesiredWorker(definition)

    await vi.waitFor(() => {
      expect(runtime.getWorker('worker-counter')?.status).toBe('live')
    })

    expect(startCount).toBe(1)
    runtime.stopAll()
  })

  it('restartWorker cancels the old worker and starts a new one', async () => {
    const runtime = createManagedWorkerRuntime()
    let startCount = 0

    runtime.registerHandler('restartable', async (_payload, context) => {
      startCount += 1
      await context.markLive()
      await new Promise((resolve) => setTimeout(resolve, 200))
    })

    const definition = workerDefinition('worker-restart', 'restartable', {
      maxAttempts: 3,
      backoff: 'none',
      baseDelayMs: 0,
      maxDelayMs: 0
    })

    await runtime.setDesiredWorker(definition)
    await vi.waitFor(() => {
      expect(runtime.getWorker('worker-restart')?.status).toBe('live')
    })

    await runtime.restartWorker('worker-restart')

    await vi.waitFor(() => {
      expect(startCount).toBeGreaterThanOrEqual(2)
    })

    runtime.stopAll()
  })

  it('removeDesiredWorker stops and deletes desired state', async () => {
    const runtime = createManagedWorkerRuntime()
    let running = true

    runtime.registerHandler('removable', async (_payload, context) => {
      await context.markLive()
      while (running) {
        await new Promise((resolve) => setTimeout(resolve, 20))
      }
    })

    await runtime.setDesiredWorker(workerDefinition('worker-remove', 'removable'))
    await vi.waitFor(() => {
      expect(runtime.getWorker('worker-remove')?.status).toBe('live')
    })

    running = false
    await runtime.removeDesiredWorker('worker-remove')

    await vi.waitFor(() => {
      const worker = runtime.getWorker('worker-remove')
      expect(worker?.status === 'stopped' || worker === undefined).toBe(true)
    })
  })

  it('recover restarts desired workers after stale live state', async () => {
    const runtime = createManagedWorkerRuntime()
    let recoveredStarts = 0

    runtime.registerHandler('recoverable', async (_payload, context) => {
      recoveredStarts += 1
      await context.markLive()
      await new Promise((resolve) => setTimeout(resolve, 100))
    })

    await runtime.setDesiredWorker(workerDefinition('worker-recover', 'recoverable'))
    await vi.waitFor(() => {
      expect(runtime.getWorker('worker-recover')?.status).toBe('live')
    })

    const stale = runtime.simulateStaleStateForTest()
    expect(stale.length).toBeGreaterThan(0)

    const recovered = await runtime.recover()
    expect(recovered.length).toBeGreaterThan(0)

    await vi.waitFor(() => {
      expect(recoveredStarts).toBeGreaterThan(1)
    })

    runtime.stopAll()
  })

  it('heartbeat updates liveness without appending unbounded debug logs', async () => {
    const runtime = createManagedWorkerRuntime()
    let contextRef:
      | {
          heartbeat: (metadata?: Record<string, unknown>) => Promise<void>
          markLive: () => Promise<void>
        }
      | undefined

    runtime.registerHandler('heartbeat-only', async (_payload, context) => {
      contextRef = context
      await context.markLive()
      await new Promise((resolve) => setTimeout(resolve, 100))
    })

    await runtime.setDesiredWorker(workerDefinition('worker-heartbeat', 'heartbeat-only'))
    await vi.waitFor(() => {
      expect(runtime.getWorker('worker-heartbeat')?.status).toBe('live')
    })

    const beforeLogs = runtime.getWorker('worker-heartbeat')?.logs.length ?? 0
    await contextRef?.heartbeat({ streamKey: 'btc:15m' })
    const worker = runtime.getWorker('worker-heartbeat')

    expect(worker?.lastHeartbeatAt).toBeTruthy()
    expect(worker?.logs.length ?? 0).toBe(beforeLogs)

    runtime.stopAll()
  })
})

function baseInput() {
  return {
    definitionId: 'worker-1',
    handlerId: 'handler-1',
    owner: 'product' as const,
    productId: 'demo-product',
    title: 'Worker',
    payload: {}
  }
}

function workerDefinition(
  id: string,
  handlerId: string,
  restartPolicy = DEFAULT_RETRY_POLICY
) {
  return {
    id,
    owner: 'product' as const,
    productId: 'demo-product',
    handlerId,
    title: id,
    payload: { id },
    restartPolicy
  }
}
