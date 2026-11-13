import { describe, expect, it } from 'vitest'

import { marketCalendarReleaseGroupByMetricKey as groupOf } from './marketCalendarReleaseGroups'
import { marketCalendarTier1MetricKeys, marketCalendarTierByMetricKey, tierOfMetricKey }
  from './marketCalendarMetricTiers'

/**
 * 分级常量是**从 19 号表落成的**，这里守三件：
 * 1. 数量与表一致（一级 12、二级 29；表里 `4` 是未分级，不写进常量）；
 * 2. 每个分级码都必须是组表里存在的码——分级不能给一个不存在的码；
 * 3. 未分级返回 `undefined`，**不返回 4**（缺席不等于第四档）。
 */
describe('指标分级常量', () => {
  it('一级 12 / 二级 29，三级 0（本期不采集，不是漏标）', () => {
    const tiers = Object.values(marketCalendarTierByMetricKey)
    expect(tiers.filter((tier) => tier === 1)).toHaveLength(12)
    expect(tiers.filter((tier) => tier === 2)).toHaveLength(29)
    expect(tiers.filter((tier) => tier === 3)).toHaveLength(0)
  })

  it('分级只标在组表里存在的码上', () => {
    for (const code of Object.keys(marketCalendarTierByMetricKey)) {
      expect(groupOf[code], `${code} 不在组表里`).toBeDefined()
    }
  })

  it('未分级返回 undefined，不返回 4；一级清单与分级一致', () => {
    expect(tierOfMetricKey('US.PPI.NSA.YOY')).toBeUndefined()
    expect(tierOfMetricKey('US.CPI.NSA.YOY')).toBe(1)
    expect(new Set(marketCalendarTier1MetricKeys).size).toBe(12)
    for (const code of marketCalendarTier1MetricKeys) expect(tierOfMetricKey(code)).toBe(1)
  })
})
