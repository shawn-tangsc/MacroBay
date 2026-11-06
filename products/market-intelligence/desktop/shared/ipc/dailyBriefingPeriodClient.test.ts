// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'

import { dailyBriefingPeriodClient } from './dailyBriefingPeriodClient'

afterEach(() => vi.unstubAllGlobals())

const stub = (handler: (method: string, payload: unknown) => unknown) => {
  const invoke = vi.fn(async (_product: string, method: string, payload: unknown) => handler(method, payload))
  vi.stubGlobal('window', { platform: { products: { invoke } } })
  return invoke
}

const period = {
  id: 'default', generationTime: '07:00', windowHours: 24, language: 'zh-CN', origin: 'legacy-settings'
}

describe('the period client', () => {
  it('lists periods and always forwards the reader language', async () => {
    // 服务端每个方法都要求界面语言；漏传会在运行时抛 `daily-briefing-locale-required`，界面上只
    // 显示成"没读出来"。所以这里断言的是"载荷里一定有 locale"，而不是"没传就发空对象"。
    const invoke = stub((method) => {
      expect(method).toBe('intelligence.dailyBriefing.listPeriods')
      return [period]
    })
    expect(await dailyBriefingPeriodClient.list('en-US')).toEqual([period])
    expect(invoke.mock.calls[0]?.[2]).toEqual({ locale: 'en-US' })
    await dailyBriefingPeriodClient.list('zh-CN')
    expect(invoke.mock.calls[1]?.[2]).toEqual({ locale: 'zh-CN' })
  })

  it('creates with the draft, and refuses a period shape this build cannot run', async () => {
    stub(() => ({ state: 'saved', period, periods: [period] }))
    await expect(dailyBriefingPeriodClient.create({ generationTime: '07:00', windowHours: 24, language: 'zh-CN' }, 'zh-CN'))
      .resolves.toMatchObject({ state: 'saved', period: { id: 'default' } })

    stub(() => [{ ...period, generationTime: '07:15' }])
    await expect(dailyBriefingPeriodClient.list('zh-CN')).rejects.toThrow('daily-briefing-period-invalid-result')
  })

  it('returns the conflicting row, so the dialog can name it', async () => {
    stub(() => ({ state: 'rejected', code: 'daily-briefing-period-duplicate', conflict: period }))
    await expect(dailyBriefingPeriodClient.create({ generationTime: '07:00', windowHours: 24, language: 'zh-CN' }, 'zh-CN'))
      .resolves.toEqual({ state: 'rejected', code: 'daily-briefing-period-duplicate', conflict: period })
  })

  it('sends the id on update and remove, and refuses a half-parsed answer', async () => {
    const invoke = stub((method) => method === 'intelligence.dailyBriefing.removePeriod'
      ? { state: 'removed', id: 'period_new', periods: [period] }
      : { state: 'saved', period: { ...period, id: 'period_new' }, periods: [period] })
    await expect(dailyBriefingPeriodClient.update('period_new', { generationTime: '08:00', windowHours: 48, language: 'en-US' }, 'en-US'))
      .resolves.toMatchObject({ state: 'saved', period: { id: 'period_new' } })
    expect(invoke.mock.calls[0]?.[2]).toEqual({ id: 'period_new', draft: { generationTime: '08:00', windowHours: 48, language: 'en-US' }, locale: 'en-US' })
    await expect(dailyBriefingPeriodClient.remove('period_new', 'en-US')).resolves.toMatchObject({ state: 'removed', periods: [{ id: 'default' }] })
    expect(invoke.mock.calls[1]?.[2]).toEqual({ id: 'period_new', locale: 'en-US' })

    stub(() => ({ state: 'removed', id: 'period_new' }))
    await expect(dailyBriefingPeriodClient.remove('period_new', 'zh-CN')).rejects.toThrow('daily-briefing-period-invalid-result')
  })
})
