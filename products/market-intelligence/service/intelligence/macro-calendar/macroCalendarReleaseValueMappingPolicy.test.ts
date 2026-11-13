import { describe, expect, it } from 'vitest'

import { nameByMetricKey } from './marketCalendarCodeNames'
import { macroCalendarReleaseValueMappings, metricKeySuffixFor }
  from './macroCalendarReleaseValueMappingPolicy'

/**
 * 官方发布 → 标准码这八行，**码是从单位与口径机械推出来的**，不是手工拍的。
 * 这条守卫挡的是「码写 YOY、单位写 monthly」这类照抄错——它不会报错，只会让官方值与码对不上。
 */
describe('官方发布映射：码必须与单位/口径一致', () => {
  it('每行的码尾都能由 unit + adjustment 推出', () => {
    expect(macroCalendarReleaseValueMappings).toHaveLength(8)
    for (const mapping of macroCalendarReleaseValueMappings) {
      const suffix = metricKeySuffixFor(mapping)
      expect(suffix, `${mapping.event} 的单位/口径认不出`).toBeDefined()
      expect(mapping.metricKey.endsWith(suffix!), `${mapping.event}：${mapping.metricKey} vs ${suffix}`).toBe(true)
    }
  })

  it('八个事件各一条，且码互不相同', () => {
    expect(new Set(macroCalendarReleaseValueMappings.map((row) => row.event)).size).toBe(8)
    expect(new Set(macroCalendarReleaseValueMappings.map((row) => row.metricKey)).size).toBe(8)
  })

  /**
   * 名字缺失的码**不硬写进标准表**（会被当未知码退回工作清单，读者就看不见了），
   * 这时官方行退回源内身份。这条把这些码列出来：名称补上之后要从这里删掉，
   * 否则「它还没有名字」这个前提就过期了。
   */
  const officialCodesAwaitingName: string[] = []   // 2026-11-14：GDP 的名字补齐后清单清空
  it('官方码都有名字；未补名的必须在名单里，且名单会自查', () => {
    const missing = macroCalendarReleaseValueMappings
      .filter((row) => nameByMetricKey[row.metricKey] === undefined)
      .map((row) => row.metricKey)
    expect(missing.sort()).toEqual([...officialCodesAwaitingName].sort())
  })
})
