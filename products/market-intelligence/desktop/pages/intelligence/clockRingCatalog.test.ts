import { describe, expect, it } from 'vitest'

import { metricConceptOf } from '../../../contracts/metricKeyConcept'
import { marketCalendarCodeTable } from '../../../service/intelligence/macro-calendar/marketCalendarCodeTable'
import { clockCategoryOf, clockRingCategories } from './clockRingCategories'
import { clockRingConcepts, clockRingNameKeys } from './clockScheduleMetrics'
import { clockCardText } from './clockCardText'

/**
 * 环上清单的守卫（Chief 2026-11-21）：
 * ① 清单必须**等于**码表 `tier=1 && status=active` 的全部概念——以后加一级指标，环不会静默漏掉；
 * ② 代表优先级的每个概念都必须是这些一级码之一；
 * ③ 牌名与码表的中英短名逐字一致，两处不许各写一份。
 */
const tier1Active = Object.freeze(Object.entries(marketCalendarCodeTable)
  .filter(([, row]) => row.tier === 1 && row.status === 'active')
  .map(([code]) => ({ code, concept: metricConceptOf(code) })))

describe('the ring catalogue follows the code table', () => {
  it('covers exactly the tier-1 active concepts', () => {
    expect(clockRingConcepts.map((entry) => entry.concept).sort())
      .toEqual(tier1Active.map((entry) => entry.concept).sort())
    // 每个概念都登记了牌名键：新增一级码必须补登记的判据。
    for (const entry of tier1Active) expect(clockRingNameKeys[entry.concept]).toBeDefined()
  })

  /**
   * 每个一级概念都必须归到**四个大类之一**（用户 2026-11：环上只挂四类箭头）。
   * 新增一级码没有登记大类 → `clockCategoryOf` 抛错，这条就红——不会静默挤进某一类。
   */
  it('puts every tier-1 concept into exactly one of the four categories', () => {
    for (const { concept } of tier1Active) {
      expect(clockRingCategories, `${concept} 必须归到四类之一`).toContain(clockCategoryOf(concept))
    }
    expect(() => clockCategoryOf('US.NOT.A.CODE')).toThrow(/没有登记大类/u)
  })

  it('takes the ring names verbatim from the code table, in both languages', () => {
    for (const { code, concept } of tier1Active) {
      const row = marketCalendarCodeTable[code]!
      const nameKey = clockRingNameKeys[concept]!
      expect(clockCardText['zh-CN'].names[nameKey as keyof typeof clockCardText['zh-CN']['names']], `${concept} 中文名`)
        .toBe(row.names.zhShort)
      expect(clockCardText['en-US'].names[nameKey as keyof typeof clockCardText['en-US']['names']], `${concept} 英文名`)
        .toBe(row.names.enShort)
    }
  })

})
