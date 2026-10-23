import { describe, expect, it, vi } from 'vitest'

import { DEFAULT_RETRY_POLICY } from '../contracts/jobTypes'
import { createHandlerRegistry } from '../registry/handlerRegistry'
import { createJobRunStore } from './jobRunStore'
import { createJobExecutor } from './jobExecutor'

describe('jobExecutor', () => {
  it('executes a registered handler and marks the run completed', async () => {
    const registry = createHandlerRegistry()
    const store = createJobRunStore()
    const executor = createJobExecutor({ registry, store })

    registry.register('success', async (_payload, context) => {
      await context.log({ level: 'info', message: 'done' })
    })

    const run = store.createRun({
      definitionId: 'job-1',
      handlerId: 'success',
      owner: 'platform',
      title: 'Success',
      trigger: { kind: 'manual' },
      payload: {},
      maxAttempts: 1
    })

    await executor.executeRun(run.id, { handlerId: 'success', payload: {}, retryPolicy: DEFAULT_RETRY_POLICY })
    expect(store.getRun(run.id)?.status).toBe('completed')
  })

  it('passes an abort signal that cancels the handler', async () => {
    const registry = createHandlerRegistry()
    const store = createJobRunStore()
    const executor = createJobExecutor({ registry, store })

    registry.register('slow', async (_payload, context) => {
      if (context.signal.aborted) throw new Error('aborted early')
      await new Promise((resolve) => setTimeout(resolve, 50))
      if (context.signal.aborted) throw new Error('aborted late')
    })

    const run = store.createRun({
      definitionId: 'job-2',
      handlerId: 'slow',
      owner: 'platform',
      title: 'Slow',
      trigger: { kind: 'manual' },
      payload: {},
      maxAttempts: 1
    })

    const executePromise = executor.executeRun(run.id, {
      handlerId: 'slow',
      payload: {},
      retryPolicy: DEFAULT_RETRY_POLICY
    })
    executor.cancelRun(run.id)
    await executePromise

    expect(store.getRun(run.id)?.status).toBe('cancelled')
  })

  it('cancels a run when timeoutMs elapses', async () => {
    vi.useFakeTimers()
    try {
      const registry = createHandlerRegistry()
      const store = createJobRunStore()
      const executor = createJobExecutor({ registry, store })
      let observedAbort = false

      registry.register('timeout', async (_payload, context) => {
        await new Promise<void>((resolve) => {
          context.signal.addEventListener(
            'abort',
            () => {
              observedAbort = true
              resolve()
            },
            { once: true }
          )
        })
      })

      const run = store.createRun({
        definitionId: 'job-timeout',
        handlerId: 'timeout',
        owner: 'platform',
        title: 'Timeout',
        trigger: { kind: 'manual' },
        payload: {},
        maxAttempts: 1
      })

      const executePromise = executor.executeRun(run.id, {
        handlerId: 'timeout',
        payload: {},
        retryPolicy: DEFAULT_RETRY_POLICY,
        timeoutMs: 1000
      })

      await vi.advanceTimersByTimeAsync(1000)
      await executePromise

      expect(observedAbort).toBe(true)
      expect(store.getRun(run.id)).toMatchObject({
        status: 'failed',
        lastError: 'Job timed out after 1000ms.'
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it('retries failed handlers according to retry policy', async () => {
    vi.useFakeTimers()
    const registry = createHandlerRegistry()
    const store = createJobRunStore()
    const executor = createJobExecutor({ registry, store })
    let attempts = 0

    registry.register('flaky', async () => {
      attempts += 1
      if (attempts < 2) throw new Error('temporary')
    })

    const run = store.createRun({
      definitionId: 'job-3',
      handlerId: 'flaky',
      owner: 'platform',
      title: 'Flaky',
      trigger: { kind: 'manual' },
      payload: {},
      maxAttempts: 2
    })

    const executePromise = executor.executeRun(run.id, {
      handlerId: 'flaky',
      payload: {},
      retryPolicy: {
        maxAttempts: 2,
        backoff: 'fixed',
        baseDelayMs: 1000,
        maxDelayMs: 1000
      }
    })

    await vi.runAllTimersAsync()
    await executePromise

    expect(attempts).toBe(2)
    expect(store.getRun(run.id)?.status).toBe('completed')
    vi.useRealTimers()
  })

  it('finalizes timeout during retry backoff without waiting for the full retry delay', async () => {
    vi.useFakeTimers()
    try {
      const registry = createHandlerRegistry()
      const store = createJobRunStore()
      const executor = createJobExecutor({ registry, store })
      let attempts = 0

      registry.register('backoff-timeout', async () => {
        attempts += 1
        throw new Error('temporary')
      })

      const run = store.createRun({
        definitionId: 'job-backoff-timeout',
        handlerId: 'backoff-timeout',
        owner: 'platform',
        title: 'Backoff timeout',
        trigger: { kind: 'manual' },
        payload: {},
        maxAttempts: 2
      })

      const executePromise = executor.executeRun(run.id, {
        handlerId: 'backoff-timeout',
        payload: {},
        retryPolicy: {
          maxAttempts: 2,
          backoff: 'fixed',
          baseDelayMs: 1000,
          maxDelayMs: 1000
        },
        timeoutMs: 100
      })

      await vi.advanceTimersByTimeAsync(0)
      expect(store.getRun(run.id)).toMatchObject({
        attempt: 2,
        status: 'running'
      })

      await vi.advanceTimersByTimeAsync(100)
      const runAtTimeout = store.getRun(run.id)

      await vi.advanceTimersByTimeAsync(1000)
      await executePromise

      expect(attempts).toBe(1)
      expect(runAtTimeout).toMatchObject({
        status: 'failed',
        lastError: 'Job timed out after 100ms.'
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it('fails when the handler is not registered', async () => {
    const registry = createHandlerRegistry()
    const store = createJobRunStore()
    const executor = createJobExecutor({ registry, store })

    const run = store.createRun({
      definitionId: 'job-4',
      handlerId: 'missing',
      owner: 'platform',
      title: 'Missing',
      trigger: { kind: 'manual' },
      payload: {},
      maxAttempts: 1
    })

    await executor.executeRun(run.id, {
      handlerId: 'missing',
      payload: {},
      retryPolicy: DEFAULT_RETRY_POLICY
    })

    expect(store.getRun(run.id)?.status).toBe('failed')
  })
})
