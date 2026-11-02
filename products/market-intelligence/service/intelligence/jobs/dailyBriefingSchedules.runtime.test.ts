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
    applyDailyBriefingSchedules(runtime, await settingsWith([period('default', '08:00'), period('asia-open', '12:30')]).getPeriods())

    const shrunk = settingsWith([period('default', '08:00')])
    const result = applyDailyBriefingSchedules(runtime, await shrunk.getPeriods())

    expect(result.removed).toEqual(['asia-open'])
    // The end state, read from the runtime: "off" is an absent definition, not a handler filter.
    expect(runtime.listSchedules().map((definition) => definition.id)).toEqual([`${INTELLIGENCE_DAILY_BRIEFING_JOB}.default`])
  })

  it('keeps the other periods when one period zone cannot be read', async () => {
    runtime = createJobRuntime()
    applyDailyBriefingSchedules(runtime, await settingsWith([period('default', '08:00'), period('asia-open', '12:30')]).getPeriods())

    const broken = settingsWith([period('default', '08:00'), period('asia-open', '12:30', 'Asia/Shangai')])
    const result = applyDailyBriefingSchedules(runtime, await broken.getPeriods())

    expect(result.paused).toEqual(['asia-open'])
    expect(runtime.listSchedules().map((definition) => definition.id)).toEqual([`${INTELLIGENCE_DAILY_BRIEFING_JOB}.default`])
  })
})
