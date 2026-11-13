import { describe, expect, it } from 'vitest'

import { MACRO_INDICATOR_CARD_KEYS } from './macroIndicatorCardFacts'
import { MACRO_INDICATOR_GROUPS, MACRO_INDICATOR_GROUP_METRIC_KEYS } from './macroIndicatorCardGroups'

/**
 * 分组表是「3 类 × 4 行」的唯一出处：卡片的行序、设置页的分组、左侧「3 类 / 12 项指标」
 * 的计数都从它派生。它一旦和 12 个码的清单对不上，两个界面会各显示各的数量。
 */
describe('MACRO_INDICATOR_GROUPS', () => {
  it('covers exactly the twelve card keys, each once', () => {
    expect(MACRO_INDICATOR_GROUPS).toHaveLength(3)
    for (const group of MACRO_INDICATOR_GROUPS) expect(group.rows).toHaveLength(4)
    expect([...MACRO_INDICATOR_GROUP_METRIC_KEYS].sort()).toEqual([...MACRO_INDICATOR_CARD_KEYS].sort())
  })

  it('keeps the on-screen row order (CPI 年率 → 月率 → 核心年率 → 核心月率)', () => {
    expect(MACRO_INDICATOR_GROUPS[0]?.rows.map((row) => row.metricKey)).toEqual([
      'US.CPI.NSA.YOY', 'US.CPI.SA.MOM', 'US.CORE_CPI.NSA.YOY', 'US.CORE_CPI.SA.MOM'
    ])
  })
})
