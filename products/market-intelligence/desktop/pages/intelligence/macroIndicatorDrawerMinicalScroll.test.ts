import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

/**
 * 迷你发布日历必须**自己滚**，不许把溢出漏到抽屉正文上。
 *
 * **这条是 ratchet，不是行为红证**：happy-dom 不算 CSS 布局，`scrollHeight`/`clientHeight`
 * 在单测里恒为 0，真正的滚动量只能在浏览器引擎里量。行为证据见下面的实测数字（2026-11-16，
 * 无头 Chrome，直接加载本文件这份样式表，DOM 按抽屉真实层级搭、格子里 6 周 × 每天 3 条事件）：
 *
 *   改前（`.mk-minical` 没有 overflow）：body 800/1041 → 正文滚 241px，日历块自己被压到 186px
 *   改后（`overflow: auto` 加上）：     body 800/800  → 正文不滚；日历块 186/452 自己滚
 *   视口高 660 / 700 / 760 / 900 四档同样：body 800…900/同值 不滚，日历块自己滚
 *
 * 这段判据守的是「不被悄悄改回去」：把 `overflow: auto` 删掉、或把格子的固定行高改成
 * 可伸缩（那会让六行不等高，见 `.mk-minical__grid` 的注释），滚动条就会再长出到抽屉上。
 */
const css = readFileSync(new URL('./macroIndicatorDrawer.css', import.meta.url), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
/** 一条选择器自己的规则体：`a, b { … }` 这种联合规则只在选择器**完整等于**它时才取。 */
const rulesOf = (selector: string): string =>
  [...css.matchAll(/([^{}]+)\{([^}]*)\}/gu)]
    .filter((match) => match[1]!.split(',').map((part) => part.trim()).includes(selector))
    .map((match) => match[2]!)
    .join('\n')

describe('the mini release calendar scrolls itself, never the drawer', () => {
  it('gives the calendar its own scroll box', () => {
    // 六行格子是 `flex: none` + 固定行高（下面那条），所以这块一定是「内容比盒子高」；
    // 没有 overflow 时多出来的部分会溢出到 `.mk-col-l` 之外，被 antd 的正文接住。
    expect(rulesOf('.mk-minical')).toContain('overflow: auto')
    // 盒子必须能被压小，否则它自己就成了把正文顶高的那一块。
    expect(rulesOf('.mk-minical')).toContain('min-height: 0')
  })

  it('keeps the six week rows fixed, which is why the block has to scroll', () => {
    // 行高写死成同一个值才六行等高等；改成 1fr 会在容器高度不确定时按内容分配，
    // 那天有多条事件的行会变高——那时「这一块自己滚」也就不成立了。
    const grid = rulesOf('.mk-minical__grid')
    expect(grid).toContain('grid-template-rows: repeat(6, 63.8px)')
    expect(grid).toContain('flex: none')
  })

  it('leaves the column unclipped, so the readout panel can still paint outside it', () => {
    // 反向约束：修这个滚动**不许**靠给 `.mk-col-l` 加 overflow——那一层一旦成为滚动容器，
    // 跟着光标走的读数面板就会被裁在列边界上（`macroIndicatorDrawerClip.test.ts` 那条）。
    const column = rulesOf('.mk-col-l')
    expect(column).not.toContain('overflow')
  })
})
