import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * Windows 的经典滚动条又粗（15~17px）又常驻、带轨道；macOS 是系统 overlay 细条，不滚动时
 * 根本看不见、也不占位。产品里大量布局是按「没有滚动条」算的，所以样式只允许在 `win32` 下
 * 接管滚动条——否则 macOS 会从 overlay 变成常驻滚动条，等于把另一个平台弄坏。
 */
const root = process.cwd()
const css = readFileSync(resolve(root, 'apps/desktop-shell/src/renderer/src/styles.css'), 'utf8')
const main = readFileSync(resolve(root, 'apps/desktop-shell/src/renderer/src/main.tsx'), 'utf8')

describe('平台滚动条', () => {
  it('只在 win32 下换成 10px 细滚动条，并隐藏两端箭头', () => {
    const block = css.slice(css.indexOf(':root[data-platform="win32"] ::-webkit-scrollbar {'))
    expect(block.slice(0, block.indexOf('}'))).toMatch(/width:\s*10px/)
    const button = css.slice(css.indexOf(':root[data-platform="win32"] ::-webkit-scrollbar-button {'))
    expect(button.slice(0, button.indexOf('}'))).toMatch(/display:\s*none/)
  })

  it('没有任何不带平台前缀的滚动条规则', () => {
    const selectors = [...css.matchAll(/(?:^|\n)([^\n{]*::-webkit-scrollbar[^\n{]*)\{/g)]
      .map((match) => match[1]?.trim() ?? '')
    expect(selectors.length).toBeGreaterThan(0)
    expect(selectors.filter((selector) => !selector.startsWith(':root[data-platform="win32"]'))).toEqual([])
  })

  it('渲染层给 <html> 打平台标记（入口调用、单源写入）', () => {
    // 平台标记只有一个写入口：`shell/window/windowPlatform.ts`（CSS 与自绘标题栏同读这一处）
    const platform = readFileSync(
      resolve(root, 'apps/desktop-shell/src/renderer/src/shell/window/windowPlatform.ts'),
      'utf8'
    )
    expect(platform).toContain('document.documentElement.dataset.platform')
    expect(platform).toContain("'win32'")
    expect(main).toContain('markRendererPlatform()')
  })
})
