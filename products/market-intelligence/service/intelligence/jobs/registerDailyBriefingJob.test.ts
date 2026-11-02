import { describe, expect, it, vi } from 'vitest'

import type { JobRuntime } from '@platform/jobs'

import type { DailyBriefingPeriod } from '../daily-briefing/dailyBriefingGenerationSettings'
import { applyDailyBriefingSchedules, registerDailyBriefingJob } from './registerDailyBriefingJob'
import { syncDailyBriefingSchedules } from './dailyBriefingSchedules'
import { INTELLIGENCE_DAILY_BRIEFING_JOB } from './intelligenceJobIds'

const flush = async (): Promise<void> => {
  for (let index = 0; index < 3; index += 1) await Promise.resolve()
}

function runtime() {
  const definitions = new Map<string, Record<string, unknown>>()
  let handler: ((payload?: unknown) => Promise<unknown>) | undefined
  const runtime = {
    registerHandler: (_id: string, next: (payload?: unknown) => Promise<unknown>) => { handler = next },
    setSchedule: (definition: Record<string, unknown>) => { definitions.set(String(definition.id), definition) },
    removeSchedule: (id: string) => { definitions.delete(id) },
    listSchedules: () => [...definitions.values()]
  } as unknown as JobRuntime
  return { runtime, definitions, run: (payload?: unknown) => handler!(payload) }
}

const period = (overrides: Partial<DailyBriefingPeriod> = {}): DailyBriefingPeriod => ({
  id: 'default',
  generationTime: '08:00',
  windowHours: 24 as never,
  ...overrides
})

const available = { state: 'available' as const, document: { edition: { date: '2026-10-30' } } }

describe('daily briefing schedules', () => {
  it('registers one definition per period, each under its own id and payload', async () => {
    // Two periods is the case the whole change exists for: the same morning must be able to run
    // twice at different times, and neither may answer for the other.
    const { runtime: jobRuntime, definitions } = runtime()
    applyDailyBriefingSchedules(jobRuntime, [period(), period({ id: 'asia-open', generationTime: '12:30', generationTimeZone: 'Asia/Shanghai' })], 'Europe/London')

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
    applyDailyBriefingSchedules(jobRuntime, [period(), period({ id: 'asia-open', generationTime: '12:30' })])
    const result = applyDailyBriefingSchedules(jobRuntime, [period({ id: 'asia-open', generationTime: '12:30' })])

    expect(result.removed).toEqual(['default'])
    expect([...definitions.keys()]).toEqual([`${INTELLIGENCE_DAILY_BRIEFING_JOB}.asia-open`])
    // "Off" is a removed definition, never a handler that returns early.
    expect(jobRuntime.listSchedules()).toHaveLength(1)
  })

  it('re-registers the same id when a period time or zone moves', () => {
    const { runtime: jobRuntime, definitions } = runtime()
    applyDailyBriefingSchedules(jobRuntime, [period()])
    applyDailyBriefingSchedules(jobRuntime, [period({ generationTime: '09:30', generationTimeZone: 'Asia/Shanghai' })])

    expect([...definitions.keys()]).toEqual([`${INTELLIGENCE_DAILY_BRIEFING_JOB}.default`])
    expect(definitions.get(`${INTELLIGENCE_DAILY_BRIEFING_JOB}.default`)).toMatchObject({
      trigger: { kind: 'cron', expression: '30 9 * * *', timezone: 'Asia/Shanghai' }
    })
  })

  it('pauses only the period whose zone cannot be read', () => {
    // Today one unreadable zone pauses every automatic run. With one definition per period that
    // would mean a typo in the second period silences the first as well, silently.
    const { runtime: jobRuntime, definitions } = runtime()
    applyDailyBriefingSchedules(jobRuntime, [period(), period({ id: 'asia-open', generationTime: '12:30' })])
    const result = applyDailyBriefingSchedules(jobRuntime, [
      period(),
      period({ id: 'asia-open', generationTime: '12:30', generationTimeZone: 'Asia/Shangai' })
    ])

    expect(result.paused).toEqual(['asia-open'])
    expect(result.removed).toEqual(['asia-open'])
    expect([...definitions.keys()]).toEqual([`${INTELLIGENCE_DAILY_BRIEFING_JOB}.default`])
  })

  it('is idempotent: the same periods twice schedule nothing new and remove nothing', () => {
    const { runtime: jobRuntime } = runtime()
    const periods = [period(), period({ id: 'asia-open', generationTime: '12:30' })]
    applyDailyBriefingSchedules(jobRuntime, periods)
    const second = applyDailyBriefingSchedules(jobRuntime, periods)

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
      getPeriods: async () => [period({ id: 'asia-open', generationTime: '12:30', generationTimeZone: 'Asia/Shanghai', windowHours: 48 as never })]
    })

    await run({ periodId: 'asia-open' })

    expect(getToday).toHaveBeenCalledWith({
      locale: 'zh-CN',
      timeZone: 'Asia/Shanghai',
      periodId: 'asia-open',
      generation: { generationTime: '12:30', windowHours: 48 }
    })
  })

  it('spends nothing on a run whose period is gone or whose zone no longer reads', async () => {
    const { runtime: jobRuntime, run } = runtime()
    const getToday = vi.fn(async () => available)
    registerDailyBriefingJob(jobRuntime, {
      service: { getToday },
      getLocale: async () => 'zh-CN',
      timeZone: () => 'UTC',
      getPeriods: async () => [period({ id: 'asia-open', generationTime: '12:30', generationTimeZone: 'Asia/Shangai' })]
    })

    await expect(run({ periodId: 'gone' })).resolves.toBeUndefined()
    await expect(run({ periodId: 'asia-open' })).resolves.toBeUndefined()
    expect(getToday).not.toHaveBeenCalled()
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
