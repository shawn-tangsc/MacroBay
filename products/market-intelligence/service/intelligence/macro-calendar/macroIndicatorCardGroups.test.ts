import { describe, expect, it } from 'vitest'

import {
  MACRO_INDICATOR_CARD_KEYS,
  MACRO_INDICATOR_GROUPS
} from './macroIndicatorCardGroups'

/**
 * 分组表是「3 类 × 4 行」的唯一出处：卡片的行序、设置页的分组与「3 类 / 12 项指标」的计数、
 * 12 个码本身都从它派生。它一旦少一行，卡片与设置页会一起少一项——所以这里钉住**用户看得见的两个数**：
 * 12 项、每组 4 行。少一行，这两条先红。
 */
describe('MACRO_INDICATOR_GROUPS', () => {
  it('is the single source of the twelve card codes', () => {
    expect(MACRO_INDICATOR_GROUPS).toHaveLength(3)
    for (const group of MACRO_INDICATOR_GROUPS) expect(group.rows, group.id).toHaveLength(4)
    const flattened = MACRO_INDICATOR_GROUPS.flatMap((group) => group.rows.map((row) => row.metricKey))
    expect(MACRO_INDICATOR_CARD_KEYS).toEqual(flattened)
    expect(MACRO_INDICATOR_CARD_KEYS).toHaveLength(12)
  })

  it('keeps the on-screen row order (CPI 年率 → 月率 → 核心年率 → 核心月率)', () => {
    expect(MACRO_INDICATOR_GROUPS[0]?.rows.map((row) => row.metricKey)).toEqual([
      'US.CPI.NSA.YOY', 'US.CPI.SA.MOM', 'US.CORE_CPI.NSA.YOY', 'US.CORE_CPI.SA.MOM'
    ])
  })

  /**
   * 设置页的显示名跟着行走（`metricNameKey`）——这是 12 个码在设置页的唯一落点。
   * 两行共用一个名键，读者会看到两张同名卡；少一个名键，那一格渲染成空白标题。
   */
  it('gives every row its own settings display-name key', () => {
    const nameKeys = MACRO_INDICATOR_GROUPS.flatMap((group) => group.rows.map((row) => row.metricNameKey))
    expect(nameKeys).toHaveLength(12)
    expect(nameKeys.every((key) => key.length > 0)).toBe(true)
    expect(new Set(nameKeys).size).toBe(12)
  })
})