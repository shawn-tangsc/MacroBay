import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 整段 JSON 的横向滚动必须落在代码块内部。
 *
 * `.agent-markdown` 是 grid，`.chat-markdown-json` 只是它的一个普通格子；格子的
 * `min-width: auto` 会按最长一行（pre 里的 JSON 一行常常一千多像素）算最小宽度，
 * 于是这个包裹层把气泡和 `.agent-message-scroll-region` 一起撑宽，变成整个对话区横向滚动。
 * `pre` 自己是滚动容器，本可以缩，是外面这层不让它缩。
 */
describe('json block overflow', () => {
  it('lets the json wrapper shrink so the pre owns the horizontal scrollbar', () => {
    const wrapper = cssRule('.chat-markdown-json')
    expect(wrapper).toContain('min-width: 0')
    expect(wrapper).toContain('max-width: 100%')
  })

  it('keeps the code block itself scrollable', () => {
    expect(cssRule('.agent-markdown-code')).toContain('overflow: auto')
    expect(cssRule('.agent-markdown-code code')).toContain('white-space: pre')
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
