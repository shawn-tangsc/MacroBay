import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

/**
 * **ratchet，不是行为红证**：happy-dom 不算 CSS 布局，`overflow: hidden` 的裁切在单测里看不见。
 * 这条只保证那一行裁切不会被悄悄加回来；真正的可见性由用户在真实窗口里看。
 *
 * 加它的原因：`c55a556` 给 `.mk-plot` 加过 `overflow: hidden` 去断尺寸环，结果把读数面板切掉了
 * （用户看到数值被截断）。环真正靠「舞台绝对定位、行高只由政策卡决定」断开，不靠裁切。
 */
describe('plot never clips or traps the readout panel', () => {
  // 注释先剥掉再断言：注释里会写着「不要用 will-change」这种句子，留着会把守卫自己弄红。
  const css = readFileSync(new URL('./macroIndicatorDrawer.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
  const ruleOf = (selector: string): string =>
    new RegExp(`${selector.replace('.', '\\.')}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? ''

  it('lets the plot paint the panel but makes the svg clip itself', () => {
    // `.mk-plot` 不能裁（面板在里面）；`svg` 必须裁（图上的标注不许画到图外）。
    const plot = ruleOf('.mk-plot')
    const svg = ruleOf('.mk-plot__svg')
    expect(plot).not.toContain('overflow: hidden')
    expect(plot).not.toContain('contain: paint')
    expect(svg).toContain('overflow: hidden')
  })

  it('keeps every ancestor between the plot and the drawer from clipping or starting a stacking context', () => {
    // `.mk-view` / `.mk-col-l` / `.mk-sec` 都在面板到抽屉正文之间：它们一旦写上
    // `overflow: hidden`（裁掉面板）或 `transform`/`filter`/`contain`（另开层叠上下文、把面板压到卡片下面），
    // 面板就会「矩形在区内却点不到」。这条只守我们自己的 CSS，antd 的正文不在其中。
    for (const selector of ['.mk-view', '.mk-col-l', '.mk-sec']) {
      const rule = ruleOf(selector)
      for (const forbidden of ['overflow: hidden', 'overflow: clip', 'contain: paint', 'transform:', 'filter:']) {
        expect(rule).not.toContain(forbidden)
      }
    }
  })

  it('never makes the follow-the-cursor panel scrollable', () => {
    // 跟着光标走的面板是 `pointer-events: none`：给它加滚动条就是「看得见、拨不动」的假控件。
    const tip = ruleOf('.mk-tip')
    expect(tip).not.toContain('overflow: auto')
    expect(tip).not.toContain('overflow-y: auto')
    expect(tip).not.toContain('overflow: scroll')
    expect(tip).toContain('overflow: visible')
  })

  it('lifts the panel above the cards and does not promote it into a needless layer', () => {
    const tip = ruleOf('.mk-tip')
    expect(tip).toContain('z-index: 30')
    expect(tip).not.toContain('will-change')
  })
})
