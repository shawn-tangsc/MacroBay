import { describe, expect, it, vi } from 'vitest'

import { DEFAULT_RETRY_POLICY } from '../contracts/jobTypes'
import { createJobRunSqliteStore } from './jobRunSqliteStore'
import { createJobRuntime } from './jobRuntime'

describe('jobRuntime', () => {
  it('registers handlers and enqueues manual jobs', async () => {
    const runtime = createJobRuntime()
    const calls: string[] = []

    runtime.registerHandler('echo', async (payload) => {
      calls.push(String(payload))
    })

    const definition = {
      id: 'job-echo',
      owner: 'product' as const,
      productId: 'sample-product',
      handlerId: 'echo',
      title: 'Echo',
      trigger: { kind: 'manual' as const },
      payload: 'hello'
    }

    runtime.setSchedule(definition)
    await runtime.enqueueManual('job-echo')

    await vi.waitFor(() => {
      expect(calls).toEqual(['hello'])
    })
  })

  it('executes cron schedules through the runtime and reschedules the next slot', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T10:10:30.000Z'))

    try {
      const runtime = createJobRuntime()
      const calls: string[] = []

      runtime.registerHandler('cron', async (payload) => {
        calls.push(String(payload))
      })

      runtime.setSchedule({
        id: 'job-cron-runtime',
        owner: 'platform',
        handlerId: 'cron',
        title: 'Cron runtime',
        trigger: { kind: 'cron', expression: '15 * * * *' },
        payload: 'tick'
      })

      await vi.advanceTimersByTimeAsync(269_000)
      expect(calls).toEqual([])

      await vi.advanceTimersByTimeAsync(1_000)
      await vi.waitFor(() => {
        expect(calls).toEqual(['tick'])
      })
      expect(runtime.listRuns({ definitionId: 'job-cron-runtime' })).toHaveLength(1)

      await vi.advanceTimersByTimeAsync(3_599_000)
      expect(calls).toEqual(['tick'])

      await vi.advanceTimersByTimeAsync(1_000)
      await vi.waitFor(() => {
        expect(calls).toEqual(['tick', 'tick'])
      })
      expect(runtime.listRuns({ definitionId: 'job-cron-runtime' })).toHaveLength(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('recovers stale running jobs on startup', () => {
    const runtime = createJobRuntime()
    runtime.registerHandler('noop', async () => {})

    const definition = {
      id: 'job-stale',
      owner: 'platform' as const,
      handlerId: 'noop',
      title: 'Stale',
      trigger: { kind: 'manual' as const },
      payload: {}
    }

    runtime.setSchedule(definition)
    const run = runtime.createQueuedRun(definition)
    runtime.markRunningForTest(run.id)

    const recovered = runtime.recover()
    expect(recovered).toHaveLength(1)
    expect(recovered[0]?.status).toBe('failed')
  })

  it('settles runs left queued at startup, because the queue does not survive the process', () => {
    const runtime = createJobRuntime()
    runtime.registerHandler('noop', async () => {})

    const definition = {
      id: 'job-queued-at-restart',
      owner: 'product' as const,
      productId: 'sample-product',
      handlerId: 'noop',
      title: 'Queued',
      trigger: { kind: 'manual' as const },
      payload: {}
    }

    runtime.setSchedule(definition)
    const queued = runtime.createQueuedRun(definition)

    const recovered = runtime.recover()
    expect(recovered.map((run) => run.id)).toEqual([queued.id])
    expect(runtime.getRun(queued.id)?.status).toBe('cancelled')
    // Idempotent: the next startup has nothing left to settle.
    expect(runtime.recover()).toEqual([])
  })

  it('cancels a running job', async () => {
    const runtime = createJobRuntime()
    let observedAbort = false

    runtime.registerHandler('wait', async (_payload, context) => {
      await new Promise((resolve) => setTimeout(resolve, 100))
      observedAbort = context.signal.aborted
    })

    const definition = {
      id: 'job-cancel',
      owner: 'platform' as const,
      handlerId: 'wait',
      title: 'Cancel',
      trigger: { kind: 'manual' as const },
      payload: {},
      retryPolicy: DEFAULT_RETRY_POLICY
    }

    runtime.setSchedule(definition)
    const run = await runtime.enqueueManual('job-cancel')
    runtime.cancel(run.id, {
      kind: 'cancelled',
      message: 'Cancelled by user.'
    })

    await vi.waitFor(() => {
      expect(runtime.getRun(run.id)?.status).toBe('cancelled')
    })
    expect(observedAbort).toBe(true)
    expect(runtime.getRun(run.id)?.lastError).toBe('Cancelled by user.')
  })

  it('cancels a queued job before execution starts', () => {
    const runtime = createJobRuntime()
    runtime.registerHandler('noop', async () => {})

    const definition = {
      id: 'job-queued-cancel',
      owner: 'platform' as const,
      handlerId: 'noop',
      title: 'Queued cancel',
      trigger: { kind: 'manual' as const },
      payload: {},
      retryPolicy: DEFAULT_RETRY_POLICY
    }

    runtime.setSchedule(definition)
    const run = runtime.createQueuedRun(definition)
    runtime.cancel(run.id, {
      kind: 'cancelled',
      message: 'Cancelled by user.'
    })

    expect(runtime.getRun(run.id)).toMatchObject({
      status: 'cancelled',
      lastError: 'Cancelled by user.'
    })
  })

  it('reports a bounded terminal wait timeout for a handler that never settles', async () => {
    vi.useFakeTimers()
    try {
      const runtime = createJobRuntime()
      runtime.registerHandler('never-settles', async () => {
        await new Promise<void>(() => undefined)
      })
      const run = await runtime.enqueueDefinition({
        id: 'job-terminal-wait-timeout',
        owner: 'platform',
        handlerId: 'never-settles',
        title: 'Terminal wait timeout',
        trigger: { kind: 'startup' },
        payload: {}
      })
      await vi.waitFor(() => expect(runtime.getRun(run.id)?.status).toBe('running'))

      const observation = runtime.waitForRunTerminal(run.id, { timeoutMs: 1_000 })
      await vi.advanceTimersByTimeAsync(1_000)

      await expect(observation).resolves.toEqual({ state: 'timeout' })
      expect(runtime.getRun(run.id)?.status).toBe('running')
      runtime.stopAll()
    } finally {
      vi.useRealTimers()
    }
  })

  it('releases a terminal wait when runtime shutdown interrupts a handler', async () => {
    const runtime = createJobRuntime()
    runtime.registerHandler('never-settles', async () => {
      await new Promise<void>(() => undefined)
    })
    const run = await runtime.enqueueDefinition({
      id: 'job-terminal-wait-shutdown',
      owner: 'platform',
      handlerId: 'never-settles',
      title: 'Terminal wait shutdown',
      trigger: { kind: 'startup' },
      payload: {}
    })
    await vi.waitFor(() => expect(runtime.getRun(run.id)?.status).toBe('running'))

    const observation = runtime.waitForRunTerminal(run.id)
    runtime.stopAll()

    await expect(observation).resolves.toEqual({ state: 'interrupted' })
  })

  it('releases a terminal wait when a queued concurrency wait is cancelled', async () => {
    const runtime = createJobRuntime()
    let releaseFirstRun: (() => void) | undefined
    runtime.registerHandler('serial', async (payload) => {
      if (payload === 'first') {
        await new Promise<void>((resolve) => {
          releaseFirstRun = resolve
        })
      }
    })
    await runtime.enqueueDefinition({
      id: 'job-terminal-wait-queued-first',
      owner: 'platform',
      handlerId: 'serial',
      title: 'Terminal wait queued first',
      trigger: { kind: 'manual' },
      payload: 'first',
      concurrencyKey: 'terminal-wait-lock'
    })
    const queuedRunPromise = runtime.enqueueDefinition({
      id: 'job-terminal-wait-queued-second',
      owner: 'platform',
      handlerId: 'serial',
      title: 'Terminal wait queued second',
      trigger: { kind: 'manual' },
      payload: 'second',
      concurrencyKey: 'terminal-wait-lock'
    })
    const queuedRun = await vi.waitFor(() => {
      const run = runtime.listRuns({ definitionId: 'job-terminal-wait-queued-second' })[0]
      expect(run?.status).toBe('queued')
      return run!
    })
    const observation = runtime.waitForRunTerminal(queuedRun.id)

    runtime.cancel(queuedRun.id)

    await expect(observation).resolves.toEqual({ state: 'interrupted' })
    releaseFirstRun?.()
    await queuedRunPromise
  })

  it('does not revive a cancelled queued run when a later executor turn starts', async () => {
    const runtime = createJobRuntime()
    const calls: string[] = []

    runtime.registerHandler('noop', async () => {
      calls.push('executed')
    })

    const definition = {
      id: 'job-cancelled-queued-run',
      owner: 'platform' as const,
      handlerId: 'noop',
      title: 'Cancelled queued run',
      trigger: { kind: 'manual' as const },
      payload: {},
      retryPolicy: DEFAULT_RETRY_POLICY
    }

    runtime.setSchedule(definition)
    const run = runtime.createQueuedRun(definition)
    runtime.cancel(run.id, {
      kind: 'cancelled',
      message: 'Cancelled by user.'
    })

    await runtime.enqueueDefinition({
      ...definition,
      id: 'job-cancelled-queued-run-next'
    })

    await vi.waitFor(() => {
      expect(calls).toEqual(['executed'])
    })
    expect(runtime.getRun(run.id)).toMatchObject({
      status: 'cancelled',
      lastError: 'Cancelled by user.'
    })
  })

  it('cancels a retrying run during backoff without starting the next attempt', async () => {
    vi.useFakeTimers()
    try {
      const runtime = createJobRuntime()
      let attempts = 0

      runtime.registerHandler('retrying', async () => {
        attempts += 1
        throw new Error('temporary')
      })

      const run = await runtime.enqueueDefinition({
        id: 'job-retrying-cancel',
        owner: 'platform',
        handlerId: 'retrying',
        title: 'Retrying cancel',
        trigger: { kind: 'manual' },
        payload: {},
        retryPolicy: {
          maxAttempts: 2,
          backoff: 'fixed',
          baseDelayMs: 1000,
          maxDelayMs: 1000
        }
      })

      await vi.advanceTimersByTimeAsync(0)
      expect(runtime.getRun(run.id)).toMatchObject({
        attempt: 2,
        status: 'running'
      })

      runtime.cancel(run.id, {
        kind: 'cancelled',
        message: 'Cancelled by user.'
      })

      await vi.advanceTimersByTimeAsync(1000)
      await vi.waitFor(() => {
        expect(runtime.getRun(run.id)).toMatchObject({
          status: 'cancelled',
          lastError: 'Cancelled by user.'
        })
      })

      expect(attempts).toBe(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('fails a queued run when timeout elapses before the concurrency slot opens', async () => {
    vi.useFakeTimers()
    try {
      const runtime = createJobRuntime()
      let releaseFirstRun: (() => void) | null = null
      const payloads: string[] = []

      runtime.registerHandler('serial', async (payload) => {
        payloads.push(String(payload))
        if (payload === 'first') {
          await new Promise<void>((resolve) => {
            releaseFirstRun = () => {
              resolve()
            }
          })
        }
      })

      const firstRun = await runtime.enqueueDefinition({
        id: 'job-queued-timeout-first',
        owner: 'platform',
        handlerId: 'serial',
        title: 'Queued timeout first',
        trigger: { kind: 'manual' },
        payload: 'first',
        concurrencyKey: 'lock-1'
      })
      await vi.waitFor(() => {
        expect(runtime.getRun(firstRun.id)?.status).toBe('running')
      })

      const secondRunPromise = runtime.enqueueDefinition({
        id: 'job-queued-timeout-second',
        owner: 'platform',
        handlerId: 'serial',
        title: 'Queued timeout second',
        trigger: { kind: 'manual' },
        payload: 'second',
        concurrencyKey: 'lock-1',
        timeoutMs: 100
      })

      await vi.waitFor(() => {
        expect(runtime.listRuns({ definitionId: 'job-queued-timeout-second' })[0]?.status).toBe('queued')
      })

      await vi.advanceTimersByTimeAsync(100)
      const secondRun = await secondRunPromise
      await vi.waitFor(() => {
        expect(runtime.getRun(secondRun.id)).toMatchObject({
          status: 'failed',
          lastError: 'Job timed out after 100ms.'
        })
      })

      ;(releaseFirstRun as (() => void) | null)?.()
      await vi.waitFor(() => {
        expect(runtime.getRun(firstRun.id)?.status).toBe('completed')
      })
      expect(payloads).toEqual(['first'])
    } finally {
      vi.useRealTimers()
    }
  })

  it('stopAll cancels a running job and clears schedules', async () => {
    const runtime = createJobRuntime()
    let observedAbort = false
    let observedReason: unknown = null

    runtime.registerHandler('wait', async (_payload, context) => {
      await new Promise<void>((resolve) => setTimeout(resolve, 100))
      observedAbort = context.signal.aborted
      observedReason = context.signal.reason
    })

    runtime.setSchedule({
      id: 'job-stop-running',
      owner: 'platform',
      handlerId: 'wait',
      title: 'Stop running',
      trigger: { kind: 'interval', intervalMs: 1_000, anchor: 'lastStart' },
      payload: {}
    })

    const run = await runtime.enqueueManual('job-stop-running')
    await vi.waitFor(() => {
      expect(runtime.getRun(run.id)?.status).toBe('running')
    })

    runtime.stopAll()

    await vi.waitFor(() => {
      expect(runtime.getRun(run.id)).toMatchObject({
        status: 'cancelled',
        lastError: 'Stopped by runtime shutdown.'
      })
    })
    expect(observedAbort).toBe(true)
    expect(observedReason).toEqual({
      kind: 'shutdown',
      message: 'Stopped by runtime shutdown.'
    })

    await expect(runtime.enqueueManual('job-stop-running')).rejects.toThrow('Unknown job definition "job-stop-running".')
  })

  it('stopAll cancels a queued job that is still waiting on the concurrency lock', async () => {
    const runtime = createJobRuntime()
    let releaseFirstRun: (() => void) | null = null

    runtime.registerHandler('serial', async (payload) => {
      if (payload === 'first') {
        await new Promise<void>((resolve) => {
          releaseFirstRun = resolve
        })
      }
    })

    const definition = {
      id: 'job-stop-queued',
      owner: 'platform' as const,
      handlerId: 'serial',
      title: 'Stop queued',
      trigger: { kind: 'manual' as const },
      payload: 'first',
      concurrencyKey: 'lock-1'
    }

    await runtime.enqueueDefinition(definition)
    const secondRunPromise = runtime.enqueueDefinition({
      ...definition,
      id: 'job-stop-queued-second',
      payload: 'second'
    })

    const queuedRun = await vi.waitFor(() => {
      const run = runtime.listRuns({ definitionId: 'job-stop-queued-second' })[0]
      expect(run?.status).toBe('queued')
      return run
    })

    runtime.stopAll()

    const secondRun = await secondRunPromise
    expect(secondRun.id).toBe(queuedRun.id)
    await vi.waitFor(() => {
      expect(runtime.getRun(queuedRun.id)).toMatchObject({
        status: 'cancelled',
        lastError: 'Stopped by runtime shutdown.'
      })
    })

    ;(releaseFirstRun as (() => void) | null)?.()
  })

  it('stopAll prevents a queued dispatch from starting after shutdown even if the lock opens later', async () => {
    const runtime = createJobRuntime()
    let releaseFirstRun: (() => void) | null = null
    const payloads: string[] = []

    runtime.registerHandler('serial', async (payload) => {
      payloads.push(String(payload))
      if (payload === 'first') {
        await new Promise<void>((resolve) => {
          releaseFirstRun = resolve
        })
      }
    })

    const definition = {
      id: 'job-stop-prevent-late-start',
      owner: 'platform' as const,
      handlerId: 'serial',
      title: 'Stop late start',
      trigger: { kind: 'manual' as const },
      payload: 'first',
      concurrencyKey: 'lock-1'
    }

    await runtime.enqueueDefinition(definition)
    const secondRunPromise = runtime.enqueueDefinition({
      ...definition,
      id: 'job-stop-prevent-late-start-second',
      payload: 'second'
    })

    await vi.waitFor(() => {
      expect(runtime.listRuns({ definitionId: 'job-stop-prevent-late-start-second' })[0]?.status).toBe('queued')
    })

    runtime.stopAll()
    ;(releaseFirstRun as (() => void) | null)?.()

    const secondRun = await secondRunPromise
    await vi.waitFor(() => {
      expect(runtime.getRun(secondRun.id)?.status).toBe('cancelled')
    })
    expect(payloads).toEqual(['first'])
  })

  it('rejects enqueue when handler is not registered', async () => {
    const runtime = createJobRuntime()
    runtime.setSchedule({
      id: 'job-missing',
      owner: 'platform',
      handlerId: 'missing',
      title: 'Missing',
      trigger: { kind: 'manual' },
      payload: {}
    })

    await expect(runtime.enqueueManual('job-missing')).rejects.toThrow('Unknown job handler "missing".')
  })

  it('lists filtered runs for platform-owned job integrations', async () => {
    const runtime = createJobRuntime()

    runtime.registerHandler('noop', async () => {})
    await runtime.enqueueDefinition({
      id: 'platform.agent.task.task-run-1',
      owner: 'platform',
      handlerId: 'noop',
      title: 'Agent task',
      trigger: { kind: 'manual' },
      payload: {
        taskId: 'task-1',
        runLogId: 'task-run-1',
        agentId: 'agent-1'
      }
    })
    await runtime.enqueueDefinition({
      id: 'product-job',
      owner: 'product',
      productId: 'sample-product',
      handlerId: 'noop',
      title: 'Product job',
      trigger: { kind: 'manual' },
      payload: {
        taskId: 'task-1',
        runLogId: 'task-run-2',
        agentId: 'agent-1'
      }
    })

    await vi.waitFor(() => {
      expect(runtime.listRuns({ owner: 'platform', payload: { taskId: 'task-1' } })).toHaveLength(1)
    })

    expect(runtime.listRuns({ owner: 'platform', payload: { taskId: 'task-1' } })[0]).toMatchObject({
      owner: 'platform',
      definitionId: 'platform.agent.task.task-run-1'
    })
  })

  it('lists filtered runs by cursor page for future Data API callers', async () => {
    const runtime = createJobRuntime()
    runtime.registerHandler('noop', async () => {})

    await runtime.enqueueDefinition({
      id: 'platform.agent.task.task-run-1',
      owner: 'platform',
      handlerId: 'noop',
      title: 'Agent task 1',
      trigger: { kind: 'manual' },
      payload: { taskId: 'task-1' }
    })
    await runtime.enqueueDefinition({
      id: 'platform.agent.task.task-run-2',
      owner: 'platform',
      handlerId: 'noop',
      title: 'Agent task 2',
      trigger: { kind: 'manual' },
      payload: { taskId: 'task-1' }
    })
    await runtime.enqueueDefinition({
      id: 'platform.agent.task.task-run-3',
      owner: 'platform',
      handlerId: 'noop',
      title: 'Agent task 3',
      trigger: { kind: 'manual' },
      payload: { taskId: 'task-1' }
    })

    const firstPage = runtime.listRunPage({
      owner: 'platform',
      definitionIdPrefix: 'platform.agent.task.',
      payload: { taskId: 'task-1' },
      limit: 2
    })
    const secondPage = runtime.listRunPage({
      owner: 'platform',
      definitionIdPrefix: 'platform.agent.task.',
      payload: { taskId: 'task-1' },
      cursor: firstPage.nextCursor,
      limit: 2
    })

    expect(firstPage.runs.map((run) => run.definitionId)).toEqual([
      'platform.agent.task.task-run-3',
      'platform.agent.task.task-run-2'
    ])
    expect(firstPage.nextCursor).toBeTruthy()
    expect(secondPage.runs.map((run) => run.definitionId)).toEqual(['platform.agent.task.task-run-1'])
    expect(secondPage.nextCursor).toBeNull()
  })

  it('can execute jobs through an injected sqlite-backed run store', async () => {
    const store = createJobRunSqliteStore(':memory:')
    const runtime = createJobRuntime({ store })

    runtime.registerHandler('noop', async (_payload, context) => {
      await context.progress({ current: 1, message: 'done' })
      await context.log({ level: 'info', message: 'done' })
    })
    const run = await runtime.enqueueDefinition({
      id: 'platform.agent.task.persisted',
      owner: 'platform',
      handlerId: 'noop',
      title: 'Persisted task',
      trigger: { kind: 'manual' },
      payload: { taskId: 'task-1' }
    })

    await vi.waitFor(() => {
      expect(runtime.getRun(run.id)?.status).toBe('completed')
    })

    const page = store.queryRunPage({
      owner: 'platform',
      statuses: ['completed'],
      payload: { taskId: 'task-1' },
      limit: 10
    })
    store.close()

    expect(page.runs).toHaveLength(1)
    expect(page.runs[0]).toMatchObject({
      id: run.id,
      progress: { current: 1, message: 'done' },
      logs: [{ level: 'info', message: 'done' }]
    })
  })
})
