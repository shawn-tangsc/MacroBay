import { describe, expect, it, vi } from 'vitest'

import { DAILY_BRIEFING_IPC_METHODS, registerDailyBriefingIpc } from './registerDailyBriefingIpc'

const service = {
  getToday: vi.fn(), list: vi.fn(), regenerate: vi.fn(), getProgress: vi.fn(), get: vi.fn(),
  listAttempts: vi.fn(), getStorageState: vi.fn(() => ({ state: 'ready' })), retryUpgrade: vi.fn(() => ({ state: 'ready' }))
} as never

function registerAll(deletePeriod?: (input: Readonly<{ date: string; periodId: string; locale: string }>) => Promise<never>) {
  const handlers = new Map<string, (payload: unknown) => Promise<unknown>>()
  registerDailyBriefingIpc((( _product: string, method: string, handler: (payload: unknown) => Promise<unknown>) => {
    handlers.set(method, handler)
  }) as never, service, undefined, deletePeriod as never)
  return handlers
}

describe('the regenerate payload keeps the run\'s identity', () => {
  // 用户报的「选 8 点、跑成 7 点」：这一层曾把 periodId 与 generation 一起丢掉，服务看到的是
  // `periodId: undefined`，于是落回 default，覆盖了读者正在看的那一版。这条用例防的就是这个。
  it('passes the period, language and chosen cutoff through unchanged', async () => {
    const regenerate = vi.fn(async () => ({ state: 'available' }))
    const handlers = new Map<string, (payload: unknown) => Promise<unknown>>()
    registerDailyBriefingIpc(((_product: string, method: string, handler: (payload: unknown) => Promise<unknown>) => {
      handlers.set(method, handler)
    }) as never, { ...(service as unknown as Record<string, unknown>), regenerate } as never)
    const handler = handlers.get(DAILY_BRIEFING_IPC_METHODS.regenerate)!

    await handler({
      locale: 'en-US',
      timeZone: 'Asia/Shanghai',
      periodId: 'period_18ce8fe5-781d-490a-a5e4-689390f1e6cf',
      generation: { asOf: '2026-11-05T00:00:00.000Z', windowHours: 24 }
    })

    expect(regenerate).toHaveBeenCalledWith({
      locale: 'en-US',
      timeZone: 'Asia/Shanghai',
      periodId: 'period_18ce8fe5-781d-490a-a5e4-689390f1e6cf',
      generation: { asOf: '2026-11-05T00:00:00.000Z', windowHours: 24 }
    })
  })

  // 用户 2026-11-06：点「重新生成」又变回 07:00——服务端只能回落到期配置第一项。重跑这一版要
  // 把它自己的截止与窗口带过去；这一层同样不许在半路弄丢。
  it('passes the on-screen edition\'s own cutoff and window through unchanged', async () => {
    const regenerate = vi.fn(async () => ({ state: 'available' }))
    const handlers = new Map<string, (payload: unknown) => Promise<unknown>>()
    registerDailyBriefingIpc(((_product: string, method: string, handler: (payload: unknown) => Promise<unknown>) => {
      handlers.set(method, handler)
    }) as never, { ...(service as unknown as Record<string, unknown>), regenerate } as never)
    const handler = handlers.get(DAILY_BRIEFING_IPC_METHODS.regenerate)!

    await handler({
      locale: 'zh-CN',
      timeZone: 'Asia/Shanghai',
      periodId: 'manual-0800',
      rerun: { periodTime: '2026-11-05T00:00:00.000Z', windowHours: 12 }
    })

    expect(regenerate).toHaveBeenCalledWith({
      locale: 'zh-CN',
      timeZone: 'Asia/Shanghai',
      periodId: 'manual-0800',
      rerun: { periodTime: '2026-11-05T00:00:00.000Z', windowHours: 12 }
    })
  })

  it('refuses a rerun whose cutoff or window cannot be read', async () => {
    const regenerate = vi.fn(async () => ({ state: 'available' }))
    const handlers = new Map<string, (payload: unknown) => Promise<unknown>>()
    registerDailyBriefingIpc(((_product: string, method: string, handler: (payload: unknown) => Promise<unknown>) => {
      handlers.set(method, handler)
    }) as never, { ...(service as unknown as Record<string, unknown>), regenerate } as never)
    const handler = handlers.get(DAILY_BRIEFING_IPC_METHODS.regenerate)!

    // 一个读不懂的截止如果被悄悄丢掉，服务端就会退回默认期——正是这次的事故形态。
    await expect(handler({ locale: 'zh-CN', timeZone: 'Asia/Shanghai', rerun: { periodTime: '2026-11-05 08:00' } }))
      .rejects.toThrow('daily-briefing-invalid-request')
    await expect(handler({ locale: 'zh-CN', timeZone: 'Asia/Shanghai', rerun: { periodTime: '2026-11-05T00:00:00.000Z', windowHours: 6 } }))
      .rejects.toThrow('daily-briefing-invalid-request')
    expect(regenerate).not.toHaveBeenCalled()
  })

  it('refuses a malformed cutoff instead of silently dropping it', async () => {
    const regenerate = vi.fn(async () => ({ state: 'available' }))
    const handlers = new Map<string, (payload: unknown) => Promise<unknown>>()
    registerDailyBriefingIpc(((_product: string, method: string, handler: (payload: unknown) => Promise<unknown>) => {
      handlers.set(method, handler)
    }) as never, { ...(service as unknown as Record<string, unknown>), regenerate } as never)
    const handler = handlers.get(DAILY_BRIEFING_IPC_METHODS.regenerate)!

    // 静默丢弃正是这次的事故形态：读者选的时刻不见了，跑出来的还是别的期。
    await expect(handler({ locale: 'zh-CN', timeZone: 'Asia/Shanghai', generation: { asOf: 'tomorrowish' } }))
      .rejects.toThrow('daily-briefing-invalid-request')
    expect(regenerate).not.toHaveBeenCalled()
  })
})

