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
  it('lists periods and forwards the reader language for the never-configured fallback', async () => {
    const invoke = stub((method) => {
      expect(method).toBe('intelligence.dailyBriefing.listPeriods')
      return [period]
    })
    expect(await dailyBriefingPeriodClient.list('en-US')).toEqual([period])
    expect(invoke.mock.calls[0]?.[2]).toEqual({ locale: 'en-US' })
    // No language known: the payload is empty, not a made-up zh-CN.
    await dailyBriefingPeriodClient.list()
    expect(invoke.mock.calls[1]?.[2]).toEqual({})
  })

  it('creates with the draft, and refuses a period shape this build cannot run', async () => {
    stub(() => ({ state: 'saved', period, periods: [period] }))
    await expect(dailyBriefingPeriodClient.create({ generationTime: '07:00', windowHours: 24, language: 'zh-CN' }))
      .resolves.toMatchObject({ state: 'saved', period: { id: 'default' } })

    stub(() => [{ ...period, generationTime: '07:15' }])
    await expect(dailyBriefingPeriodClient.list()).rejects.toThrow('daily-briefing-period-invalid-result')
  })

  it('returns the conflicting row, so the dialog can name it', async () => {
    stub(() => ({ state: 'rejected', code: 'daily-briefing-period-duplicate', conflict: period }))
    await expect(dailyBriefingPeriodClient.create({ generationTime: '07:00', windowHours: 24, language: 'zh-CN' }))
      .resolves.toEqual({ state: 'rejected', code: 'daily-briefing-period-duplicate', conflict: period })
  })

  it('sends the id on update and remove, and refuses a half-parsed answer', async () => {
    const invoke = stub((method) => method === 'intelligence.dailyBriefing.removePeriod'
      ? { state: 'removed', id: 'period_new', periods: [period] }
      : { state: 'saved', period: { ...period, id: 'period_new' }, periods: [period] })
    await expect(dailyBriefingPeriodClient.update('period_new', { generationTime: '08:00', windowHours: 48, language: 'en-US' }))
      .resolves.toMatchObject({ state: 'saved', period: { id: 'period_new' } })
    expect(invoke.mock.calls[0]?.[2]).toEqual({ id: 'period_new', draft: { generationTime: '08:00', windowHours: 48, language: 'en-US' } })
    await expect(dailyBriefingPeriodClient.remove('period_new')).resolves.toMatchObject({ state: 'removed', periods: [{ id: 'default' }] })
    expect(invoke.mock.calls[1]?.[2]).toEqual({ id: 'period_new' })

    stub(() => ({ state: 'removed', id: 'period_new' }))
    await expect(dailyBriefingPeriodClient.remove('period_new')).rejects.toThrow('daily-briefing-period-invalid-result')
  })
})
