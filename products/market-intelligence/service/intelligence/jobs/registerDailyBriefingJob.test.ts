import { describe, expect, it, vi } from 'vitest'

import type { JobRuntime } from '@platform/jobs'

import { registerDailyBriefingJob } from './registerDailyBriefingJob'
import { INTELLIGENCE_DAILY_BRIEFING_JOB } from './intelligenceJobIds'

function runtime() {
  let handler: (() => Promise<unknown>) | undefined
  const schedules: unknown[] = []
  const runtime = {
    registerHandler: (_id: string, next: () => Promise<unknown>) => { handler = next },
    setSchedule: (definition: unknown) => { schedules.push(definition) }
  } as unknown as JobRuntime
  return { runtime, schedules, run: () => handler!() }
}

describe('daily briefing job', () => {
  it('registers a local 07:30 cron and generates through the same service', async () => {
    const { runtime: jobRuntime, schedules, run } = runtime()
    const getToday = vi.fn(async () => ({
      state: 'available' as const,
      document: { edition: { date: '2026-10-30' } }
    }))
    registerDailyBriefingJob(jobRuntime, { service: { getToday }, getLocale: async () => 'zh-CN', timeZone: () => 'Asia/Shanghai' })

    expect(schedules).toEqual([expect.objectContaining({
      id: INTELLIGENCE_DAILY_BRIEFING_JOB,
      trigger: { kind: 'cron', expression: '30 7 * * *', timezone: 'Asia/Shanghai' }
    })])
    expect(await run()).toBeUndefined()
    expect(getToday).toHaveBeenCalledWith({ locale: 'zh-CN', timeZone: 'Asia/Shanghai' })
  })

  it('surfaces a generation failure and survives a runtime without a scheduler', async () => {
    const { runtime: jobRuntime, run } = runtime()
    registerDailyBriefingJob(jobRuntime, {
      service: { getToday: async () => ({ state: 'unavailable' as const, failureCode: 'source-failed' as const }) },
      getLocale: async () => 'en-US'
    })
    await expect(run()).rejects.toThrow('daily-briefing-generation-source-failed')

    const noScheduler = { registerHandler: vi.fn() } as unknown as JobRuntime
    expect(() => registerDailyBriefingJob(noScheduler, {
      service: { getToday: vi.fn() }, getLocale: async () => 'zh-CN'
    })).not.toThrow()
  })
})
