import { afterEach, describe, expect, it, vi } from 'vitest'

import { createJobScheduler } from '@platform/jobs/runtime/jobScheduler'
import type { JobDefinition } from '@platform/jobs'

import { createZeroXRouterCalendarScheduler, zeroXRouterCalendarSchedulerPolicy } from './zeroXRouterCalendarScheduler'

const firstJobId = `${zeroXRouterCalendarSchedulerPolicy.definitionId}.economic-data`
const firstHandlerId = `${zeroXRouterCalendarSchedulerPolicy.handlerId}.economic-data`

afterEach(() => { vi.useRealTimers() })

/**
 * Uses the real platform scheduler on purpose.
 *
 * The earlier test asserted the registered definition against a fake runtime, which
 * passed while the job never actually ran: an interval anchored to `lastComplete`
 * only arms itself after a completion, so a fresh schedule never fires at all.
 */
function schedulerHarness() {
  const enqueued: JobDefinition[] = []
  const scheduler = createJobScheduler({ enqueue: async (definition) => { enqueued.push(definition) } })
  const handlers = new Map<string, () => Promise<void>>()
  const started: JobDefinition[] = []
  const jobRuntime = {
    registerHandler: (handlerId: string, handler: () => Promise<void>) => { handlers.set(handlerId, handler) },
    setSchedule: (definition: JobDefinition) => scheduler.setSchedule(definition),
    removeSchedule: (definitionId: string) => scheduler.removeSchedule(definitionId),
    enqueueDefinition: async (definition: JobDefinition) => { started.push(definition); return {} }
  }
  return { enqueued, handlers, started, jobRuntime }
}

