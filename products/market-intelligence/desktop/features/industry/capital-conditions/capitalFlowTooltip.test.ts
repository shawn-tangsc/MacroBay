import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { tooltipLeft } from '../../../shared/chart/tooltipPlacement'
import { FLOW_TOOLTIP, placeFlowTooltip } from './capitalFlowTooltip'

/**
 * 浮层横向只有一个主人：`shared/chart/tooltipPlacement`。
 *
 * 这些用例证明的是**接线**，不是把边界值再抄一遍：同一组 `x` 分别过图上的 `placeFlowTooltip`
 * 和共享的 `tooltipLeft`，结果必须逐个相等。边界值（`FIT` 那几个点）由共享函数回答——它改了口径，
 * 这里自动跟上；哪天有人在本文件旁边又写一条 clamp，等式的某一行就会红。
 *
 * 三个档各有一条**行为**判据，数字全部由 `FLOW_TOOLTIP` 派生，不写 210 那类别的卡的值：
 * 右侧放得下 → 不翻；最右一天 → 翻到左边且右缘不越内边距；窄卡 → 走共享函数兜底。
 */
const BOX = 800
const FIT = FLOW_TOOLTIP.offset + FLOW_TOOLTIP.estimatedWidth + FLOW_TOOLTIP.inset

const sharedLeft = (x: number, boxWidth: number): number => tooltipLeft({
  x,
  boxWidth,
  width: FLOW_TOOLTIP.estimatedWidth,
  offset: FLOW_TOOLTIP.offset,
  inset: FLOW_TOOLTIP.inset
})

const leftAt = (x: number, boxWidth = BOX): number => placeFlowTooltip({ x, y: 200, boxWidth, boxHeight: 400 }).tooltipLeft

describe('flow tooltip horizontal placement', () => {
  it('is wired to the shared rule at every regime, including both sides of the equality point', () => {
    const xs = [0, 1, 100, BOX - FIT - 1, BOX - FIT, BOX - FIT + 1, 700, BOX]
    for (const x of xs) expect(leftAt(x)).toBe(sharedLeft(x, BOX))
  })

  it('flips to the left of the cursor on the rightmost day instead of covering the column being read', () => {
    const x = BOX - 10
    const left = leftAt(x)
    // 整块落在光标左侧：右缘不越过光标，那一列还看得见。旧的「夹到右内边距」在这里正好把光标盖住。
    expect(left + FLOW_TOOLTIP.estimatedWidth).toBeLessThanOrEqual(x)
    expect(left).toBeGreaterThanOrEqual(FLOW_TOOLTIP.inset)
    expect(left + FLOW_TOOLTIP.estimatedWidth).toBeLessThanOrEqual(BOX - FLOW_TOOLTIP.inset)
  })

  it('still sits on the right at x = boxWidth − FIT: equality belongs to the right side', () => {
    const x = BOX - FIT
    const left = leftAt(x)
    expect(left).toBeGreaterThan(x)
    expect(left + FLOW_TOOLTIP.estimatedWidth).toBe(BOX - FLOW_TOOLTIP.inset)
  })

  it('takes the shared fallback on a box too narrow for both sides, without a second rule', () => {
    // 兜底那一档只在 boxWidth < 2·FIT 时出现；x 取在「右侧放不下、左侧也放不下」的那段中间。
    const boxWidth = 300
    const x = 160
    const left = leftAt(x, boxWidth)
    expect(left).toBe(sharedLeft(x, boxWidth))
    expect(left).toBeGreaterThanOrEqual(FLOW_TOOLTIP.inset)
    expect(left + FLOW_TOOLTIP.estimatedWidth).toBeLessThanOrEqual(boxWidth - FLOW_TOOLTIP.inset)
  })

  it('keeps the vertical half local: above the cursor when it fits, below it when there is no room above', () => {
    expect(placeFlowTooltip({ x: 100, y: 300, boxWidth: BOX, boxHeight: 400 }).tooltipTop)
      .toBe(300 - FLOW_TOOLTIP.estimatedHeight - FLOW_TOOLTIP.offset)
    expect(placeFlowTooltip({ x: 100, y: 20, boxWidth: BOX, boxHeight: 400 }).tooltipTop)
      .toBe(20 + FLOW_TOOLTIP.offset)
  })

  it('keeps the estimated width equal to the stylesheet token the tooltip actually uses', () => {
    const css = readFileSync(resolve(process.cwd(), 'products/market-intelligence/desktop/pages/intelligence/cryptoDashboard.css'), 'utf8')
    expect(css).toContain('.mi-capital-conditions__chart-tooltip {')
    expect(css).toContain('width: var(--mi-dashboard-etf-flow-tooltip-width)')
    const declared = css.match(/--mi-dashboard-etf-flow-tooltip-width:\s*([\d.]+)px/)
    expect(Number.parseFloat(declared?.[1] ?? '')).toBe(FLOW_TOOLTIP.estimatedWidth)
  })
})