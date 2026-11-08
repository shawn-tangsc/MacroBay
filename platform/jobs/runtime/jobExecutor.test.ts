import { describe, expect, it, vi } from 'vitest'

import { DEFAULT_RETRY_POLICY } from '../contracts/jobTypes'
import { createHandlerRegistry } from '../registry/handlerRegistry'
import { createJobRunStore } from './jobRunStore'
import { createJobExecutor } from './jobExecutor'

/**
 * 有界冲刷微任务：等一个**事实**成立，不用固定毫秒。
 *
 * 在假时钟下不能 `await setTimeout(0)`（假时钟不推进就永远不返回），所以这里用 `advanceTimersByTimeAsync(0)`
 * 让出并冲刷微任务队列，最多 50 圈；超过就抛——那说明状态根本没在变，报错比继续猜更有用。
 */
async function flushMicrotasksUntil(condition: () => boolean): Promise<void> {
  for (let round = 0; round < 50; round += 1) {
    if (condition()) return
    await vi.advanceTimersByTimeAsync(0)
  }
  if (condition()) return
  throw new Error('condition did not settle within bounded microtask flushes')
}

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
    /** 处理器**真的进去了**再取消：等一个事实，不等一个毫秒数。 */
    let markStarted: () => void = () => undefined
    const started = new Promise<void>((resolve) => { markStarted = resolve })

    registry.register('slow', async (_payload, context) => {
      markStarted()
      // 取消是一个事件：等它发生，不 sleep 一个「大概够久」的时间。
      await new Promise<void>((resolve) => {
        if (context.signal.aborted) { resolve(); return }
        context.signal.addEventListener('abort', () => resolve(), { once: true })
      })
      throw new Error('aborted by cancel')
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
    await started
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
        handlerStarted = true
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

      let handlerStarted = false
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

      // 先让处理器进入（微任务），再推进假时钟：避免「时钟先到、监听器还没挂上」这种顺序依赖。
      await flushMicrotasksUntil(() => handlerStarted)
      expect(handlerStarted).toBe(true)

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
    try {
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

      // 第一次失败之后的一次退避：推进**恰好**这段假时间，不用 runAll（那会把任何将来的定时器一起跑掉）。
      await flushMicrotasksUntil(() => attempts === 1)
      await vi.advanceTimersByTimeAsync(1000)
      await executePromise

      expect(attempts).toBe(2)
      expect(store.getRun(run.id)?.status).toBe('completed')
    } finally {
      // 必须在 finally 里还原：一红就把假时间留给后面的用例，红点会变成假证据。
      vi.useRealTimers()
    }
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

      await flushMicrotasksUntil(() => store.getRun(run.id)?.attempt === 2)
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
