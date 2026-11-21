import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * 这张卡的样式必须**自成一体**，不能借用上面那张联动面板的作用域。
 *
 * 2026-11-22 界面设计复核时不签字：`<UstYieldCurveSection>` 是 `<CrossAssetObservationPanel>` 的
 * **兄弟**，而 `@container mi-cross-asset` 与 `--mi-cross-asset-*` 只在面板自己的 `.mi-cross-asset`
 * 上声明——所以这 21 处引用一条也没解析出来：两栏塌成一栏、表没有横竖线、表头不是灰的、
 * 图的网格与轴标签在深色下是黑的。这不是「颜色差一点」，是整块版式没有生效。
 *
 * 所以这张卡自己声明容器（量本卡宽度）与那一对栏宽；门户 token 直接引用 `--border` / `--muted` /
 * `--text` / `--surface`，**不再留任何一个跨组件的名字**。
 */
const css = readFileSync(
  resolve(process.cwd(), 'products/market-intelligence/desktop/features/industry/ust-curve/ustYieldCurve.css'),
  'utf8'
)

/** 某个选择器那一段声明（从 `\n<selector> {` 到下一个 `\n}`）。 */
function block(selector: string): string {
  const start = css.indexOf(`\n${selector} {`)
  expect(start, `${selector} 必须有一条自己的规则`).toBeGreaterThan(-1)
  return css.slice(start, css.indexOf('\n}', start))
}

describe('国债收益率卡的样式边界', () => {
  it('declares its own container and its own pair of column widths', () => {
    const root = block('.mi-ust')
    expect(root).toContain('container-name: mi-ust;')
    expect(root).toContain('container-type: inline-size;')
    expect(root).toContain('--mi-ust-quote-medium: 320px;')
    expect(root).toContain('--mi-ust-quote-wide: 380px;')
  })

  it('switches the two columns on its own width, not on the panel above it', () => {
    const thresholds = css.match(/@container mi-ust \(min-width: (\d+)px\)/g) ?? []
    expect(thresholds).toHaveLength(2)
    expect(thresholds[0]).toBe('@container mi-ust (min-width: 800px)')
    expect(thresholds[1]).toBe('@container mi-ust (min-width: 1200px)')
    expect(css).not.toContain('@container mi-cross-asset')

    const grid = [...css.matchAll(/\.mi-ust__body:not\(\[data-whole="true"\]\) \{ grid-template-columns: ([^;]+);/g)]
      .map((match) => match[1])
    expect(grid).toHaveLength(2)
    expect(grid[0]).toContain('var(--mi-ust-quote-medium)')
    expect(grid[1]).toContain('var(--mi-ust-quote-wide)')
  })

  it('names no token owned by another feature', () => {
    expect(css.match(/--mi-cross-asset-[a-z-]*/g) ?? []).toHaveLength(0)
    // 剩下的颜色与线条落回门户 token，一种用途一个名字。
    expect(block('.mi-ust__table thead th')).toContain('border-bottom: 1px solid var(--border);')
    expect(block('.mi-ust__axis')).toContain('fill: var(--muted);')
  })

  it('draws no second line above the card, but keeps its own 16px of space', () => {
    // 面板自己在 `.mi-cross-asset` 上有 `border-block` + `margin-block: 16`，卡再画一条线就是两条线
    // 相距 16px；所以这里只有间距、没有线。但间距必须有：`crossAssetClient` 为空时上面那张面板不渲染
    // （冷启动首帧 `readsReady=false`，或读者把 index/btc/eth 三格全关），那时这张卡就是第一块，
    // 没有 margin 会直接贴上去。面板在场时两条 margin 折叠，仍是 16px。
    const root = block('.mi-ust')
    expect(root).toContain('margin-top: 16px;')
    // 判据必须是「根块里没有 border / padding 这一类属性」，不能只钉 `border-top`：把线写成
    // `border-block`（正是上面那张面板的写法）就能绕过旧断言——界面设计 2026-11-22 用变异测过这一点。
    // 根块现在一个 border / padding 都没有（间距只有 margin），收紧不会误伤。
    expect(root).not.toMatch(/\bborder/)
    expect(root).not.toMatch(/\bpadding/)
  })

  it('keeps every length inside the spacing scale and leaves no dead selector', () => {
    // 2px 不在 4/6/8/10/12/16 档里；行高 1.5 已经把两行分开了，4px 是档内最小值。
    expect(css).toMatch(/\.mi-ust__tooltip span \{[^}]*padding-block: 4px;/)
    // 浮层是条件渲染的，永远不会带 `hidden`；加载态走平台 `LoadingState`，没有自己的类。
    expect(css).not.toContain('[hidden]')
    expect(css).not.toContain('.mi-ust__loading')
    // 图不再可聚焦（改当图），焦点环随之没有存在的理由。
    expect(css).not.toContain('.mi-ust__svg:focus-visible')
  })
})
