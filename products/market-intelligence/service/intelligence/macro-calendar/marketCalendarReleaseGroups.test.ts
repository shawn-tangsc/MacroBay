import { describe, expect, it } from 'vitest'

import { marketCalendarReleaseGroupByMetricKey as groupOf,
  marketCalendarReleaseGroupPrimary as primaryOf } from './marketCalendarReleaseGroups'

/** 数据常量守卫：一个码一个组；每个组恰好一个主测度且属于该组。 */
describe('发布组常量', () => {
  it('161 个码各有唯一组，组名是稳定英文标识', () => {
    expect(Object.keys(groupOf)).toHaveLength(161)
    for (const [metricKey, group] of Object.entries(groupOf)) {
      expect(metricKey.startsWith('US.'), metricKey).toBe(true)
      expect(group, metricKey).toMatch(/^us-[a-z0-9-]+$/)
    }
    expect(new Set(Object.values(groupOf)).size).toBe(56)
  })

  it('每个组一个主测度，且主测度属于该组', () => {
    expect(new Set(Object.keys(primaryOf))).toEqual(new Set(Object.values(groupOf)))
    for (const [group, metricKey] of Object.entries(primaryOf)) {
      expect(groupOf[metricKey], `${group} → ${metricKey}`).toBe(group)
    }
  })

  it('nowcast 与实质 GDP 不是一个组', () => {
    expect(groupOf['US.GDP_NOWCAST.SA.ANNUALIZED_QOQ']).not.toBe(groupOf['US.GDP.SA.ANNUALIZED_QOQ'])
  })
})
