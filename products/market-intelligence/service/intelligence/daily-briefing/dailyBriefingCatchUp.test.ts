import { describe, expect, it, vi } from 'vitest'

import { briefingCatchUpDue, catchUpMissedDailyBriefings } from './dailyBriefingCatchUp'

const ZONE = 'Asia/Shanghai'
/** 11/06 08:30 本地：今天的 07:00 已经过了。 */
const AFTER_CUTOFF = '2026-11-06T00:30:00.000Z'
/** 11/06 06:30 本地：还没到点。 */
const BEFORE_CUTOFF = '2026-11-05T22:30:00.000Z'

const period = (extra: Record<string, unknown> = {}) => ({
  id: 'default', generationTime: '07:00', windowHours: 24 as const, language: 'zh-CN' as const, ...extra
})

function harness(input: Readonly<{
  now?: string
  periods?: readonly ReturnType<typeof period>[]
  editions?: readonly string[]
  attempted?: readonly string[]
  deleted?: readonly string[]
}> = {}) {
  const run = vi.fn(async (_input: unknown) => ({ state: 'available' }))
  // 按**期**记：一期跑过不代表另一期跑过。
  const attempts = new Map<string, number>()
  const state = {
    editions: new Set(input.editions ?? [])
  }
  for (const id of input.attempted ?? []) attempts.set(id, 1)
  const catchUp = () => catchUpMissedDailyBriefings({
    getPeriods: async () => input.periods ?? [period()],
    getLocale: async () => 'zh-CN' as const,
    readerTimeZone: () => ZONE,
    now: () => input.now ?? AFTER_CUTOFF,
    hasEdition: async ({ periodId }) => state.editions.has(periodId),
    wasDeleted: async ({ periodId }) => (input.deleted ?? []).includes(periodId),
    attemptCount: async ({ periodId }) => attempts.get(periodId) ?? 0,
    run: async (options) => {
      run(options)
      // 跑一次就留下一条 attempt：同一刻的第二次调用必须看得见它。
      attempts.set((options as { periodId: string }).periodId, 1)
      return { state: 'available' }
    }
  })
  return { catchUp, run, state }
}

