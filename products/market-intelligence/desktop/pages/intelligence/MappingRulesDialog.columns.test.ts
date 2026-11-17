import { describe, expect, it } from 'vitest'

import { CODE_TABLE_COLUMN_WIDTHS } from './MappingRulesDialog'

/**
 * 码表「九列同屏、不横向滚动」的**预算**（前端组件复核 2026-11-17 指出的口径问题）。
 *
 * 弹框 `full` 档写的是 1280，但 antd 给弹框的是 `max-width: calc(100vw - 32px)`：
 * **窗口 1280 时真实可用只有 1248**，要真吃到 1280 得窗口 ≥1312。上一版验收条件写成
 * 「窗口 ≥1280 不横滚」，测的其实是 1248——所以这里把最紧的那一档（1248）当判据。
 *
 * 算式：九列宽 + 9 格 × 左右各 8 的内距，必须 ≤ 1248 − 弹框左右内距 48 − 纵向滚动条 16。
 * 表格在 `.mi-catalog__table` 里自己滚（`overflow: auto`），超了就是横向滚动条，所以这个和是硬约束。
 */
const MODAL_USABLE_AT_WINDOW_1280 = 1248
const MODAL_BODY_PADDING_X = 24
const SCROLLBAR = 16
const CELL_PADDING_X = 8

describe('the code table fits nine columns without horizontal scrolling', () => {
  it('fits at the real usable width of a 1280 window (1248), not just at 1280', () => {
    const columns = Object.values(CODE_TABLE_COLUMN_WIDTHS)
    expect(columns, '码表应当是九列').toHaveLength(9)
    const widths = columns.reduce((sum, width) => sum + width, 0)
    const cells = CELL_PADDING_X * 2 * columns.length
    const budget = MODAL_USABLE_AT_WINDOW_1280 - MODAL_BODY_PADDING_X * 2 - SCROLLBAR
    expect(widths + cells, `九列 ${widths} + 内距 ${cells} 超过了 1248 下的可用宽度 ${budget}`)
      .toBeLessThanOrEqual(budget)
  })

  it('leaves at least 40px of headroom, so a font or padding change does not break it', () => {
    const widths = Object.values(CODE_TABLE_COLUMN_WIDTHS).reduce((sum, width) => sum + width, 0)
    const cells = CELL_PADDING_X * 2 * Object.keys(CODE_TABLE_COLUMN_WIDTHS).length
    const budget = MODAL_USABLE_AT_WINDOW_1280 - MODAL_BODY_PADDING_X * 2 - SCROLLBAR
    expect(budget - (widths + cells)).toBeGreaterThanOrEqual(40)
  })
})
