import { describe, expect, it, vi } from 'vitest'

import { missedScheduledPeriods } from './dailyBriefingMissedPeriods'

const ZONE = 'Asia/Shanghai'
/** 11/06 08:30 本地：07:00 那期早已到点（超窗也一样，这一行与补跑窗口无关）。 */
const NOW = '2026-11-06T00:30:00.000Z'
const TODAY = '2026-11-06'

const harness = (input: Readonly<{
  periods?: readonly Record<string, unknown>[]
  now?: string
  edition?: boolean
  attempts?: number
  deleted?: boolean
}> = {}) => missedScheduledPeriods({
  store: {
    async get() { return input.edition === true ? {} as never : undefined },
    async listAttempts() { return input.attempts === undefined ? [] : Array.from({ length: input.attempts }, () => ({})) as never },
    async wasEditionDeleted() { return input.deleted === true }
  },
  periods: async () => (input.periods ?? [{ id: 'default', generationTime: '07:00', windowHours: 24 as const, language: 'zh-CN' as const }]) as never,
  today: TODAY,
  now: input.now ?? NOW,
  readerTimeZone: ZONE,
  fallbackLocale: 'zh-CN'
})

describe('a scheduled period that passed its cutoff with nothing to show gets a row', () => {
  // 用户 2026-11-06（`02` v2.149 甲案）：不建行就没有任何一行能说"中文这版没生成"，那就是静默。
  it('lists a configured period whose cutoff passed with no edition and no attempt', async () => {
    expect(await harness()).toEqual([{ date: TODAY, periodId: 'default', locale: 'zh-CN' }])
  })

  it('does not pre-announce a failure before the cutoff', async () => {
    expect(await harness({ now: '2026-11-05T22:30:00.000Z' })).toEqual([])
  })

  it('stays out of the way when the period has an edition', async () => {
    expect(await harness({ edition: true })).toEqual([])
  })

  it('stays out of the way when the period left attempts', async () => {
    // 跑了（哪怕失败）由那一行自己说"这次失败"，不在这里再造一行"到点时没能生成"。
    expect(await harness({ attempts: 1 })).toEqual([])
  })

  it('stays out of the way when the reader deleted it', async () => {
    // 否则删完又冒一行，等于删不掉。
    expect(await harness({ deleted: true })).toEqual([])
  })

  it('never speaks for a manual period — it has no configuration, so nothing is "expected"', async () => {
    const missed = await harness({ periods: [] })
    expect(missed).toEqual([])
  })

  it('reads each period on its own clock', async () => {
    // 期带时区：UTC 20:00 此刻（00:30Z）已过；UTC 23:00 还没到。
    const periods = [
      { id: 'utc-midnight', generationTime: '00:00', windowHours: 24 as const, language: 'en-US' as const, generationTimeZone: 'UTC' },
      { id: 'utc-evening', generationTime: '20:00', windowHours: 24 as const, language: 'en-US' as const, generationTimeZone: 'UTC' }
    ]
    // UTC 此刻 00:30：00:00 已过、20:00 还没到。
    const missed = await missedScheduledPeriods({
      store: { async get() { return undefined }, async listAttempts() { return [] }, async wasEditionDeleted() { return false } },
      periods: async () => periods as never,
      today: '2026-11-06', now: NOW, readerTimeZone: ZONE, fallbackLocale: 'zh-CN'
    })
    expect(missed.map((row) => row.periodId)).toEqual(['utc-midnight'])
  })
})
