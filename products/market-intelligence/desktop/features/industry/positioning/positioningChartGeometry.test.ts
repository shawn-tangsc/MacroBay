import { describe, expect, it } from 'vitest'

import { POSITIONING_CHART_VIEW } from './positioningLiquidationMarkers'

/**
 * 图高是**宽度驱动**的：`svg { width:100%; height:auto }` + `viewBox 1000×240`，
 * 所以 图高 = 列宽 × 240/1000。仓库里量不了排版，这里钉的就是这两个数之间的关系——
 * 它决定了读者在 pad 上看到的图有多高。
 *
 * 用户 2026-11-24 定的档：1020 视口下图列约 698（内容 980 − 左列 264 − 间距 18），
 * 199 那版给 139px（两条车道各四十来像素，读者报「图那么小」），240 给 168px。
 */
describe('the drawing proportions', () => {
  it('keeps a pad-width drawing at ~168px instead of the 139px a 199 tall canvas gave', () => {
    const cardColumn = 698
    const drawn = (column: number): number => column * POSITIONING_CHART_VIEW.height / POSITIONING_CHART_VIEW.width
    expect(POSITIONING_CHART_VIEW.height).toBe(240)
    expect(Math.round(drawn(cardColumn))).toBe(168)
  })

  it('stacks marker band, two lanes and the tick band in one order, with the chip band at 26', () => {
    const view = POSITIONING_CHART_VIEW
    expect(view.markerTop).toBeLessThan(view.markerRow)
    expect(view.markerRow).toBeLessThan(view.upperTop)
    expect(view.upperTop).toBeLessThan(view.upperBottom)
    expect(view.upperBottom).toBeLessThan(view.zero)
    expect(view.zero).toBeLessThan(view.height)
    // 牌带 = 两排 13 高的牌，牌底正好落在 `markerRow`；牌高没跟着画布一起放大。
    expect(view.markerRow - view.markerTop).toBe(26)
  })
})