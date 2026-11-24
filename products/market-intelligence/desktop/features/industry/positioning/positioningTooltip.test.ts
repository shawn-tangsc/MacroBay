import { describe, expect, it } from 'vitest'

import { tooltipLeft } from '../../../shared/chart/tooltipPlacement'
import { POSITIONING_TOOLTIP, placePositioningTooltip } from './positioningTooltip'

/**
 * 浮层横向只有一个主人：`shared/chart/tooltipPlacement`。
 *
 * 这些用例证明的是**接线**，不是把边界值再抄一遍：同一组 `x` 分别过这张图的
 * `placePositioningTooltip` 和共享的 `tooltipLeft`，结果必须逐个相等。边界值（`FIT` 那几个点）
 * 由共享函数回答——它改了口径这里自动跟上；哪天有人把本地那份翻边/clamp 写回来，等式某一行就红。
 *
 * 数字全部由 `POSITIONING_TOOLTIP` 派生，不抄别的卡的 210/176 那类值。
 */
const BOX = 1000
const FIT = POSITIONING_TOOLTIP.offset + POSITIONING_TOOLTIP.width + POSITIONING_TOOLTIP.inset

const sharedLeft = (x: number, boxWidth: number): number => tooltipLeft({
  x,
  boxWidth,
  width: POSITIONING_TOOLTIP.width,
  offset: POSITIONING_TOOLTIP.offset,
  inset: POSITIONING_TOOLTIP.inset
})

const leftAt = (x: number, boxWidth = BOX): number => placePositioningTooltip({ x, y: 200, boxWidth, boxHeight: 400 }).left

describe('positioning tooltip horizontal placement', () => {
  it('is wired to the shared rule at every regime, including both sides of the equality point', () => {
    // 最后一组是「两边都放不下」的兜底：本地手抄的那份在这里会给出 `inset`，
    // 共享规则先取剩余更宽的一侧——等式那一行就是那时候红的。
    const cases = [
      [0, BOX],
      [1, BOX],
      [100, BOX],
      [BOX - FIT - 1, BOX],
      [BOX - FIT, BOX],
      [BOX - FIT + 1, BOX],
      [700, BOX],
      [BOX, BOX],
      [200, 400]
    ] as const
    for (const [x, boxWidth] of cases) {
      expect(leftAt(x, boxWidth), `x=${x} W=${boxWidth}`).toBe(sharedLeft(x, boxWidth))
    }
  })

  it('still sits on the right at x = boxWidth − FIT: equality belongs to the right side', () => {
    const x = BOX - FIT
    const left = leftAt(x)
    expect(left).toBeGreaterThan(x)
    // 右缘正好落在安全距上，再多一个单位就翻。
    expect(left + POSITIONING_TOOLTIP.width).toBe(BOX - POSITIONING_TOOLTIP.inset)
  })

  it('flips to the left of the cursor on the rightmost reading instead of covering the column being read', () => {
    const x = BOX - 10
    const left = leftAt(x)
    // 整块落在光标左侧，被读的那一列还看得见；同时不越左安全距、不越右安全距。
    expect(left + POSITIONING_TOOLTIP.width).toBeLessThanOrEqual(x)
    expect(left).toBeGreaterThanOrEqual(POSITIONING_TOOLTIP.inset)
    expect(left + POSITIONING_TOOLTIP.width).toBeLessThanOrEqual(BOX - POSITIONING_TOOLTIP.inset)
  })

  it('takes the shared fallback on a box too narrow for either side', () => {
    const boxWidth = 400
    const x = 200
    const left = leftAt(x, boxWidth)
    expect(left).toBe(sharedLeft(x, boxWidth))
    expect(left).toBeGreaterThanOrEqual(POSITIONING_TOOLTIP.inset)
    expect(left + POSITIONING_TOOLTIP.width).toBeLessThanOrEqual(boxWidth - POSITIONING_TOOLTIP.inset)
  })

  it('keeps the vertical rule local: centred on the cursor, then clamped into the box', () => {
    // 纵向没有翻边语义，不进共享函数；这三条钉的是「留在本地的那一段」仍然对。
    const top = (y: number, boxHeight = 400): number => placePositioningTooltip({ x: 100, y, boxWidth: BOX, boxHeight }).top
    expect(top(200)).toBe(200 - POSITIONING_TOOLTIP.height / 2)
    expect(top(10)).toBe(POSITIONING_TOOLTIP.inset)
    expect(top(395)).toBe(400 - POSITIONING_TOOLTIP.height - POSITIONING_TOOLTIP.inset)
  })
})