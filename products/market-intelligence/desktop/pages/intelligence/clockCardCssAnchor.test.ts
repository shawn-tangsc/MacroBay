import { readFileSync } from 'node:fs'

import { expect, it } from 'vitest'

/**
 * 期望那一格**必须是图的舞台的定位祖先**。
 *
 * 图的舞台是 `position:absolute; inset:0`（`macroIndicatorDrawer.css` 的 `.mk-plot__stage`），
 * 抽屉里靠 `.mk-plot { position:relative }` 框住它。看板这一格少了 `position:relative` 时，
 * 舞台会贴到更外层、铺满一大片，于是「鼠标移到哪都浮出读数面板」——用户 2026-11-15 报的现象。
 * 这条纯文本断言钉住那一行：删掉它，或者把它挪到别的选择器上，都会红。
 */
it('keeps the expectation plot a positioning ancestor for the chart stage', () => {
  const css = readFileSync('products/market-intelligence/desktop/pages/intelligence/cryptoDashboard.css', 'utf8')
  const rule = /\.mk-dash-expectation__plot\s*\{([^}]*)\}/.exec(css)?.[1] ?? ''
  expect(rule, 'the plot rule must exist').not.toBe('')
  expect(rule, 'without position:relative the inset:0 stage escapes to an outer ancestor').toMatch(/position:\s*relative/)
})

/**
 * 牌与提示框的 z-index 只许在**各自的卡内**比较。
 *
 * 分析详情抽屉是就地渲染的 `position:absolute; z-index:3`（`marketAnalysisWorkspace.css`）。
 * 卡里的牌是 `z-index:4`（悬停 9），卡若不自建层叠上下文，牌的层级就会跳出去和抽屉比，
 * 于是牌浮在抽屉正文之上——用户 2026-11-15 的截图正是这个。
 * 无头 Chrome 实测：`.mi-clock` 无 `isolation` 时该点最上层是牌；有 `isolate` 时是抽屉。
 */
it('contains its absolutely positioned layers inside each card', () => {
  const clock = readFileSync('products/market-intelligence/desktop/pages/intelligence/clockCard.css', 'utf8')
  expect(/\.mi-clock\s*\{[^}]*isolation:\s*isolate/.test(clock)).toBe(true)
  const dashboard = readFileSync('products/market-intelligence/desktop/pages/intelligence/cryptoDashboard.css', 'utf8')
  // 资金面那张卡的提示框同样带 z-index，也得在卡内收口。
  expect(/\.mi-capital-conditions__chart\s*\{[^}]*isolation:\s*isolate/.test(dashboard)).toBe(true)
})
