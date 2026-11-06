// @vitest-environment happy-dom

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * 行内文字动作（`.text-action`）的最小判据。
 *
 * 这条规则存在的理由是**页面上已经出现过第二个交互色**：antd 的 `colorLink`（`rgb(22, 104, 220)`）
 * 不在我们的 token 里。所以用例不判「长得像不像」，只判两件事：
 * 颜色来自 `--accent`，且聚焦有可见环。
 */
const ROOT = join(__dirname, '..', '..', '..')
const css = readFileSync(join(ROOT, 'platform/ui/styles/textAction.css'), 'utf8')
const rules = css.replace(/\/\*[\s\S]*?\*\//g, '')
const tokens = readFileSync(join(ROOT, 'platform/ui/tokens/tokens.css'), 'utf8')
const shellStyles = readFileSync(join(ROOT, 'apps/desktop-shell/src/renderer/src/styles.css'), 'utf8')

/** 从两份样式表里取某个 token 的值（tokens.css 优先，主题变量在 styles.css 里）。 */
function tokenValue(name: string): string | null {
  for (const source of [tokens, shellStyles]) {
    const match = new RegExp(`${name}\\s*:\\s*([^;]+);`).exec(source)
    if (match) return match[1]!.trim()
  }
  return null
}

describe('.text-action', () => {
  it('takes its colour from --accent, never from antd’s link colour', () => {
    expect(rules).toMatch(/\.text-action\s*\{[^}]*color:\s*var\(--accent\)/)

    // 解析成什么颜色：把 token 代入后必须是 token 的值，而不是 antd 那个蓝。
    const accent = tokenValue('--accent')
    expect(accent).not.toBeNull()
    expect(accent).not.toMatch(/22,\s*104,\s*220|1668dc/i)
    // 全表不许出现 antd 链接色，也不许写死色值（颜色只能来自 token）。
    expect(rules).not.toMatch(/colorLink|1668dc|rgb\(22,\s*104,\s*220\)/i)
    expect(rules).not.toMatch(/#[0-9a-f]{3,8}\b/i)
  })

  it('keeps the one focus ring: 2px accent with a 2px offset', () => {
    expect(rules).toMatch(/\.text-action:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--accent\)/)
    expect(rules).toMatch(/\.text-action:focus-visible\s*\{[^}]*outline-offset:\s*2px/)
    expect(rules).not.toMatch(/outline:\s*none/)
  })

  it('inherits the sentence’s typography instead of inventing its own', () => {
    // 字号/字重/行高必须继承：它属于那句话，不属于另一套排版。
    expect(rules).toMatch(/\.text-action\s*\{[^}]*font:\s*inherit/)
    expect(rules).not.toMatch(/font-size\s*:/)
    expect(rules).not.toMatch(/font-weight\s*:/)
  })

  it('renders inline, so a sentence does not become two stacked controls', () => {
    expect(rules).toMatch(/\.text-action\s*\{[^}]*display:\s*inline/)
  })
})
