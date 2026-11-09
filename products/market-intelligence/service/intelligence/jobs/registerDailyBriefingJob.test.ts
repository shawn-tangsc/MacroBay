import { describe, expect, it, vi } from 'vitest'

import type { JobRuntime } from '@platform/jobs'

import type { BriefingPeriod } from '../../../contracts/dailyBriefingPeriod'
import type { DailyBriefingPeriod } from '../daily-briefing/dailyBriefingGenerationSettings'
import { applyDailyBriefingSchedules, registerDailyBriefingJob } from './registerDailyBriefingJob'
import { syncDailyBriefingSchedules } from './dailyBriefingSchedules'
import { INTELLIGENCE_DAILY_BRIEFING_JOB } from './intelligenceJobIds'

const flush = async (): Promise<void> => {
  for (let index = 0; index < 3; index += 1) await Promise.resolve()
}

function runtime() {
  const definitions = new Map<string, Record<string, unknown>>()
  let handler: ((payload?: unknown, context?: unknown) => Promise<unknown>) | undefined
  /** 平台每次运行都给一个可中止的信号；这里给真的 `AbortController`，不要拿假对象敷衍。 */
  const controller = new AbortController()
  const runtime = {
    registerHandler: (_id: string, next: (payload?: unknown, context?: unknown) => Promise<unknown>) => { handler = next },
    setSchedule: (definition: Record<string, unknown>) => { definitions.set(String(definition.id), definition) },
    removeSchedule: (id: string) => { definitions.delete(id) },
    listSchedules: () => [...definitions.values()]
  } as unknown as JobRuntime
  return {
    runtime, definitions, controller,
    run: (payload?: unknown) => handler!(payload, { signal: controller.signal })
  }
}

const period = (overrides: Partial<BriefingPeriod> = {}): BriefingPeriod => ({
  id: 'default',
  generationTime: '08:00',
  windowHours: 24 as never,
  // A period always carries its language now; the fixture starts in the interface language and
  // each case that cares overrides it.
  language: 'zh-CN',
  ...overrides
})

/**
 * The scheduler's own boundary still takes the older settings shape, which is the shape that
 * carries a per-period zone. The runtime feed below passes `BriefingPeriod`, which has none.
 */
const scheduledPeriod = (overrides: Partial<DailyBriefingPeriod> = {}): DailyBriefingPeriod => ({
  id: 'default',
  generationTime: '08:00',
  windowHours: 24 as never,
  ...overrides
})

// The handler only reports failure, so the fixture is the smallest available answer the service
// can return; the cast keeps the mock typed against the real signature.
const available = { state: 'available' as const, document: { edition: { date: '2026-10-30' } } } as never

