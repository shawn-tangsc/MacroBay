import { describe, expect, it } from 'vitest'

import { positioningChartGeometry } from './positioningLiquidationMarkers'

/**
 * 图现在按**容器像素**画（用户 2026-11-24）：量到的宽高就是坐标系，字号 9px 就是 9px。
 *
 * 旧写法是一块固定 1000×300 的坐标系整幅缩放：图列 700 时缩放 0.7，牌字只剩 6.3px，
 * 靠调 viewBox 只能「缩得少一点」，治不了字小。这里钉的是几何本身——
 * 牌带按像素固定、车道跟着高度走、刻度行不被压掉。
 */
describe('the drawing geometry', () => {
  it('stacks the marker band, two lanes and the tick row inside the measured box', () => {
    const view = positioningChartGeometry(698, 210)
    expect(view.width).toBe(698)
    expect(view.height).toBe(210)
    expect(view.markerTop).toBe(3)
    // 牌带 = 两排 13 高的牌，牌底 29——这是像素，不随容器高度变。
    expect(view.markerRow - view.markerTop).toBe(26)
    expect(view.markerRow).toBeLessThan(view.upperTop)
    expect(view.upperTop).toBeLessThan(view.upperBottom)
    expect(view.upperBottom).toBeLessThan(view.zero)
    // 刻度那一行在费率零线下面，至少留 26，轴文字不压进车道。
    expect(view.height - view.zero).toBeGreaterThanOrEqual(26)
  })

  it('keeps the marker band and its text in pixels when the card shrinks', () => {
    const wide = positioningChartGeometry(1000, 300)
    const narrow = positioningChartGeometry(600, 210)
    // 牌带在两边都是 26：牌与字号不会因为卡片变窄而被整体缩小。
    expect(wide.markerRow - wide.markerTop).toBe(26)
    expect(narrow.markerRow - narrow.markerTop).toBe(26)
    // 车道才是跟着高度走的那部分。
    expect(narrow.zero - narrow.upperTop).toBeLessThan(wide.zero - wide.upperTop)
  })

  it('never collapses on a box smaller than its own furniture', () => {
    const tiny = positioningChartGeometry(80, 60)
    expect(tiny.right).toBeGreaterThan(tiny.left)
    expect(tiny.upperTop).toBeLessThan(tiny.upperBottom)
    expect(tiny.upperBottom).toBeLessThan(tiny.zero)
  })
})