import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

/**
 * 迷你发布日历必须**自己滚**，不许把溢出漏到抽屉正文上。
 *
 * **这条是 ratchet，不是行为红证**：happy-dom 不算 CSS 布局，`scrollHeight`/`clientHeight`
 * 在单测里恒为 0，真正的滚动量只能在浏览器引擎里量。行为证据见下面的实测数字（2026-11-16，
 * 无头 Chrome，直接加载本文件这份样式表，DOM 按抽屉真实层级搭、格子里 6 周 × 每天 3 条事件）：
 *
 * | 视口高 | 正文 内容/可视 | 正文 | 日历块 内容/可视 |
 * |---|---|---|---|
 * | 600 | 743 / 600 | 滚（允许） | 143 / 452 自己滚 |
 * | 660 | 743 / 660 | 滚（允许） | 143 / 452 自己滚 |
 * | 700 | 743 / 700 | 滚（允许） | 143 / 452 自己滚 |
 * | 750 | 750 / 750 | **不滚** | 143 / 452 自己滚 |
 * | 800 | 800 / 800 | **不滚** | 186 / 452 自己滚 |
 * | 900 | 900 / 900 | **不滚** | 286 / 452 自己滚 |
 *
 * 改前（没有 `overflow`、没有地板）：800 高时正文 1041/800 滚 241px；600 高时它自己被压到
 * 18px——盒子还在、一个日期也读不到。两条一起修，才有上表。
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
  })

  it('never lets the block collapse below one readable row', () => {
    // 没有地板时矮窗口会把它压到 18px：盒子在、一个日期都读不到，等于没有日历。
    // 地板要 ≥ 表头 24 + 星期行 17 + 一行格子 63.8 + 内距 18 + 边线 2。
    const floor = /min-height:\s*(\d+(?:\.\d+)?)px/u.exec(rulesOf('.mk-minical'))?.[1]
    expect(Number(floor)).toBeGreaterThanOrEqual(63.8 + 24 + 17 + 18 + 2 - 1)
  })

  it('lets the six week rows share the container height, which is why the block scrolls', () => {
    /**
     * 用户 2026-11-19：日历要撑满可视区，窗口越高格子越高。
     *
     * 所以六行是 `minmax(0, 1fr)` 均分容器高度，不再是写死的 63.8px；
     * 等高等仍成立（同一容器里六行同一份 `1fr`），而「这一块自己滚」的前提也不变——
     * `.mk-minical` 仍是 `flex: 1 1 auto` 的可滚容器。
     */
    const grid = rulesOf('.mk-minical__grid')
    expect(grid).toContain('grid-template-rows: repeat(6, minmax(0, 1fr))')
    expect(grid).toContain('flex: 1 1 auto')
  })

  it('leaves the column unclipped, so the readout panel can still paint outside it', () => {
    // 反向约束：修这个滚动**不许**靠给 `.mk-col-l` 加 overflow——那一层一旦成为滚动容器，
    // 跟着光标走的读数面板就会被裁在列边界上（`macroIndicatorDrawerClip.test.ts` 那条）。
    const column = rulesOf('.mk-col-l')
    expect(column).not.toContain('overflow')
  })
})
