import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

/**
 * 叠层抽屉（政策抽屉挂在 body 上、盖在关键指标抽屉之上）的两条活命条件。
 *
 * 两条都是从真机反馈倒推出来的，而且都只在**被 portal 到 body** 之后才成立：
 *
 * 1. **宽度得声明在抽屉自己身上。** 变量原来写在 `.mi-analysis-dashboard-layout` 上，挂着的时候
 *    祖先链里没有那层，`min(var(--mi-drawer-width), 100%)` 整条失效，固定定位退成内容宽 →
 *    抽屉铺满（用户 2026-11-21：「还是那么大」）。
 * 2. **必须是 `no-drag`。** 拖拽区按几何矩形算，不看 z-index、不看 DOM。这层铺满窗高，标题栏
 *    压进顶部 42px 的拖拽带，没有 `no-drag` 时关闭键看得见、点不动（用户 2026-11-21：「怎么关不掉」）。
 *
 * **这是 ratchet，不是行为红证**：vitest 不处理 CSS，`getComputedStyle` 在 happy-dom 里读不到样式表
 * 里的值。真正的行为证据是用户在真机上看宽度与关闭键，登记在台账 #50。
 */
const css = readFileSync(new URL('./marketAnalysisWorkspace.css', import.meta.url), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')

const rules = (source: string): readonly Readonly<{ selector: string; body: string }>[] =>
  [...source.matchAll(/([^{}]+)\{([^}]*)\}/gu)].map((match) => ({ selector: match[1]!.trim(), body: match[2]! }))

const bodyOf = (selector: string): string => {
  const found = rules(css).filter((rule) => rule.selector.split(',').map((part) => part.trim()).includes(selector))
  // 同一选择器出现多次时合并：后写的规则同样生效，只看第一条会漏掉覆盖。
  return found.map((rule) => rule.body).join(';')
}

describe('叠层抽屉的样式前提', () => {
  it('宽度变量声明在抽屉自身，不依赖 portal 丢掉的布局祖先', () => {
    expect(bodyOf('.mi-analysis-drawer')).toContain('--mi-drawer-width:')
    expect(bodyOf('.mi-analysis-dashboard-layout')).not.toContain('--mi-drawer-width')
  })

  it('叠层抽屉从窗口拖拽区里减掉，否则标题栏的关闭键点不动', () => {
    expect(bodyOf('.mi-analysis-drawer--overlay')).toContain('-webkit-app-region: no-drag')
  })
})
