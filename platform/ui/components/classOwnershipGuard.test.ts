import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * 平台组件与壳层**不许各自定义同一个类名**。
 *
 * 事故（2026-11-18）：壳层的 `styles.css` 里留着一条 `.icon-button { width:32px; border:1px solid … }`，
 * 那是平台 `IconButton` 出现之前的遗留写法；平台组件的根类名也叫 `icon-button`。两者特异性都是
 * (0,1,0)，壳层后加载胜出，于是 `plain` 档的「无边框」被盖掉——**每一颗图标按钮都变成带 1px 描边的
 * 方块**，用户两次说「那么大／好丑」。
 *
 * 判据是「壳层有没有**单独定义**平台组件的根类名」（选择器里只有这一个类，如 `.icon-button {`）。
 * 只判单独定义，不判复合用法：`.settings-tabs .tabs` 是在壳层自己的容器里限定某个平台组件，
 * 那是合法的组合，不是第二份实现。
 *
 * 平台组件的根类名由目录名推导（目录 `icon-button` → 类 `icon-button`），所以新增组件自动纳入，
 * 不需要维护第二张清单。反向用例喂合成 CSS，证明它真的会红。
 */
const ROOT = resolve(__dirname, '../../..')
const COMPONENTS = join(ROOT, 'platform/ui/components')
const SHELL_CSS = join(ROOT, 'apps/desktop-shell/src/renderer/src/styles.css')

/** 选择器里只有一个类（可带伪类）：`.icon-button`、`.tabs:hover`。 */
const STANDALONE = /^\.([a-zA-Z][\w-]*)(?::[\w-]+)?$/u

/** 收集一份 CSS 里「单独定义」的类名。 */
export function standaloneClassNames(css: string): Set<string> {
  const names = new Set<string>()
  const text = css.replace(/\/\*[\s\S]*?\*\//gu, '')
  for (const match of text.matchAll(/([^{}]+)\{/gu)) {
    for (const selector of (match[1] ?? '').split(',')) {
      const found = STANDALONE.exec(selector.trim())
      if (found?.[1] !== undefined) names.add(found[1])
    }
  }
  return names
}

/** 有自己样式表的平台组件目录名（= 它们的根类名）。 */
export function componentRootClasses(): string[] {
  return readdirSync(COMPONENTS, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => readdirSync(join(COMPONENTS, name)).some((file) => file.endsWith('.css')))
}

/** 壳层里重复定义了哪些平台组件根类名。 */
export function collisions(shellCss: string, roots: readonly string[]): string[] {
  const shell = standaloneClassNames(shellCss)
  return roots.filter((root) => shell.has(root)).sort()
}

describe('平台组件的类名归组件，壳层不另写一份', () => {
  it('defines none of the platform component root classes', () => {
    expect(collisions(readFileSync(SHELL_CSS, 'utf8'), componentRootClasses())).toEqual([])
  })

  it('catches a duplicate, and leaves compound usage alone', () => {
    const roots = ['icon-button', 'tabs']
    // 反向：壳层单独定义 `.icon-button` → 红（这就是今天那处）。
    expect(collisions('.icon-button { width: 32px; }', roots)).toEqual(['icon-button'])
    // 复合用法是合法组合（限定在壳层自己的容器里），不红。
    expect(collisions('.settings-tabs .tabs { gap: 0; }', roots)).toEqual([])
    // 顶层单独定义 `.tabs` 仍是重复，红。
    expect(collisions('.tabs { gap: 0; }', roots)).toEqual(['tabs'])
  })
})