describe('a missed period is caught up once, when the app starts', () => {
  // 用户 2026-11-06：今天 07:00 那期一次都没跑——修时区那一刻今天 07:00 已过，下一次触发直接到了明天。
  it('runs a period whose cutoff has passed today and that never ran', async () => {
    const { catchUp, run } = harness()
    expect((await catchUp()).ran).toEqual(['default'])
    expect(run).toHaveBeenCalledTimes(1)
    // 补的是这一期**自己的**时刻、窗口、语言与时区，与定时那条路同一份输入。
    expect(run.mock.calls[0]![0]).toMatchObject({
      date: '2026-11-06', locale: 'zh-CN', periodId: 'default',
      timeZone: ZONE, generationTime: '07:00', windowHours: 24
    })
  })

  it('does not run the same period twice in one day', async () => {
    const { catchUp, run } = harness()
    await catchUp()
    await catchUp()
    // 第一次补跑留下的 attempt 就是"跑过"的证据；第二次不再补。
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('skips a period that already left an attempt in any state', async () => {
    const { catchUp, run } = harness({ attempted: ['default'] })
    expect((await catchUp()).skipped).toEqual([{ periodId: 'default', why: 'has-attempt' }])
    expect(run).not.toHaveBeenCalled()
  })

  it('skips a period that already has an edition today', async () => {
    const { catchUp, run } = harness({ editions: ['default'] })
    expect((await catchUp()).skipped).toEqual([{ periodId: 'default', why: 'has-edition' }])
    expect(run).not.toHaveBeenCalled()
  })

  it('does nothing before today’s cutoff', async () => {
    const { catchUp, run } = harness({ now: BEFORE_CUTOFF })
    expect((await catchUp()).skipped).toEqual([{ periodId: 'default', why: 'not-due' }])
    expect(run).not.toHaveBeenCalled()
  })

  it('catches up each period in its own language and zone', async () => {
    const { catchUp, run } = harness({
      periods: [
        period(),
        period({ id: 'period_evening', generationTime: '00:00', language: 'en-US', generationTimeZone: 'UTC' })
      ]
    })
    await catchUp()
    expect(run).toHaveBeenCalledTimes(2)
    expect(run.mock.calls[1]![0]).toMatchObject({ periodId: 'period_evening', locale: 'en-US', timeZone: 'UTC' })
  })
})

describe('the cutoff of a period is the wall clock the reader configured', () => {
  it('is due only once the reader’s own clock has passed it', () => {
    expect(briefingCatchUpDue(period(), ZONE, AFTER_CUTOFF)).toEqual({ date: '2026-11-06', cutoff: '2026-11-05T23:00:00.000Z' })
    expect(briefingCatchUpDue(period(), ZONE, BEFORE_CUTOFF)).toBeUndefined()
  })

  it('never reaches back to yesterday: a missed day is not this rule', () => {
    // 06:30 那一刻 briefingWindow 给的还是昨天那一版；补跑只补今天，历史补生成是另一件事。
    expect(briefingCatchUpDue(period(), ZONE, '2026-11-05T22:30:00.000Z')).toBeUndefined()
  })

  it('reads the period’s own zone when it has one', () => {
    const utc = period({ generationTimeZone: 'UTC' })
    // UTC 07:00 已过（此刻 UTC 00:30 还没到）——同一时刻在本地钟上是"过了"，在 UTC 钟上还没到。
    expect(briefingCatchUpDue(utc, ZONE, AFTER_CUTOFF)).toBeUndefined()
    expect(briefingCatchUpDue(utc, ZONE, '2026-11-06T07:30:00.000Z')).toEqual({ date: '2026-11-06', cutoff: '2026-11-06T07:00:00.000Z' })
  })
})

describe('a catch-up that ran but did not succeed is reported, never swallowed', () => {
  it('lists the period under failed with the service code', async () => {
    // 用户 2026-11-06：补跑"库零尝试、日志无痕迹"，就是因为失败没有出口。跑了没成也要说出来。
    const outcome = await catchUpMissedDailyBriefings({
      getPeriods: async () => [period()],
      getLocale: async () => 'zh-CN' as const,
      readerTimeZone: () => ZONE,
      now: () => AFTER_CUTOFF,
      hasEdition: async () => false,
      attemptCount: async () => 0,
      wasDeleted: async () => false,
      run: async () => ({ state: 'unavailable', failureCode: 'run-timeout' })
    })
    expect(outcome.ran).toEqual([])
    expect(outcome.failed).toEqual([{ periodId: 'default', failureCode: 'run-timeout' }])
  })

  it('reports a run that threw instead of failing the whole check', async () => {
    const outcome = await catchUpMissedDailyBriefings({
      getPeriods: async () => [period()],
      getLocale: async () => 'zh-CN' as const,
      readerTimeZone: () => ZONE,
      now: () => AFTER_CUTOFF,
      hasEdition: async () => false,
      attemptCount: async () => 0,
      wasDeleted: async () => false,
      run: async () => { throw new Error('store-down') }
    })
    expect(outcome.failed).toEqual([{ periodId: 'default', failureCode: 'store-down' }])
  })
})

describe('a row the reader deleted is not generated again', () => {
  it('skips a period whose (date, period, language) was deleted', async () => {
    // 删完之后「已过点 + 零 attempt + 零版次」三条全成立；不认删除的话，下次启动就又生成回来。
    const { catchUp, run } = harness({ deleted: ['default'] })
    const outcome = await catchUp()
    expect(outcome.skipped).toEqual([{ periodId: 'default', why: 'deleted-by-reader' }])
    expect(run).not.toHaveBeenCalled()
  })
})
