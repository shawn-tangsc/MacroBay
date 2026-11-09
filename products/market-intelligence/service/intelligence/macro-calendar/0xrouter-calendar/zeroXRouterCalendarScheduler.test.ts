import { afterEach, describe, expect, it, vi } from 'vitest'

import { createJobScheduler } from '@platform/jobs/runtime/jobScheduler'
import type { JobDefinition } from '@platform/jobs'
import type { JobRuntime } from '@platform/jobs/runtime/jobRuntime'

import { resolveJobTitle } from '@platform/jobs/runtime/jobTitle'
import { createZeroXRouterCalendarScheduler, zeroXRouterCalendarSchedulerFeeds, zeroXRouterCalendarSchedulerPolicy } from './zeroXRouterCalendarScheduler'

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
  const scheduled: JobDefinition[] = []
  const jobRuntime = {
    registerHandler: (handlerId: string, handler: () => Promise<void>) => { handlers.set(handlerId, handler) },
    setSchedule: (definition: JobDefinition) => { scheduled.push(definition); scheduler.setSchedule(definition) },
    removeSchedule: (definitionId: string) => scheduler.removeSchedule(definitionId),
    enqueueDefinition: async (definition: JobDefinition) => { started.push(definition); return {} }
  }
  // 平台端口把 handler 声明成 (payload, context) 两参，而这条作业的 handler 两个都不读；假的运行时
  // 只需要一个能调用、能计数的最小实现，所以在这里一次性收窄。
  const runtime = jobRuntime as unknown as Pick<JobRuntime, 'registerHandler' | 'setSchedule' | 'removeSchedule' | 'enqueueDefinition'>
  return { enqueued, handlers, started, scheduled, jobRuntime: runtime }
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
    try {
      await scheduler.initialize()

      expect(started).toHaveLength(3)
      expect(started.map((item) => item.id)).toContain(firstJobId)
      expect(started[0]).toMatchObject({ trigger: { kind: 'startup' } })
      // The interval must still be armed for later ticks.
      await vi.advanceTimersByTimeAsync(zeroXRouterCalendarSchedulerPolicy.intervalMs + 1)
      expect(enqueued.length).toBeGreaterThan(0)
    } finally {
      scheduler.dispose()
      vi.useRealTimers()
    }
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
    try {
      await expect(scheduler.initialize()).resolves.toBeUndefined()
      await vi.advanceTimersByTimeAsync(zeroXRouterCalendarSchedulerPolicy.intervalMs + 1)
      expect(enqueued.length).toBeGreaterThan(0)
    } finally {
      scheduler.dispose()
      vi.useRealTimers()
    }
  })

  it('actually enqueues a tick on its interval, without waiting for a completion', async () => {
    vi.useFakeTimers()
    const { enqueued, jobRuntime } = schedulerHarness()
    const scheduler = createZeroXRouterCalendarScheduler({
      jobRuntime: jobRuntime as never,
      readReadiness: () => ({ enabled: true, hasCredential: true }),
      refreshAutomatic: async () => ({ state: 'succeeded', items: [] })
    })
    try {
      await scheduler.initialize()

      expect(enqueued).toHaveLength(0)
      await vi.advanceTimersByTimeAsync(zeroXRouterCalendarSchedulerPolicy.intervalMs + 1)
      expect(enqueued.length).toBeGreaterThan(0)
      expect(enqueued[0]?.id).toBe(firstJobId)
    } finally {
      scheduler.dispose()
      vi.useRealTimers()
    }
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
    const refreshAutomatic = vi.fn(async (): Promise<{ state: string; failureCode?: string; items: readonly unknown[] }> => ({ state: 'succeeded', items: [] }))
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

  // The 39-hour outage left only "did not complete" in `last_error`: the batch had no code of
  // its own, the verdict sat on the per-source item, and both were dropped. A refused request
  // must now name itself in the job's error.
  it('names the per-source verdict in the job error when the batch itself carries none', async () => {
    const { handlers, jobRuntime } = schedulerHarness()
    const scheduler = createZeroXRouterCalendarScheduler({
      jobRuntime: jobRuntime as never,
      readReadiness: () => ({ enabled: true, hasCredential: true }),
      refreshAutomatic: async () => ({
        state: 'unavailable',
        items: [{ state: 'unavailable', failureCode: 'response-unavailable' }, { state: 'unavailable', failureCode: 'response-unavailable' }]
      })
    })
    await scheduler.initialize()
    await expect(handlers.get(firstHandlerId)?.()).rejects.toThrow(
      'Market calendar automatic refresh did not complete for macro-calendar-0xrouter-economic-data (response-unavailable).')
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
    try {
      await scheduler.initialize()
      scheduler.dispose()
      await vi.advanceTimersByTimeAsync(zeroXRouterCalendarSchedulerPolicy.intervalMs * 3)
      expect(enqueued).toHaveLength(0)
    } finally {
      // dispose 已经在用例里调过；这里再调一次是幂等的，保证红的时候也不会把排期留给下一个用例。
      scheduler.dispose()
      vi.useRealTimers()
    }
  })

  // 读者在通知中心看到的是英文内部名（`Refresh 0xRouter market calendar: central-bank-activities`）。
  // 根因是名字由「英文 base 标题 + 内部 key」拼出来：既然要拼 key，就一定会把 key 印给读者。
  it('names every feed in both languages, without the vendor name or the internal key', async () => {
    const { scheduled, jobRuntime } = schedulerHarness()
    const scheduler = createZeroXRouterCalendarScheduler({
      jobRuntime,
      readReadiness: () => ({ enabled: true, hasCredential: true }),
      readEnabledFeeds: () => zeroXRouterCalendarSchedulerFeeds.map(feed => feed.sourceId),
      refreshAutomatic: async () => ({ state: 'completed', items: [] })
    })
    await scheduler.initialize()
    const titles = scheduled.map(definition => definition.title)
    expect(titles).toEqual([
      { 'zh-CN': '市场日历 · 经济数据', 'en-US': 'Market calendar · economic data' },
      { 'zh-CN': '市场日历 · 金融事件', 'en-US': 'Market calendar · financial events' },
      { 'zh-CN': '市场日历 · 央行活动', 'en-US': 'Market calendar · central bank activities' }
    ])
    for (const title of titles) {
      const text = JSON.stringify(title)
      expect(text).not.toContain('0xRouter')
      // The internal feed key is the thing the reader must never see, so no title may carry it.
      expect(text).not.toContain('central-bank-activities')
      expect(text).not.toContain('economic-data')
    }
    // The live surface resolves by the reader's language; a fixed English string fails here.
    expect(resolveJobTitle(titles[2]!, undefined, 'zh-CN')).toBe('市场日历 · 央行活动')
    expect(resolveJobTitle(titles[2]!, undefined, 'en-US')).toBe('Market calendar · central bank activities')
    scheduler.dispose()
  })
})