describe('daily briefing schedules', () => {
  it('registers one definition per period, each under its own id and payload', async () => {
    // Two periods is the case the whole change exists for: the same morning must be able to run
    // twice at different times, and neither may answer for the other.
    const { runtime: jobRuntime, definitions } = runtime()
    applyDailyBriefingSchedules(jobRuntime, [scheduledPeriod(), scheduledPeriod({ id: 'asia-open', generationTime: '12:30', generationTimeZone: 'Asia/Shanghai' })], 'Europe/London')

    expect([...definitions.keys()].sort()).toEqual([
      `${INTELLIGENCE_DAILY_BRIEFING_JOB}.asia-open`,
      `${INTELLIGENCE_DAILY_BRIEFING_JOB}.default`
    ])
    expect(definitions.get(`${INTELLIGENCE_DAILY_BRIEFING_JOB}.asia-open`)).toMatchObject({
      // The handler id stays the base one: run history and the job copy are keyed by it.
      handlerId: INTELLIGENCE_DAILY_BRIEFING_JOB,
      payload: { periodId: 'asia-open' },
      trigger: { kind: 'cron', expression: '30 12 * * *', timezone: 'Asia/Shanghai' }
    })
    // No zone of its own means the reader's clock.
    expect(definitions.get(`${INTELLIGENCE_DAILY_BRIEFING_JOB}.default`)).toMatchObject({
      payload: { periodId: 'default' },
      trigger: { kind: 'cron', expression: '0 8 * * *', timezone: 'Europe/London' }
    })
  })

  it('removes the definition of a period that is gone and leaves the others alone', () => {
    const { runtime: jobRuntime, definitions } = runtime()
    applyDailyBriefingSchedules(jobRuntime, [period(), period({ id: 'asia-open', generationTime: '12:30' })], 'Asia/Shanghai')
    const result = applyDailyBriefingSchedules(jobRuntime, [period({ id: 'asia-open', generationTime: '12:30' })], 'Asia/Shanghai')

    expect(result.removed).toEqual(['default'])
    expect([...definitions.keys()]).toEqual([`${INTELLIGENCE_DAILY_BRIEFING_JOB}.asia-open`])
    // "Off" is a removed definition, never a handler that returns early.
    expect(jobRuntime.listSchedules()).toHaveLength(1)
  })

  it('re-registers the same id when a period time or zone moves', () => {
    const { runtime: jobRuntime, definitions } = runtime()
    applyDailyBriefingSchedules(jobRuntime, [scheduledPeriod()], 'Asia/Shanghai')
    applyDailyBriefingSchedules(jobRuntime, [scheduledPeriod({ generationTime: '09:30', generationTimeZone: 'Asia/Shanghai' })], 'Asia/Shanghai')

    expect([...definitions.keys()]).toEqual([`${INTELLIGENCE_DAILY_BRIEFING_JOB}.default`])
    expect(definitions.get(`${INTELLIGENCE_DAILY_BRIEFING_JOB}.default`)).toMatchObject({
      trigger: { kind: 'cron', expression: '30 9 * * *', timezone: 'Asia/Shanghai' }
    })
  })

  it('pauses only the period whose zone cannot be read', () => {
    // Today one unreadable zone pauses every automatic run. With one definition per period that
    // would mean a typo in the second period silences the first as well, silently.
    const { runtime: jobRuntime, definitions } = runtime()
    applyDailyBriefingSchedules(jobRuntime, [scheduledPeriod(), scheduledPeriod({ id: 'asia-open', generationTime: '12:30' })], 'Asia/Shanghai')
    const result = applyDailyBriefingSchedules(jobRuntime, [
      scheduledPeriod(),
      scheduledPeriod({ id: 'asia-open', generationTime: '12:30', generationTimeZone: 'Asia/Shangai' })
    ], 'Asia/Shanghai')

    expect(result.paused).toEqual(['asia-open'])
    expect(result.removed).toEqual(['asia-open'])
    expect([...definitions.keys()]).toEqual([`${INTELLIGENCE_DAILY_BRIEFING_JOB}.default`])
  })

  it('is idempotent: the same periods twice schedule nothing new and remove nothing', () => {
    const { runtime: jobRuntime } = runtime()
    const periods = [period(), period({ id: 'asia-open', generationTime: '12:30' })]
    applyDailyBriefingSchedules(jobRuntime, periods, 'Asia/Shanghai')
    const second = applyDailyBriefingSchedules(jobRuntime, periods, 'Asia/Shanghai')

    expect(second).toEqual({ scheduled: ['default', 'asia-open'], removed: [], paused: [] })
  })

})

