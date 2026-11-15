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
