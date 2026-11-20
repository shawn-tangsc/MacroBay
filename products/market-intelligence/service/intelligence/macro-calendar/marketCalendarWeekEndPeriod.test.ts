import { describe, expect, it } from 'vitest'

import { zeroXRouterCanonicalIdentity } from './marketCalendarMetricIdentity'

/**
 * 周度期次：**标题带「至MMDD」时用源给的截止日**，其余一律退回按发布日推的上一周末
 * （Chief 2026-11-18）。最要紧的一条是「美国既有周度期次逐条不变」——它们标题没有这种端点。
 */
const base = { countryCode: 'JP', indicatorId: '4263', scheduledAt: '2026-10-02T06:00:00.000Z' }
const periodOf = (over: Readonly<Record<string, unknown>>) =>
  zeroXRouterCanonicalIdentity({ ...base, ...over } as never)?.periodKey

describe('周度期次：标题「至MMDD」优先', () => {
  it('标题带（至0925）→ 用它当周度期次', () => {
    expect(periodOf({ title: '上周买进外国债券(十亿日元)（至0925）' })).toBe('2026-09-25')
  })

  it('标题不带端点 → 与改前一致（按发布日推的上一周六）', () => {
    expect(periodOf({ title: '上周买进外国债券(十亿日元)' })).toBe('2026-09-26')
    expect(periodOf({ title: undefined })).toBe('2026-09-26')
  })

  it('跨年：1 月初发布、「至1228」→ 落在上一年', () => {
    expect(periodOf({ scheduledAt: '2027-01-04T06:00:00.000Z', title: 'x（至1228）' })).toBe('2026-12-28')
  })

  it('美国既有周度（初请/EIA/MBA）期次不变：标题无端点就是退回原算法', () => {
    expect(periodOf({ countryCode: 'US', indicatorId: '8659',
      scheduledAt: '2026-10-02T12:30:00.000Z', title: 'Initial Jobless Claims' })).toBe('2026-09-26')
    expect(periodOf({ countryCode: 'US', indicatorId: '9424',
      scheduledAt: '2026-10-07T14:30:00.000Z', title: 'EIA Crude Oil Inventories' })).toBe('2026-10-03')
  })

  it('不可靠端点（年末发布「至0105」）→ 退回原算法，不猜', () => {
    expect(periodOf({ scheduledAt: '2026-12-31T06:00:00.000Z', title: 'x（至0105）' })).toBe('2026-12-26')
  })
})