describe('daily briefing job handler', () => {
  it('generates the period the definition names, with that period time and window', async () => {
    const { runtime: jobRuntime, run } = runtime()
    const getToday = vi.fn(async () => available)
    registerDailyBriefingJob(jobRuntime, {
      service: { getToday },
      getLocale: async () => 'zh-CN',
      timeZone: () => 'Europe/London',
      getPeriods: async () => [period({ id: 'asia-open', generationTime: '12:30', windowHours: 48 as never })]
    })

    await run({ periodId: 'asia-open' })

    // The scheduler fired this run, so the edition must record that trigger as well as the period.
    expect(getToday).toHaveBeenCalledWith({
      locale: 'zh-CN',
      // 期不写钟：这一版按读者当前显示时区解释那个时刻。
      timeZone: 'Europe/London',
      periodId: 'asia-open',
      periodKind: 'scheduled',
      runTrigger: 'scheduled',
      signal: expect.any(AbortSignal),
      generation: { generationTime: '12:30', windowHours: 48 }
    })
  })

  // 用户 2026-11-06：20:00 那期配的是英文，实际生成的是中文——触发时用的是界面语言。
  it('writes the edition in the period’s own language, whatever the interface language is', async () => {
    const { runtime: jobRuntime, run } = runtime()
    const getToday = vi.fn(async () => available)
    registerDailyBriefingJob(jobRuntime, {
      service: { getToday },
      getLocale: async () => 'zh-CN',
      timeZone: () => 'Asia/Shanghai',
      getPeriods: async () => [period({ id: 'evening-en', generationTime: '20:00', language: 'en-US' as never })]
    })

    await run({ periodId: 'evening-en' })

    expect(getToday).toHaveBeenCalledWith(expect.objectContaining({ locale: 'en-US', periodId: 'evening-en' }))
  })

  it('falls back to the interface language only when the period names none', async () => {
    const { runtime: jobRuntime, run } = runtime()
    const getToday = vi.fn(async () => available)
    registerDailyBriefingJob(jobRuntime, {
      service: { getToday },
      getLocale: async () => 'zh-CN',
      timeZone: () => 'Asia/Shanghai',
      getPeriods: async () => [period({ id: 'default', generationTime: '07:00' })]
    })

    await run({ periodId: 'default' })

    expect(getToday).toHaveBeenCalledWith(expect.objectContaining({ locale: 'zh-CN' }))
  })

  it('spends nothing on a run whose period is gone', async () => {
    const { runtime: jobRuntime, run } = runtime()
    const getToday = vi.fn(async () => available)
    registerDailyBriefingJob(jobRuntime, {
      service: { getToday },
      getLocale: async () => 'zh-CN',
      timeZone: () => 'UTC',
      getPeriods: async () => [period({ id: 'asia-open', generationTime: '12:30' })]
    })

    await expect(run({ periodId: 'gone' })).resolves.toBeUndefined()
    expect(getToday).not.toHaveBeenCalled()
  })

  it('hands the job its own abort signal, so a closing app never starts a retry', async () => {
    // 自动重试的活体判定读这个信号（`02` v2.165）：装配层漏传，就等于那条判据在真机上不存在。
    const { runtime: jobRuntime, run, controller } = runtime()
    const getToday = vi.fn(async () => ({ state: 'available' as const, document: {} }))
    registerDailyBriefingJob(jobRuntime, {
      service: { getToday: getToday as never },
      getLocale: async () => 'zh-CN',
      timeZone: () => 'UTC',
      getPeriods: async () => [period()]
    })

    await run({ periodId: 'default' })
    const passed = (getToday.mock.calls[0] as unknown as readonly [Readonly<{ signal?: AbortSignal }>] | undefined)?.[0]
    expect(passed?.signal).toBe(controller.signal)
  })

  it('surfaces a generation failure so the run is visible', async () => {
    const { runtime: jobRuntime, run } = runtime()
    registerDailyBriefingJob(jobRuntime, {
      service: { getToday: async () => ({ state: 'unavailable' as const, failureCode: 'source-failed' as const }) },
      getLocale: async () => 'en-US',
      timeZone: () => 'UTC',
      getPeriods: async () => [period()]
    })

    await expect(run({ periodId: 'default' })).rejects.toThrow('daily-briefing-generation-source-failed')
  })

  it('falls back to the default period at the policy time when the settings cannot be read', async () => {
    const { runtime: jobRuntime, definitions } = runtime()
    registerDailyBriefingJob(jobRuntime, {
      service: { getToday: vi.fn() },
      getLocale: async () => 'zh-CN',
      timeZone: () => 'Asia/Shanghai',
      getPeriods: async () => { throw new Error('settings unreadable') }
    })
    await flush()

    expect([...definitions.keys()]).toEqual([`${INTELLIGENCE_DAILY_BRIEFING_JOB}.default`])
    expect(definitions.get(`${INTELLIGENCE_DAILY_BRIEFING_JOB}.default`)).toMatchObject({
      payload: { periodId: 'default' },
      trigger: { kind: 'cron', expression: '0 7 * * *', timezone: 'Asia/Shanghai' }
    })
  })

  it('survives a runtime without a scheduler', () => {
    const noScheduler = { registerHandler: vi.fn() } as unknown as JobRuntime
    expect(() => registerDailyBriefingJob(noScheduler, {
      service: { getToday: vi.fn() },
      getLocale: async () => 'zh-CN',
      timeZone: () => 'UTC',
      getPeriods: async () => [period()]
    })).not.toThrow()
  })
})

