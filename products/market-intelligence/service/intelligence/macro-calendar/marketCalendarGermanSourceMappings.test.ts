import { describe, expect, it } from 'vitest'

import { calendarNamesFor } from './marketCalendarCodeNames'
import { germanSourceMetricMappings, germanTierByMetricKey } from './marketCalendarGermanSourceMappings'
import { tierOfMetricKey } from './marketCalendarMetricTiers'

/**
 * 德国码空间按来源分开（用户 2026-11-17）：码、四列名、展示开关分级各在本来源的文件里。
 *
 * 三条判据，都冲着「静默失败」：
 * 1. **德国码里 `tier` 非空的集合恰好等于那 7 个**——少一条是漏写，多一条是有人顺手给了分级；
 * 2. **每个德国码都要能取到四列名**，取不到就是名表没登记，界面会退回显示码；
 * 3. **一个都不进一级**（一级是简报必须项，只给美国核心指标划线）。
 */
const TIERED = Object.freeze([
  'DE.CPI.NSA.YOY',
  'DE.HICP.NSA.YOY',
  'DE.GDP.SA.QOQ',
  'DE.UNEMPLOYMENT.SA.RATE',
  'DE.IFO_BUSINESS_CLIMATE.NONE.LEVEL',
  'DE.ZEW_ECONOMIC_SENTIMENT.NONE.LEVEL',
  'DE.SP_MANUFACTURING_PMI.SA.LEVEL'
])

describe('德国码空间', () => {
  it('每个德国码都能取到四列名（取不到就是名表没登记）', () => {
    const codes = [...new Set(Object.values(germanSourceMetricMappings).map((entry) => entry.metricKey))]
    expect(codes.length).toBeGreaterThan(30)
    for (const code of codes) {
      const names = calendarNamesFor(code)
      expect(names, code).toBeDefined()
      for (const field of ['zhFull', 'zhShort', 'enFull', 'enShort'] as const) {
        expect(names?.[field], `${code} 的 ${field}`).toBeTruthy()
      }
    }
  })

  it('分级表里恰好是那 7 个（多一个少一个都红）', () => {
    // 断言的是**分级表本身**，不是「已映射的码里有几个带分级」：锚点码可以先有分级、
    // 数据后到（德国制造业 PMI 初值今天还没进来），那种情况不该红——否则为了过门禁
    // 就得给终值硬套初值的码。
    expect(Object.keys(germanTierByMetricKey).sort()).toEqual([...TIERED].sort())
    // 一级是我们给美国核心指标划的线：德国一个都不许进。
    expect(Object.values(germanTierByMetricKey).every((tier) => tier === 2)).toBe(true)
  })

  it('已映射的码若带分级，必须是二级（不许有漏网的一级）', () => {
    const codes = [...new Set(Object.values(germanSourceMetricMappings).map((entry) => entry.metricKey))]
    for (const code of codes) {
      const tier = tierOfMetricKey(code)
      if (tier !== undefined) expect(tier, code).toBe(2)
    }
  })

  it('映射里没有残句派生的码（`day Tuner` / `transmutation` 这类不许进码空间）', () => {
    const codes = Object.values(germanSourceMetricMappings).map((entry) => entry.metricKey)
    expect(codes.some((code) => /DAY_TUNER|TRANSMUTATION|UNSEASONALLY/.test(code))).toBe(false)
  })
})
