import { describe, expect, it } from 'vitest'

import { nextEditionAfterDelete } from './briefingEditionSelection'

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
