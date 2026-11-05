import { describe, expect, it, vi } from 'vitest'

import { createDailyBriefingRegenerate } from './dailyBriefingRegenerate'

const NOW = '2026-11-05T09:00:00.000Z'
const CHOSEN_0800 = '2026-11-05T00:00:00.000Z' // 08:00 Asia/Shanghai on the 5th

const harness = () => {
  const resolve = vi.fn(async (_input: unknown) => ({ state: 'available', document: {} }) as never)
  const regenerate = createDailyBriefingRegenerate({
    now: () => NOW,
    readGeneration: async () => ({ generationTime: '07:00', windowHours: 24 }),
    runs: { join: async (_key, run) => run(), key: (date, periodId, locale) => `${date}:${periodId}:${locale}` },
    resolve,
    withZone: (result) => result
  })
  return { regenerate, resolve }
}

describe('a manual run uses the cutoff the reader chose', () => {
  // 用户报的那条：选 08:00，生成出来的却是 07:00 那一版。
  // 根因是窗口按「排期时刻」算，选中的那一刻只被用来挑日期。
  it('hands the chosen instant to the run as its cutoff, not the schedule time', async () => {
    const { regenerate, resolve } = harness()
    await regenerate({ locale: 'en-US', timeZone: 'Asia/Shanghai', periodId: 'p-manual', generation: { asOf: CHOSEN_0800, windowHours: 24 } })

    expect(resolve).toHaveBeenCalledTimes(1)
    const input = resolve.mock.calls[0]![0] as unknown as Record<string, unknown>
    expect(input.asOf).toBe(CHOSEN_0800)
    expect(input.periodTime).toBe(CHOSEN_0800)
    expect(input.periodKind).toBe('manual')
    expect(input.periodId).toBe('p-manual')
    expect(input.locale).toBe('en-US')
    expect(input.date).toBe('2026-11-05')
    expect(input.windowHours).toBe(24)
  })

  it('keeps the schedule time as the cutoff when no cutoff was chosen (a re-run of the current edition)', async () => {
    const { regenerate, resolve } = harness()
    await regenerate({ locale: 'zh-CN', timeZone: 'Asia/Shanghai', periodId: 'default' })

    const input = resolve.mock.calls[0]![0] as unknown as Record<string, unknown>
    // 排期口径：当天 07:00（Asia/Shanghai）= 前一天 23:00Z。
    expect(input.asOf).toBe('2026-11-04T23:00:00.000Z')
    expect(input.periodKind).toBeUndefined()
  })
})
