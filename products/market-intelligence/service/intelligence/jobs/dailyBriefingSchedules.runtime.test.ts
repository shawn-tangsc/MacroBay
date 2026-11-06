import { afterEach, describe, expect, it } from 'vitest'

import { createJobRuntime, type JobRuntime } from '@platform/jobs'

import {
  createDailyBriefingGenerationSettingsService,
  createInMemoryDailyBriefingGenerationSettingsStorage
} from '../daily-briefing/dailyBriefingGenerationSettingsService'
import { applyDailyBriefingSchedules } from './registerDailyBriefingJob'
import { INTELLIGENCE_DAILY_BRIEFING_JOB } from './intelligenceJobIds'

const updatedAt = '2026-11-02T00:00:00.000Z'

const period = (id: string, generationTime: string, generationTimeZone?: string) => ({
  id,
  generationTime,
  ...(generationTimeZone ? { generationTimeZone } : {}),
  windowHours: 24 as const
})

/** The saved periods as the real settings service reads them, over an in-memory file. */
function settingsWith(periods: readonly unknown[]) {
  return createDailyBriefingGenerationSettingsService({
    storage: createInMemoryDailyBriefingGenerationSettingsStorage({ periods, updatedAt })
  })
}

let runtime: JobRuntime | undefined

afterEach(() => {
  runtime?.stopAll()
  runtime = undefined
})

