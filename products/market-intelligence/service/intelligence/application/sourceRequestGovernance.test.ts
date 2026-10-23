import { afterEach, describe, expect, it, vi } from 'vitest'

import { createSourceRequestGovernanceQueue } from './sourceRequestGovernance'
import { zeroXRouterSourcePolicy } from './zeroXRouterSourcePolicy'

describe('source request governance queue', () => {
  afterEach(() => vi.useRealTimers())
  it('dispatches at most ten requests per rolling window and preserves FIFO', async () => {
    const clock = { value: 0 }
    const queue = createSourceRequestGovernanceQueue({ now: () => clock.value })
    const dispatched: number[] = []
    const tasks = Array.from({ length: 11 }, (_, index) => queue.enqueue({
      sourceId: zeroXRouterSourcePolicy.sourceId,
      policy: zeroXRouterSourcePolicy.requestGovernance,
      apiKey: 'opaque-key',
      run: async () => { dispatched.push(index); return index }
    }))

    await Promise.all(tasks.slice(0, 10))
    expect(dispatched).toEqual(Array.from({ length: 10 }, (_, index) => index))
    expect(queue.pendingCount()).toBe(1)

    clock.value = 60_000
    queue.pump()
    await expect(tasks[10]).resolves.toBe(10)
    expect(dispatched).toEqual(Array.from({ length: 11 }, (_, index) => index))
  })

  it('cancels queued non-user work when a source is disabled, but keeps explicit user work', async () => {
    const queue = createSourceRequestGovernanceQueue({ now: () => 0 })
    await Promise.all(Array.from({ length: 10 }, () => queue.enqueue({ sourceId: '0x', policy: zeroXRouterSourcePolicy.requestGovernance, apiKey: 'k', run: async () => undefined })))
    const automatic = queue.enqueue({ sourceId: '0x', policy: zeroXRouterSourcePolicy.requestGovernance, apiKey: 'k', intent: 'automatic', run: async () => 'auto' })
    const user = queue.enqueue({ sourceId: '0x', policy: zeroXRouterSourcePolicy.requestGovernance, apiKey: 'k', intent: 'user', run: async () => 'user' })
    queue.disableSource('0x')
    await expect(automatic).rejects.toMatchObject({ code: 'source-disabled' })
    expect(queue.pendingCount()).toBe(1)
    queue.close()
    await expect(user).rejects.toMatchObject({ code: 'queue-closed' })
  })

  it('does not rate-limit a source without an explicit policy', async () => {
    const queue = createSourceRequestGovernanceQueue({ now: () => 0 })
    const results = await Promise.all(Array.from({ length: 20 }, (_, index) => queue.enqueue({ sourceId: 'unlimited', run: async () => index })))
    expect(results).toHaveLength(20)
    expect(queue.pendingCount()).toBe(0)
  })

  it('rejects an aborted pending request before dispatch', async () => {
    const clock = { value: 0 }
    const queue = createSourceRequestGovernanceQueue({ now: () => clock.value })
    await Promise.all(Array.from({ length: 10 }, () => queue.enqueue({ sourceId: '0x', policy: zeroXRouterSourcePolicy.requestGovernance, apiKey: 'k', run: async () => undefined })))
    const controller = new AbortController()
    const pending = queue.enqueue({ sourceId: '0x', policy: zeroXRouterSourcePolicy.requestGovernance, apiKey: 'k', signal: controller.signal, run: async () => 'never' })
    controller.abort()
    await expect(pending).rejects.toMatchObject({ code: 'request-cancelled' })
    expect(queue.pendingCount()).toBe(0)
  })

  it('expires a queued request at its named max wait boundary', async () => {
    const clock = { value: 0 }
    const queue = createSourceRequestGovernanceQueue({ now: () => clock.value })
    const shortWaitPolicy = { ...zeroXRouterSourcePolicy.requestGovernance, queue: { ...zeroXRouterSourcePolicy.requestGovernance.queue, maxWaitMs: 1_000 } }
    await Promise.all(Array.from({ length: 10 }, () => queue.enqueue({ sourceId: '0x', policy: shortWaitPolicy, apiKey: 'k', run: async () => undefined })))
    const pending = queue.enqueue({ sourceId: '0x', policy: shortWaitPolicy, apiKey: 'k', run: async () => 'never' })
    clock.value = shortWaitPolicy.queue.maxWaitMs + 1
    queue.pump()
    await expect(pending).rejects.toMatchObject({ code: 'request-rate-limited' })
  })

  it('wakes at a shorter max-wait deadline before the rolling quota releases', async () => {
    vi.useFakeTimers()
    const clock = { value: 0 }
    const shortWaitPolicy = {
      ...zeroXRouterSourcePolicy.requestGovernance,
      queue: { ...zeroXRouterSourcePolicy.requestGovernance.queue, maxWaitMs: 1_000 }
    }
    const queue = createSourceRequestGovernanceQueue({ now: () => clock.value })
    await Promise.all(Array.from({ length: 10 }, () => queue.enqueue({ sourceId: '0x', policy: shortWaitPolicy, apiKey: 'k', run: async () => undefined })))
    const dispatch = vi.fn(async () => 'never')
    const pending = queue.enqueue({ sourceId: '0x', policy: shortWaitPolicy, apiKey: 'k', run: dispatch })
    void pending.catch(() => undefined)

    clock.value = shortWaitPolicy.queue.maxWaitMs + 1
    await vi.advanceTimersByTimeAsync(shortWaitPolicy.queue.maxWaitMs + 1)

    await expect(pending).rejects.toMatchObject({ code: 'request-rate-limited' })
    expect(dispatch).not.toHaveBeenCalled()
  })
})
