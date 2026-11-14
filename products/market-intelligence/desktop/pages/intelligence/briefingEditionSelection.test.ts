import { describe, expect, it, vi } from 'vitest'

import { briefingEditionSelection, nextEditionAfterDelete } from './briefingEditionSelection'

/**
 * 删掉一版之后「下一版是谁」——只算**同一天**的邻居，不跨天。
 *
 * 今天这一条冲掉过两次：一次按日期取当天第一行（读者的选中项还指着被删的那一版，左侧不高亮、
 * 右列留痕落空），一次把被删那一行自己当邻居（列表删完仍会把它列成 `missing`）。所以这里把
 * 三种行钉住：正常的邻居、被删的那一行、删空的那一天。
 */
const row = (periodId: string, extra: Readonly<{ locale?: 'zh-CN' | 'en-US'; state?: string }> = {}) => ({
  date: '2026-11-05',
  periodId,
  locale: extra.locale ?? ('zh-CN' as const),
  ...(extra.state === undefined ? {} : { state: extra.state })
})

describe('nextEditionAfterDelete', () => {
  it('picks the next issue of the same day, then the previous one at the end', () => {
    const rows = [row('a'), row('b'), row('c')]
    expect(nextEditionAfterDelete(rows, '2026-11-05', { periodId: 'b', locale: 'zh-CN' }))
      .toMatchObject({ date: '2026-11-05', periodId: 'c', locale: 'zh-CN' })
    expect(nextEditionAfterDelete(rows, '2026-11-05', { periodId: 'c', locale: 'zh-CN' }))
      .toMatchObject({ periodId: 'b' })
  })

  it('never hands back the row that was deleted, even while the list still lists it', () => {
    // 列表把刚删掉的那一期仍标成 `missing`；它没有版次可读，不能当自己的邻居。
    const rows = [row('a'), row('b', { state: 'missing' })]
    expect(nextEditionAfterDelete(rows, '2026-11-05', { periodId: 'b', locale: 'zh-CN' }))
      .toMatchObject({ periodId: 'a' })
  })

  it('returns nothing when the day has no issue left — the caller decides where the reader lands', () => {
    const rows = [row('a', { state: 'missing' })]
    expect(nextEditionAfterDelete(rows, '2026-11-05', { periodId: 'a', locale: 'zh-CN' })).toBeUndefined()
  })

  it('keeps languages apart: the same period in another language is a different row', () => {
    const rows = [row('a', { locale: 'zh-CN' }), row('a', { locale: 'en-US' })]
    expect(nextEditionAfterDelete(rows, '2026-11-05', { periodId: 'a', locale: 'zh-CN' }))
      .toMatchObject({ periodId: 'a', locale: 'en-US' })
  })
})

// 用户 2026-11-14：点一下语言徽标就落进「这一期没有这一版」，连读取都不发。
// 判据：徽标上的期次与投影里的期次不一致时，仍要用**那一天、那一语言确实发布过**的那一行去读。
describe('the language badge still opens the edition that exists', () => {
  it('passes the published row for that day when the badge carries a stale period id', () => {
    const openEdition = vi.fn()
    const selection = briefingEditionSelection({
      editions: [{
        date: '2026-11-14', periodId: 'period_real', locale: 'zh-CN', availableLocales: ['zh-CN'],
        languages: [{ locale: 'zh-CN', state: 'published' }]
      } as never],
      effectiveLocale: () => 'zh-CN',
      setPickedLocale: () => undefined,
      setPickedPeriodId: () => undefined,
      openEdition
    } as never)

    selection.selectLocale({ date: '2026-11-14', periodId: 'period_stale', locale: 'zh-CN' })

    expect(openEdition).toHaveBeenCalledTimes(1)
    const [, , row, periodId] = openEdition.mock.calls[0]!
    expect(row).toMatchObject({ periodId: 'period_real' })
    expect(periodId).toBe('period_real')
  })
})