describe('per-period schedules against the real job runtime', () => {
  it('registers one definition per saved period, keyed by period id', async () => {
    const settings = settingsWith([period('default', '08:00'), period('asia-open', '12:30', 'Asia/Shanghai')])
    runtime = createJobRuntime()
    applyDailyBriefingSchedules(runtime, await settings.getPeriods(), 'Europe/London')

    // T5: the registered table itself, not a helper's return value.
    expect(runtime.listSchedules().map((definition) => definition.id).sort()).toEqual([
      `${INTELLIGENCE_DAILY_BRIEFING_JOB}.asia-open`,
      `${INTELLIGENCE_DAILY_BRIEFING_JOB}.default`
    ])
    expect(runtime.listSchedules().map((definition) => definition.handlerId)).toEqual([
      INTELLIGENCE_DAILY_BRIEFING_JOB,
      INTELLIGENCE_DAILY_BRIEFING_JOB
    ])
    const payloads = Object.fromEntries(
      runtime.listSchedules().map((definition) => [definition.id, definition.payload])
    )
    expect(payloads).toEqual({
      [`${INTELLIGENCE_DAILY_BRIEFING_JOB}.default`]: { periodId: 'default' },
      [`${INTELLIGENCE_DAILY_BRIEFING_JOB}.asia-open`]: { periodId: 'asia-open' }
    })
  })

  it('leaves no definition behind for a period that was removed', async () => {
    runtime = createJobRuntime()
    applyDailyBriefingSchedules(runtime, await settingsWith([period('default', '08:00'), period('asia-open', '12:30')]).getPeriods(), 'Asia/Shanghai')

    const shrunk = settingsWith([period('default', '08:00')])
    const result = applyDailyBriefingSchedules(runtime, await shrunk.getPeriods(), 'Asia/Shanghai')

    expect(result.removed).toEqual(['asia-open'])
    // The end state, read from the runtime: "off" is an absent definition, not a handler filter.
    expect(runtime.listSchedules().map((definition) => definition.id)).toEqual([`${INTELLIGENCE_DAILY_BRIEFING_JOB}.default`])
  })

  it('keeps the other periods when one period zone cannot be read', async () => {
    runtime = createJobRuntime()
    applyDailyBriefingSchedules(runtime, await settingsWith([period('default', '08:00'), period('asia-open', '12:30')]).getPeriods(), 'Asia/Shanghai')

    const broken = settingsWith([period('default', '08:00'), period('asia-open', '12:30', 'Asia/Shangai')])
    const result = applyDailyBriefingSchedules(runtime, await broken.getPeriods(), 'Asia/Shanghai')

    expect(result.paused).toEqual(['asia-open'])
    expect(runtime.listSchedules().map((definition) => definition.id)).toEqual([`${INTELLIGENCE_DAILY_BRIEFING_JOB}.default`])
  })

  it('re-arms a period whose time moved: remove first, then set, and only one definition', async () => {
    runtime = createJobRuntime()
    applyDailyBriefingSchedules(runtime, await settingsWith([period('default', '08:00')]).getPeriods(), 'Asia/Shanghai')
    expect(runtime.listSchedules()[0]?.trigger).toMatchObject({ expression: '0 8 * * *' })

    const calls: string[] = []
    const spied = {
      setSchedule: (definition: Parameters<JobRuntime['setSchedule']>[0]) => { calls.push(`set:${definition.id}`); runtime!.setSchedule(definition) },
      removeSchedule: (id: string) => { calls.push(`remove:${id}`); runtime!.removeSchedule(id) },
      listSchedules: () => runtime!.listSchedules()
    }
    // A day has one 08:00 trigger. Updating in place would leave the old one armed as well.
    applyDailyBriefingSchedules(spied, await settingsWith([period('default', '09:00')]).getPeriods(), 'Asia/Shanghai')

    const definitionId = `${INTELLIGENCE_DAILY_BRIEFING_JOB}.default`
    expect(calls).toEqual([`remove:${definitionId}`, `set:${definitionId}`])
    expect(runtime.listSchedules()).toHaveLength(1)
    expect(runtime.listSchedules()[0]?.trigger).toMatchObject({ expression: '0 9 * * *' })
  })

  it('writes nothing when the periods did not change', async () => {
    runtime = createJobRuntime()
    const periods = await settingsWith([period('default', '08:00'), period('asia-open', '12:30', 'Asia/Shanghai')]).getPeriods()
    applyDailyBriefingSchedules(runtime, periods, 'Asia/Shanghai')

    const calls: string[] = []
    const spied = {
      setSchedule: (definition: Parameters<JobRuntime['setSchedule']>[0]) => { calls.push(`set:${definition.id}`); runtime!.setSchedule(definition) },
      removeSchedule: (id: string) => { calls.push(`remove:${id}`); runtime!.removeSchedule(id) },
      listSchedules: () => runtime!.listSchedules()
    }
    const result = applyDailyBriefingSchedules(spied, periods, 'Asia/Shanghai')

    expect(result).toMatchObject({ scheduled: ['default', 'asia-open'], removed: [], paused: [] })
    expect(calls).toEqual([])
  })

  it('leaves no definition when there is no period left', async () => {
    runtime = createJobRuntime()
    applyDailyBriefingSchedules(runtime, await settingsWith([period('default', '08:00')]).getPeriods(), 'Asia/Shanghai')
    expect(runtime.listSchedules()).toHaveLength(1)

    const result = applyDailyBriefingSchedules(runtime, [], 'Asia/Shanghai')

    expect(result.removed).toEqual(['default'])
    // "All periods off" is an empty schedule table, not a handler that returns early.
    expect(runtime.listSchedules()).toHaveLength(0)
  })
})

/**
 * 用户 2026-11-06 报的那条：配的是「每天 07:00」，实际跑在本地 15:00。
 *
 * 原因是注册排期时把时区当成了 UTC（期里没写时区 → 旧代码 `?? 'UTC'`）。这条用例钉住：
 * 读者时区给什么，排期就按什么走；**无论谁再传空，都不许静默变成 UTC**。
 */
describe('the schedule follows the reader’s clock', () => {
  it('arms a zone-less period in the reader zone, never in UTC', async () => {
    runtime = createJobRuntime()
    applyDailyBriefingSchedules(runtime, await settingsWith([period('default', '07:00')]).getPeriods(), 'Asia/Shanghai')

    const [definition] = runtime.listSchedules()
    expect(definition?.trigger).toMatchObject({ expression: '0 7 * * *', timezone: 'Asia/Shanghai' })
    expect(definition?.trigger).not.toMatchObject({ timezone: 'UTC' })
  })
})
