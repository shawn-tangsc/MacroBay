import { describe, expect, it, vi } from 'vitest'

import { ChannelInboundExecutionRunner } from './ChannelInboundExecutionRunner'

describe('ChannelInboundExecutionRunner', () => {
  it('routes private initial and bounded recovery claims through the same coordinator', async () => {
    const claim = { workItemId: 'work-a', receiptId: 'receipt-a', channelId: 'channel-a', dispatchId: 'dispatch-a', generation: 1, leaseToken: 'lease-a', leaseExpiresAt: '2099-01-01T00:00:00.000Z' }
    const coordinator = { executeInitial: vi.fn(async () => 'completed'), executeRecovery: vi.fn(async () => ['completed']) }
    const repository = { reclaimExpired: vi.fn(() => [claim]) }
    const runner = new ChannelInboundExecutionRunner({ inbound: repository as never, coordinator: coordinator as never, reclaimLimit: 7 })
    runner.onInitialClaim({ takeInitialExecutionClaim: vi.fn(() => claim) } as never, claim.dispatchId)
    await Promise.resolve()
    await runner.recoverOnce()
    expect(coordinator.executeInitial).toHaveBeenCalledWith(expect.anything(), claim.dispatchId)
    expect(repository.reclaimExpired).toHaveBeenCalledWith(expect.any(Date), 60_000, 7)
    expect(coordinator.executeRecovery).toHaveBeenCalledWith([claim])
  })

  it('contains repository failure at startup and tick without entering coordinator recovery', async () => {
    let tick: (() => void) | undefined
    let disposed = false
    const clearInterval = vi.fn()
    const repository = { reclaimExpired: vi.fn(() => { throw new Error('sqlite busy') }) }
    const coordinator = { executeRecovery: vi.fn() }
    const runner = new ChannelInboundExecutionRunner({ inbound: repository as never, coordinator: coordinator as never })
    const dispose = runner.startRecovery(15 * 60_000, {
      setInterval: (callback, interval) => { expect(interval).toBe(15 * 60_000); tick = () => { if (!disposed) callback() }; return 1 as never },
      clearInterval: (timer) => { disposed = true; clearInterval(timer) }
    })
    await Promise.resolve()
    expect(() => tick?.()).not.toThrow()
    await Promise.resolve()
    expect(coordinator.executeRecovery).not.toHaveBeenCalled()
    dispose()
    expect(clearInterval).toHaveBeenCalledWith(1)
    const calls = repository.reclaimExpired.mock.calls.length
    tick?.()
    await Promise.resolve()
    expect(repository.reclaimExpired.mock.calls.length).toBe(calls)
  })

  it('contains coordinator rejection at startup and tick without an unhandled recovery promise', async () => {
    let tick: (() => void) | undefined
    const repository = { reclaimExpired: vi.fn(() => []) }
    const coordinator = { executeRecovery: vi.fn(async () => { throw new Error('admission failed') }) }
    const runner = new ChannelInboundExecutionRunner({ inbound: repository as never, coordinator: coordinator as never })
    const dispose = runner.startRecovery(15 * 60_000, {
      setInterval: (callback) => { tick = callback; return 1 as never }, clearInterval: () => {}
    })
    await Promise.resolve()
    expect(() => tick?.()).not.toThrow()
    await Promise.resolve()
    expect(coordinator.executeRecovery).toHaveBeenCalledTimes(2)
    dispose()
  })
})
