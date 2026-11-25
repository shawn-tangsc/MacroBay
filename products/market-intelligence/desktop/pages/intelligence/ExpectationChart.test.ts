import { describe, expect, it } from 'vitest'

import { readFileSync } from 'node:fs'

import { binExpectationPoints, formatTick, EXPECTATION_BIN_PX, EXPECTATION_PLOT_INSET } from './ExpectationChart'

const values = { 'no-change': 0.2, 'hike-25': 0.7, 'hike-50-plus': 0.05, 'cut-25': 0.03, 'cut-50-plus': 0.02 }
const point = (minute: number, bp: number) => ({ at: new Date(Date.UTC(2026, 9, 30, 0, minute)).toISOString(), bp, values })

describe('expectation chart ticks', () => {
  it('keeps the minus sign on the lower half of the axis', () => {
    expect([-40, -20, 0, 20, 40].map(formatTick)).toEqual(['−40bp', '−20bp', '0bp', '+20bp', '+40bp'])
  })
})

describe('expectation binning', () => {
  it('makes one bin per 3px, so the count follows the plot width and nothing else', () => {
    expect(binExpectationPoints([point(0, 20)], 300)).toHaveLength(100)
    expect(binExpectationPoints([point(0, 20)], 30)).toHaveLength(10)
    expect(EXPECTATION_BIN_PX).toBe(3)
  })

  it('takes the last observation inside a bin, never the average', () => {
    // 10 bins over one hour: the first two points both land in bin 0.
    const bins = binExpectationPoints([point(0, 10), point(3, 40), point(60, 20)], 30)
    expect(bins[0]).toBe(40)
    expect(bins[9]).toBe(20)
  })

  it('leaves an empty bin empty instead of interpolating across it', () => {
    // Points at the two ends only: the 8 bins between them must stay null, not ramp 10 → 20.
    const bins = binExpectationPoints([point(0, 10), point(60, 20)], 30)
    expect(bins[0]).toBe(10)
    expect(bins[9]).toBe(20)
    expect(bins.slice(1, 9)).toEqual(Array.from({ length: 8 }, () => null))
  })

  it('drops an unusable instant instead of placing it at zero', () => {
    const bins = binExpectationPoints([{ at: 'not-a-time', bp: 30, values }, point(0, 10)], 30)
    expect(bins.filter((value) => value !== null)).toEqual([10])
  })
})

/**
 * 图在卡片里两头留白（用户 2026-11：「图表在卡片里面两边有好多空」）。
 *
 * 判据是**绘图区占卡宽的比例**：左 52 在容器与图里各给了一遍，右边 12 也给了两遍。
 * 这里按卡片自己的内距 + 图的内距算，改回重复内距就要红。
 */
describe('the plot fills the card', () => {
  const cardPadding = (): Readonly<{ left: number; right: number }> => {
    const css = readFileSync('products/market-intelligence/desktop/pages/intelligence/cryptoDashboard.css', 'utf8')
    // 别处还有一条 `.mi-crypto-dashboard__macro-row > .mk-dash-expectation`，取带 padding 的那条。
    const rule = [...css.matchAll(/\.mk-dash-expectation \{([^}]*)\}/gu)]
      .map((match) => match[1] ?? '').find((body) => body.includes('padding:')) ?? ''
    const padding = /padding:\s*([^;]+);/u.exec(rule)?.[1]?.trim().split(/\s+/u) ?? []
    const [top, right = top, bottom = top, left = right] = padding
    // 四个值：上 右 下 左。
    return { left: Number.parseFloat(left!), right: Number.parseFloat(right ?? bottom ?? top!) }
  }

  it('spends the card padding and the plot inset once each, never twice', () => {
    const padding = cardPadding()
    expect(padding.right + EXPECTATION_PLOT_INSET.right, '右侧只剩 12px 内距').toBe(12)
    for (const cardWidth of [560, 740, 940]) {
      const plot = cardWidth - padding.left - padding.right - EXPECTATION_PLOT_INSET.left - EXPECTATION_PLOT_INSET.right
      // 旧形状：左边 52 在容器与图里各一遍、右边 12 也各一遍。改回来就会掉到它以下。
      const doubled = cardWidth - 52 - 12 - EXPECTATION_PLOT_INSET.left - EXPECTATION_PLOT_INSET.right
      expect(plot / cardWidth, `${cardWidth} 宽时绘图区占比必须比重复内距时高`).toBeGreaterThan(doubled / cardWidth)
      expect(plot, `${cardWidth} 宽时绘图区不许被挤到一半以下`).toBeGreaterThan(cardWidth / 2)
    }
  })
})

/**
 * 这一排的高度**只由钟表卡决定**（用户 2026-11：「怎么还是那么大」）。
 *
 * 两个坑：图那一格自带 `height = 330` 的默认值；绘图区的 `flex-basis: auto` 会拿上一次测到的
 * SVG 高度当内容占位，反过来把整排撑回旧高度。判据是三条：格子高度传入钟表卡的高度常量、
 * 绘图区 basis 归 0、整排没有自己的高度。
 */
describe('the macro row takes its height from the clock', () => {
  const read = (relative: string): string =>
    readFileSync(`products/market-intelligence/desktop/pages/intelligence/${relative}`, 'utf8')

  it('gives the chart cell the clock height and no height of its own', () => {
    const row = read('DashboardMacroRow.tsx')
    expect(row, '高度只有一个来源：钟表卡的几何常量').toContain('height={clockCardGeometry.cardHeight}')
    const css = read('cryptoDashboard.css')
    expect(css, '整排不许自己定高').toMatch(/\.mi-crypto-dashboard__macro-row \{[^}]*\}/u)
    expect(/\.mi-crypto-dashboard__macro-row \{[^}]*height:/u.test(css)).toBe(false)
    expect(css, '绘图区 basis 归 0，别拿上次测到的高度回灌').toMatch(/\.mk-dash-expectation__plot \{[^}]*flex: 1 1 0;/u)
  })
})