describe('the diff is the only way definitions change', () => {
  it('reverting to one registered definition that filters periods inside the handler turns this red', () => {
    // The card guard: a single base-id definition cannot answer for two periods, so the T5 shape
    // (one id per period) is asserted here rather than trusted to review.
    const { runtime: jobRuntime } = runtime()
    const sync = syncDailyBriefingSchedules(
      jobRuntime,
      [period(), period({ id: 'asia-open', generationTime: '12:30' })],
      'UTC',
      () => undefined
    )

    expect(sync.scheduled).toEqual(['default', 'asia-open'])
    expect(jobRuntime.listSchedules().map((definition) => definition.id)).not.toContain(INTELLIGENCE_DAILY_BRIEFING_JOB)
  })
})

describe('a missing reader time zone at registration', () => {
  it('reports it and registers nothing, instead of rejecting with nobody listening', async () => {
    const { runtime: jobRuntime, definitions } = runtime()
    const log = vi.fn()
    const unhandled: unknown[] = []
    const onUnhandled = (reason: unknown): void => { unhandled.push(reason) }
    process.on('unhandledRejection', onUnhandled)
    try {
      registerDailyBriefingJob(jobRuntime, {
        service: { getToday: vi.fn() },
        getLocale: async () => 'zh-CN',
        // 装配缺钩子：这是可诊断的装配问题，不许变成没人接的拒绝，也不许静默排到 UTC。
        timeZone: () => { throw new Error('reader-time-zone-hook-missing') },
        getPeriods: async () => [period()],
        log
      })
      await new Promise(resolve => setTimeout(resolve, 0))
    } finally {
      process.off('unhandledRejection', onUnhandled)
    }
    expect(unhandled).toEqual([])
    // 一条明确的错误日志，指着缺的是时区钩子。
    expect(log).toHaveBeenCalledWith('error', 'briefing.schedule.time-zone-missing', expect.objectContaining({
      error: 'reader-time-zone-hook-missing'
    }))
    // 什么都不排：宁可没有排期，也不排到一个假时区上。
    expect([...definitions.keys()]).toEqual([])
  })
})

describe('paused periods', () => {
  it('reports only the periods whose own zone cannot be read', () => {
    const { runtime: jobRuntime } = runtime()
    const paused: string[] = []
    const onPaused = (ids: readonly string[]): void => { paused.push(...ids) }

    applyDailyBriefingSchedules(
      jobRuntime,
      [scheduledPeriod(), scheduledPeriod({ id: 'bad-zone', generationTimeZone: 'Asia/Shangai' })],
      'UTC',
      onPaused
    )
    expect(paused).toEqual(['bad-zone'])

    // 没有暂停就不报：这条通知说的是「自动生成停了」，不是「今天排过期」。
    paused.length = 0
    applyDailyBriefingSchedules(jobRuntime, [period()], 'UTC', onPaused)
    expect(paused).toEqual([])
  })
})
