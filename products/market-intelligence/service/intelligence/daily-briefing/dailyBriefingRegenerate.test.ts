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
    // 期次类型不在这里传：由 runTrigger 一处推导（`02` v2.134 G9）。
    expect(input.runTrigger).toBe('manual')
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
    // 没选截止时刻也是**手动发起**：点「手动生成」直接按生成的那条路，期次类型必须是手动期。
    // 以前这里会是 scheduled + manual 并存，列表于是把一版手动生成的日报显示成「定时」。
    expect(input.runTrigger).toBe('manual')
  })
})

describe('a re-run takes the moment, window and language of the period it names', () => {
  // 用户 2026-11-06：那一刻写的是"20:00 英文那期"的身份，内容是 07:00 的中文——三个来源各来一处。
  it('uses the named period’s own time, window and language', async () => {
    const resolve = vi.fn(async (_input: unknown) => ({ state: 'available', document: {} }) as never)
    const regenerate = createDailyBriefingRegenerate({
      now: () => NOW,
      // 全局默认仍是 07:00 中文：这一笔的价值就在于它**不该**被用上。
      readGeneration: async () => ({ generationTime: '07:00', windowHours: 24 }),
      readPeriods: async () => [
        { id: 'default', generationTime: '07:00', windowHours: 24 as const, language: 'zh-CN' as const },
        { id: 'evening-en', generationTime: '20:00', windowHours: 24 as const, language: 'en-US' as const }
      ],
      runs: { join: async (_key, run) => run(), key: (date, periodId, locale) => `${date}:${periodId}:${locale}` },
      resolve,
      withZone: (result) => result
    })

    await regenerate({ locale: 'zh-CN', timeZone: 'Asia/Shanghai', periodId: 'evening-en' })

    const input = resolve.mock.calls[0]![0] as unknown as Record<string, unknown>
    // 20:00 于 Asia/Shanghai = 当天 12:00Z，可此刻才 17:00 本地（09:00Z）：窗口不伸进未来，
    // 所以截止到"现在"。日期仍是这一天（没有"当前期"）。
    expect(input.asOf).toBe('2026-11-05T09:00:00.000Z')
    expect(input.locale).toBe('en-US')
    expect(input.periodId).toBe('evening-en')
  })

  it('keeps the schedule default when the period is not in the configuration', async () => {
    const resolve = vi.fn(async (_input: unknown) => ({ state: 'available', document: {} }) as never)
    const regenerate = createDailyBriefingRegenerate({
      now: () => NOW,
      readGeneration: async () => ({ generationTime: '07:00', windowHours: 24 }),
      readPeriods: async () => [],
      runs: { join: async (_key, run) => run(), key: (date, periodId, locale) => `${date}:${periodId}:${locale}` },
      resolve,
      withZone: (result) => result
    })

    await regenerate({ locale: 'zh-CN', timeZone: 'Asia/Shanghai', periodId: 'manual-uuid' })

    const input = resolve.mock.calls[0]![0] as unknown as Record<string, unknown>
    expect(input.asOf).toBe('2026-11-04T23:00:00.000Z')
  })
})

describe('a re-run of the edition on screen keeps that edition\'s own cutoff and window', () => {
  // 用户 2026-11-06 两次报同一条：点「重新生成」，时刻又变回 07:00。07:00 只是初始化时第 1 期的
  // 默认值，不许在别处当默认；重跑的是屏幕上那一版，四样（期号、截止、窗口、语言）都取它自己的。
  const rerunHarness = (readGeneration: () => Promise<{ generationTime: string; windowHours: 24 }>) => {
    const resolve = vi.fn(async (_input: unknown) => ({ state: 'available', document: {} }) as never)
    const regenerate = createDailyBriefingRegenerate({
      now: () => NOW,
      readGeneration,
      // 期配置里只有默认那 07:00：手动期在配置表里根本没有行，这正是以前回落到它的地方。
      readPeriods: async () => [{ id: 'default', generationTime: '07:00', windowHours: 24 as const, language: 'zh-CN' as const }],
      runs: { join: async (_key, run) => run(), key: (date, periodId, locale) => `${date}:${periodId}:${locale}` },
      resolve,
      withZone: (result) => result
    })
    return { regenerate, resolve }
  }

  it('keeps an 08:00 edition at 08:00 with its own window and language', async () => {
    const readGeneration = vi.fn(async () => ({ generationTime: '07:00', windowHours: 24 as const }))
    const { regenerate, resolve } = rerunHarness(readGeneration)

    await regenerate({
      locale: 'zh-CN', timeZone: 'Asia/Shanghai', periodId: 'manual-0800',
      rerun: { periodTime: CHOSEN_0800, windowHours: 12 }
    })

    const input = resolve.mock.calls[0]![0] as unknown as Record<string, unknown>
    expect(input.asOf).toBe(CHOSEN_0800)
    expect(input.periodTime).toBe(CHOSEN_0800)
    expect(input.windowHours).toBe(12)
    expect(input.periodId).toBe('manual-0800')
    expect(input.date).toBe('2026-11-05')
    // 默认期配置一次都没读：它不该参与"重跑已有这一版"。
    expect(readGeneration).not.toHaveBeenCalled()
  })

  it('keeps the default period at 07:00 when that is the edition being re-run', async () => {
    const { regenerate, resolve } = rerunHarness(async () => ({ generationTime: '07:00', windowHours: 24 as const }))

    await regenerate({
      locale: 'zh-CN', timeZone: 'Asia/Shanghai', periodId: 'default',
      rerun: { periodTime: '2026-11-04T23:00:00.000Z', windowHours: 24 }
    })

    const input = resolve.mock.calls[0]![0] as unknown as Record<string, unknown>
    expect(input.asOf).toBe('2026-11-04T23:00:00.000Z')
    expect(input.windowHours).toBe(24)
    expect(input.locale).toBe('zh-CN')
  })

  it('never falls back to the first configured period for a manual edition it cannot find', async () => {
    const { regenerate, resolve } = rerunHarness(async () => ({ generationTime: '07:00', windowHours: 24 as const }))

    await regenerate({
      locale: 'en-US', timeZone: 'Asia/Shanghai', periodId: 'manual-uuid',
      rerun: { periodTime: '2026-11-05T04:30:00.000Z' }
    })

    const input = resolve.mock.calls[0]![0] as unknown as Record<string, unknown>
    expect(input.asOf).toBe('2026-11-05T04:30:00.000Z')
    expect(input.periodTime).toBe('2026-11-05T04:30:00.000Z')
    expect(input.locale).toBe('en-US')
    // 没带窗口时不编一个默认窗口塞进去：`briefingWindowAtCutoff` 用它自己的缺省（24h），
    // 但绝不再从期配置列表第一项取。
    expect(input.windowHours).toBe(24)
  })
})
