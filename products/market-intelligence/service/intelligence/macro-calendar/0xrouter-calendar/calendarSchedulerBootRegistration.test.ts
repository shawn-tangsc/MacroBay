import type { JobRuntime } from '@platform/jobs'
import { describe, expect, it, vi } from 'vitest'

import { createZeroXRouterCalendarScheduler, zeroXRouterCalendarSchedulerFeeds, zeroXRouterCalendarSchedulerPolicy } from './zeroXRouterCalendarScheduler'

/**
 * 这两条守卫原来按**源码字符距离**匹配 `bootstrap.ts`：
 * `/as const[\s\S]{0,300}?marketCalendarScheduler\.initialize\(\)/`。
 * 它有两个毛病——合法重构就会红（Narwhal 装配把那行挪开就红了），
 * 而且它证不了它想证的事：源码里出现 `initialize()` 不等于启动时真的注册了。
 *
 * 现在改成**行为断言**：把依赖换成桩，直接看 `initialize()` 调用了什么。
 */

const jobRuntime = () => ({
  registerHandler: vi.fn(), setSchedule: vi.fn(), removeSchedule: vi.fn(), enqueueDefinition: vi.fn(async () => undefined)
}) as unknown as Pick<JobRuntime, 'registerHandler' | 'setSchedule' | 'removeSchedule' | 'enqueueDefinition'> & { [K in 'registerHandler' | 'setSchedule' | 'removeSchedule' | 'enqueueDefinition']: ReturnType<typeof vi.fn> }

const schedulerWith = (options: Readonly<{ enabledFeeds?: readonly string[]; ready?: boolean }> = {}) => {
  const runtime = jobRuntime()
  const scheduler = createZeroXRouterCalendarScheduler({
    jobRuntime: runtime,
    readReadiness: () => ({ enabled: options.ready ?? true, hasCredential: options.ready ?? true }),
    refreshAutomatic: vi.fn(async () => ({ state: 'completed' as const, items: [] })),
    ...(options.enabledFeeds === undefined ? {} : { readEnabledFeeds: () => options.enabledFeeds! })
  })
  return { scheduler, runtime }
}

describe('market calendar automatic refresh registration', () => {
  it('registers one schedule and one handler per enabled feed on initialize — no page or action gate in between', async () => {
    const { scheduler, runtime } = schedulerWith()
    await scheduler.initialize()
    expect(runtime.setSchedule).toHaveBeenCalledTimes(zeroXRouterCalendarSchedulerFeeds.length)
    expect(runtime.registerHandler).toHaveBeenCalledTimes(zeroXRouterCalendarSchedulerFeeds.length)
    // 每条定义的 id 里带着源 id：证明注册的是这些源，不是空转。
    const scheduledIds = runtime.setSchedule.mock.calls.map(call => (call[0] as { id: string }).id)
    for (const feed of zeroXRouterCalendarSchedulerFeeds) expect(scheduledIds.some(id => id.includes(feed.key))).toBe(true)
  })

  it('does not register a feed the reader turned off', async () => {
    const { scheduler, runtime } = schedulerWith({ enabledFeeds: [zeroXRouterCalendarSchedulerFeeds[0]!.sourceId] })
    await scheduler.initialize()
    expect(runtime.setSchedule).toHaveBeenCalledTimes(1)
    expect(runtime.removeSchedule.mock.calls.map(call => call[0]).length)
      .toBe(zeroXRouterCalendarSchedulerFeeds.length - 1)
  })

  it('removes every definition on dispose so a disabled source cannot keep refreshing after teardown', async () => {
    const { scheduler, runtime } = schedulerWith()
    await scheduler.initialize()
    runtime.setSchedule.mockClear()
    runtime.removeSchedule.mockClear()
    scheduler.dispose()
    expect(runtime.setSchedule).not.toHaveBeenCalled()
    expect(runtime.removeSchedule.mock.calls.length).toBeGreaterThanOrEqual(zeroXRouterCalendarSchedulerFeeds.length)
  })

  it('keeps the 30 minute cadence and its one definition id in the policy that owns them', () => {
    expect(zeroXRouterCalendarSchedulerPolicy.intervalMs).toBe(30 * 60 * 1_000)
    expect(zeroXRouterCalendarSchedulerPolicy.definitionId).toBe('market-intelligence.refreshMarketCalendar.automatic')
  })
})