describe('daily briefing delete channel', () => {
  it('registers the delete method under its own name', () => {
    expect(DAILY_BRIEFING_IPC_METHODS.deletePeriod).toBe('intelligence.dailyBriefing.deletePeriod')
    expect(registerAll().has('intelligence.dailyBriefing.deletePeriod')).toBe(true)
  })

  it('forwards "read only, do not generate" and nothing else', async () => {
    const getToday = vi.fn(async () => ({ state: 'unavailable' }))
    const handlers = new Map<string, (payload: unknown) => Promise<unknown>>()
    registerDailyBriefingIpc(((_product: string, method: string, handler: (payload: unknown) => Promise<unknown>) => {
      handlers.set(method, handler)
    }) as never, { ...(service as unknown as Record<string, unknown>), getToday } as never)
    const handler = handlers.get('intelligence.dailyBriefing.getToday')!

    await handler({ locale: 'zh-CN', timeZone: 'Asia/Shanghai', generate: false })
    expect(getToday).toHaveBeenCalledWith({ locale: 'zh-CN', timeZone: 'Asia/Shanghai', generate: false })
    // An ordinary open keeps the old shape: the flag exists only to suppress a run.
    await handler({ locale: 'zh-CN', timeZone: 'Asia/Shanghai' })
    expect(getToday).toHaveBeenLastCalledWith({ locale: 'zh-CN', timeZone: 'Asia/Shanghai' })
  })

  it('passes the validated date, period and edition language to the delete handler', async () => {
    const deletePeriod = vi.fn(async () => ({ editions: 1, attempts: 0, periodRuns: 0, sessionLinks: 3, allDone: true }))
    const handler = registerAll(deletePeriod as never).get('intelligence.dailyBriefing.deletePeriod')!
    // 入口必填：操作记录要能回答"从哪删的"（用户 2026-11-06），缺了直接拒。
    await expect(handler({ date: '2026-11-03', periodId: 'default', locale: 'en-US', entry: 'toolbar' })).resolves.toMatchObject({ editions: 1, allDone: true })
    expect(deletePeriod).toHaveBeenCalledWith({ date: '2026-11-03', periodId: 'default', locale: 'en-US', entry: 'toolbar' })
    await expect(handler({ date: '2026-11-03', periodId: 'default', locale: 'en-US' })).rejects.toThrow('daily-briefing-invalid-request')
  })

  it('refuses a payload that could delete another issue', async () => {
    const deletePeriod = vi.fn()
    const handler = registerAll(deletePeriod as never).get('intelligence.dailyBriefing.deletePeriod')!
    // Every field is required: a missing period or language would delete another edition's rows.
    await expect(handler({ date: '2026-11-03' })).rejects.toThrow('daily-briefing-invalid-request')
    await expect(handler({ periodId: 'default' })).rejects.toThrow('daily-briefing-invalid-request')
    await expect(handler({ date: '2026-13-40', periodId: 'default', locale: 'zh-CN' })).rejects.toThrow('daily-briefing-invalid-request')
    await expect(handler({ date: '2026-11-03', periodId: '   ', locale: 'zh-CN' })).rejects.toThrow('daily-briefing-invalid-request')
    await expect(handler({ date: '2026-11-03', periodId: 'default' })).rejects.toThrow('daily-briefing-invalid-request')
    await expect(handler({ date: '2026-11-03', periodId: 'default', locale: 'fr-FR' })).rejects.toThrow('daily-briefing-invalid-request')
    expect(deletePeriod).not.toHaveBeenCalled()
  })
})