describe('zeroXRouter calendar scheduler', () => {
  it('refreshes once on startup and then keeps the interval armed', async () => {
    // Without a startup run the first automatic refresh waits a full interval, so
    // the calendar still looks stale right after launch.
    vi.useFakeTimers()
    const { enqueued, started, jobRuntime } = schedulerHarness()
    const scheduler = createZeroXRouterCalendarScheduler({
      jobRuntime: jobRuntime as never,
      readReadiness: () => ({ enabled: true, hasCredential: true }),
      refreshAutomatic: async () => ({ state: 'succeeded', items: [] })
    })
    await scheduler.initialize()

    expect(started).toHaveLength(3)
    expect(started.map((item) => item.id)).toContain(firstJobId)
    expect(started[0]).toMatchObject({ trigger: { kind: 'startup' } })
    // The interval must still be armed for later ticks.
    await vi.advanceTimersByTimeAsync(zeroXRouterCalendarSchedulerPolicy.intervalMs + 1)
    expect(enqueued.length).toBeGreaterThan(0)
    scheduler.dispose()
  })

  it('keeps the interval armed when the startup run cannot be queued', async () => {
    vi.useFakeTimers()
    const { enqueued, jobRuntime } = schedulerHarness()
    const failing = { ...jobRuntime, enqueueDefinition: async () => { throw new Error('runtime busy') } }
    const scheduler = createZeroXRouterCalendarScheduler({
      jobRuntime: failing as never,
      readReadiness: () => ({ enabled: true, hasCredential: true }),
      refreshAutomatic: async () => ({ state: 'succeeded', items: [] })
    })
    await expect(scheduler.initialize()).resolves.toBeUndefined()
    await vi.advanceTimersByTimeAsync(zeroXRouterCalendarSchedulerPolicy.intervalMs + 1)
    expect(enqueued.length).toBeGreaterThan(0)
    scheduler.dispose()
  })

  it('actually enqueues a tick on its interval, without waiting for a completion', async () => {
    vi.useFakeTimers()
    const { enqueued, jobRuntime } = schedulerHarness()
    const scheduler = createZeroXRouterCalendarScheduler({
      jobRuntime: jobRuntime as never,
      readReadiness: () => ({ enabled: true, hasCredential: true }),
      refreshAutomatic: async () => ({ state: 'succeeded', items: [] })
    })
    await scheduler.initialize()

    expect(enqueued).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(zeroXRouterCalendarSchedulerPolicy.intervalMs + 1)
    expect(enqueued.length).toBeGreaterThan(0)
    expect(enqueued[0]?.id).toBe(firstJobId)
    scheduler.dispose()
  })

  it('spends no request when the 0xRouter source is disabled or has no credential', async () => {
    const { handlers, jobRuntime } = schedulerHarness()
    const refreshAutomatic = vi.fn(async () => ({ state: 'succeeded', items: [] }))
    const scheduler = createZeroXRouterCalendarScheduler({
      jobRuntime: jobRuntime as never,
      readReadiness: () => ({ enabled: false, hasCredential: true }),
      refreshAutomatic
    })
    await scheduler.initialize()
    await handlers.get(firstHandlerId)?.()
    expect(refreshAutomatic).not.toHaveBeenCalled()
    scheduler.dispose()
  })

  it('runs one automatic batch when the source is enabled and configured, and fails the run when nothing usable came back', async () => {
    const { handlers, jobRuntime } = schedulerHarness()
    const refreshAutomatic = vi.fn(async () => ({ state: 'succeeded', items: [] }))
    const scheduler = createZeroXRouterCalendarScheduler({
      jobRuntime: jobRuntime as never,
      readReadiness: () => ({ enabled: true, hasCredential: true }),
      refreshAutomatic
    })
    await scheduler.initialize()
    await expect(handlers.get(firstHandlerId)?.()).resolves.toBeUndefined()
    expect(refreshAutomatic).toHaveBeenCalledTimes(1)

    refreshAutomatic.mockResolvedValueOnce({ state: 'unavailable', failureCode: 'transport', items: [] })
    await expect(handlers.get(firstHandlerId)?.()).rejects.toThrow()
    scheduler.dispose()
  })

  it('reports what the batch stored, which is what lets a calendar update reach the analysis', async () => {
    const { handlers, jobRuntime } = schedulerHarness()
    const onRefreshCompleted = vi.fn()
    const scheduler = createZeroXRouterCalendarScheduler({
      jobRuntime: jobRuntime as never,
      readReadiness: () => ({ enabled: true, hasCredential: true }),
      refreshAutomatic: async () => ({ state: 'succeeded', items: [{ state: 'succeeded', storedRows: 386 }] }),
      onRefreshCompleted
    })
    await scheduler.initialize()
    await handlers.get(firstHandlerId)?.()
    expect(onRefreshCompleted).toHaveBeenCalledWith([{ state: 'succeeded', storedRows: 386 }])
    scheduler.dispose()
  })

  it('keeps the calendar tick successful even when the analysis request fails', async () => {
    const { handlers, jobRuntime } = schedulerHarness()
    const scheduler = createZeroXRouterCalendarScheduler({
      jobRuntime: jobRuntime as never,
      readReadiness: () => ({ enabled: true, hasCredential: true }),
      refreshAutomatic: async () => ({ state: 'succeeded', items: [{ state: 'succeeded', storedRows: 5 }] }),
      onRefreshCompleted: () => { throw new Error('analysis unavailable') }
    })
    await scheduler.initialize()
    await expect(handlers.get(firstHandlerId)?.()).resolves.toBeUndefined()
    scheduler.dispose()
  })

  it('does not keep ticking after dispose', async () => {
    vi.useFakeTimers()
    const { enqueued, jobRuntime } = schedulerHarness()
    const scheduler = createZeroXRouterCalendarScheduler({
      jobRuntime: jobRuntime as never,
      readReadiness: () => ({ enabled: true, hasCredential: true }),
      refreshAutomatic: async () => ({ state: 'succeeded', items: [] })
    })
    await scheduler.initialize()
    scheduler.dispose()
    await vi.advanceTimersByTimeAsync(zeroXRouterCalendarSchedulerPolicy.intervalMs * 3)
    expect(enqueued).toHaveLength(0)
  })
})
