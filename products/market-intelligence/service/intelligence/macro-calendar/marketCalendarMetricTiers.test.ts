import { describe, expect, it } from 'vitest'

import { marketCalendarReleaseGroupByMetricKey as groupOf } from './marketCalendarReleaseGroups'
import { marketCalendarTier1MetricKeys, marketCalendarTierByMetricKey, tierOfMetricKey }
  from './marketCalendarMetricTiers'

/**
 * 分级常量是**从 19 号表落成的**，这里守三件：
 * 1. 数量与表一致（一级 12、二级 31；表里 `4` 是未分级，不写进常量）；
 * 2. 每个分级码都必须是组表里存在的码——分级不能给一个不存在的码；
 * 3. 未分级返回 `undefined`，**不返回 4**（缺席不等于第四档）。
 */
describe('指标分级常量', () => {
  it('一级 12 / 二级 31，三级 0（本期不采集，不是漏标）', () => {
    const tiers = Object.values(marketCalendarTierByMetricKey)
    expect(tiers.filter((tier) => tier === 1)).toHaveLength(12)
    expect(tiers.filter((tier) => tier === 2)).toHaveLength(31)
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

  /**
   * 两个未季调 PCE 变体（架构师 2026-11-14 定）：**码与组都保留，但降为未分级**。
   *
   * 理由不是「它们不重要」：同一个概念的影响程度完全一样；问题是**同一个概念已经有季调那条在卡上**，
   * 未季调这条今天没有源，两条并列会让日历出现两条 PCE 年率。降级只影响「露不露名字」，
   * 它们仍在组表里、仍会进格子里的数字。
   *
   * 这条能红的真情况：有人把它们加回一级（日历又并列两条），或干脆把码删了（历史行的身份没了）。
   */
  it('keeps the two unseasoned PCE variants: present in the group table, but not tiered', () => {
    const variants = ['US.PCE.NSA.YOY', 'US.CORE_PCE.NSA.YOY'] as const
    for (const code of variants) {
      expect(groupOf[code], `${code} 必须还在组表里`).toBe('us-pce')
      expect(tierOfMetricKey(code), `${code} 不许再是一级`).toBeUndefined()
      expect(marketCalendarTier1MetricKeys as readonly string[]).not.toContain(code)
    }
  })
})