describe('the publish-to-phone payload carries the edition identity, and nothing else', () => {
  // 用户 2026-11-07 报「点发布频道发不出去」：这一层曾把推送交给删除的校验，而删除还要求一个
  // `entry`（从哪点的），于是每一次推送都判 `daily-briefing-invalid-request`，请求到不了通道。
  const handlersWithPush = (publishToPhone: (input: unknown) => Promise<unknown>) => {
    const handlers = new Map<string, (payload: unknown) => Promise<unknown>>()
    registerDailyBriefingIpc(((_product: string, method: string, handler: (payload: unknown) => Promise<unknown>) => {
      handlers.set(method, handler)
    }) as never, { ...(service as unknown as Record<string, unknown>), publishToPhone } as never, undefined, undefined)
    return handlers
  }

  it('accepts exactly { date, periodId, locale } — the request the renderer sends has no entry field', async () => {
    const publishToPhone = vi.fn(async () => ({ state: 'sent' }))
    const handler = handlersWithPush(publishToPhone).get(DAILY_BRIEFING_IPC_METHODS.publishToPhone)!
    const payload = { date: '2026-11-07', periodId: 'period_18ce8fe5-781d-490a-a5e4-689390f1e6cf', locale: 'en-US' }

    await expect(handler(payload)).resolves.toEqual({ state: 'sent' })
    expect(publishToPhone).toHaveBeenCalledWith(payload)
  })

  it('still refuses a push request with a missing or invalid identity field', async () => {
    const publishToPhone = vi.fn(async () => ({ state: 'sent' }))
    const handler = handlersWithPush(publishToPhone).get(DAILY_BRIEFING_IPC_METHODS.publishToPhone)!
    for (const payload of [
      { periodId: 'default', locale: 'zh-CN' },
      { date: '2026-11-07', locale: 'zh-CN' },
      { date: '2026-11-07', periodId: '', locale: 'zh-CN' },
      { date: '2026-11-07', periodId: 'default', locale: 'fr-FR' }
    ]) {
      await expect(handler(payload)).rejects.toThrow('daily-briefing-invalid-request')
    }
    expect(publishToPhone).not.toHaveBeenCalled()
  })

  it('keeps the delete rule: no entry means refused, even without a push request involved', async () => {
    // 修推送不许顺手放松删除：`entry` 是删除的审计语义，缺了仍然拒。
    const deletePeriod = vi.fn(async () => ({ editions: 1, attempts: 0, periodRuns: 0, sessionLinks: 0, allDone: true }))
    const handler = registerAll(deletePeriod as never).get('intelligence.dailyBriefing.deletePeriod')!
    await expect(handler({ date: '2026-11-07', periodId: 'default', locale: 'zh-CN' })).rejects.toThrow('daily-briefing-invalid-request')
    expect(deletePeriod).not.toHaveBeenCalled()
    await handler({ date: '2026-11-07', periodId: 'default', locale: 'zh-CN', entry: 'toolbar' })
    expect(deletePeriod).toHaveBeenCalledTimes(1)
  })
})

describe('the period write seam shares the runtime store', () => {
  it('a write on a fresh upgrade moves the old rows first and keeps the marker', async () => {
    const { mkdtemp, readFile, rm } = await import('node:fs/promises')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const { createBriefingPeriodsSource } = await import('../daily-briefing/dailyBriefingPeriodsSource')
    const dir = await mkdtemp(join(tmpdir(), 'briefing-ipc-move-'))
    try {
      const periodsPath = join(dir, 'daily-briefing-periods.json')
      const source = createBriefingPeriodsSource({
        filePath: periodsPath,
        locale: async () => 'zh-CN',
        legacyPeriodsMigration: {
          readLegacyPeriods: async () => [
            { id: 'default', generationTime: '07:00', windowHours: 24 },
            { id: 'evening', generationTime: '21:30', windowHours: 12 }
          ],
          additionalLanguages: async () => []
        }
      })
      const handlers = new Map<string, (payload: unknown) => Promise<unknown>>()
      registerDailyBriefingIpc((( _product: string, method: string, handler: (payload: unknown) => Promise<unknown>) => {
        handlers.set(method, handler)
      }) as never, service, undefined, undefined, source.editor)

      // No runtime read first: this is the settings page's first write on an upgraded install.
      const saved = await handlers.get(DAILY_BRIEFING_IPC_METHODS.updatePeriod)!({
        id: 'default',
        draft: { generationTime: '08:00', windowHours: 24, language: 'zh-CN' },
        locale: 'zh-CN'
      })

      expect(saved).toMatchObject({ state: 'saved' })
      const document = JSON.parse(await readFile(periodsPath, 'utf8')) as {
        periods: readonly { id: string; generationTime: string }[]
        markers?: Record<string, unknown>
      }
      // The old second period survives: the move ran before the write, not after it.
      expect(document.periods.map((period) => period.id)).toEqual(['default', 'evening'])
      expect(document.periods.map((period) => period.generationTime)).toEqual(['08:00', '21:30'])
      // A period file without the marker is the state that would skip the move forever.
      expect(typeof document.markers?.['migrated.legacyGlobalSettings.v1']).toBe('string')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
