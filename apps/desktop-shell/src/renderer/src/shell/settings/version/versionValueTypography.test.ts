import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 「未知」和真值必须同字号、同字重、同基线，只有颜色不同。
 *
 * 这条翻车过一次：占位值单独压了一档字重（500 对 600），同一个位置两个值读起来就是「小一号」。
 * jsdom 不跑布局，任何渲染测试都量不出字号；只有对着样式文件查才查得到，所以这里直接断言声明。
 */
describe('version value typography', () => {
  it('gives the value one size and weight', () => {
    const value = cssRule('.version-value')
    expect(value).toContain('font-size: 13px')
    expect(value).toContain('font-weight: 600')
    // 数字等宽：换版本时数字不跳位。
    expect(value).toContain('font-variant-numeric: tabular-nums')
  })

  it('changes only the colour for the unknown placeholder', () => {
    const unknown = cssRule('.version-value-unknown')
    // 颜色是唯一允许的差异：真值用 `--text-strong`，占位用 `--muted-strong`。
    expect(unknown).toContain('color: var(--muted-strong)')
    // 下面这三条一旦出现，就是又给占位值开了第二套字号——把它删掉，不是给它调数值。
    expect(unknown).not.toMatch(/font-size/u)
    expect(unknown).not.toMatch(/font-weight/u)
    expect(unknown).not.toMatch(/line-height/u)
  })
})

function cssRule(selector: string): string {
  const css = readFileSync(resolve(process.cwd(), 'apps/desktop-shell/src/renderer/src/styles.css'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
  for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = match[1].split(',').map((entry) => entry.trim())
    if (selectors.includes(selector)) return match[2]
  }
  throw new Error(`Missing CSS rule for ${selector}`)
}
