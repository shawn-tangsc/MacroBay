import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * 描边次按钮的悬停色（P8）。
 *
 * 病：我们的 `.ant-secondary-button.ant-btn:hover` 与 antd 的
 * `.ant-btn-default:not(:disabled):hover` **特异性相同**，而 antd 走 CSS-in-JS、后注入，
 * 于是悬停时字与边被染成强调色（实测 `rgb(209, 232, 126)`），全站 32 处次按钮都是这个结果。
 *
 * 判据不是「看起来对」，而是**特异性必须严格更高**：同特异性时后注入者赢，规则写得再对也没用。
 */
const styles = readFileSync(join(__dirname, '../../styles.css'), 'utf8')

/** 极简特异性计算：`#id` 记 100、`.class`/`:pseudo` 记 10、元素记 1；`:not()` 取括号内的值。 */
function specificity(selector: string): number {
  const withoutNot = selector.replace(/:not\(([^)]*)\)/g, (_whole, inner: string) => `.${'x'.repeat(inner.split(':').length - 1)}`)
  const ids = (withoutNot.match(/#[\w-]+/g) ?? []).length
  const classes = (withoutNot.match(/\.[\w-]+|:[\w-]+(?:\([^)]*\))?/g) ?? []).length
  const elements = (withoutNot.match(/(^|[\s>+~])[a-z][\w-]*/g) ?? []).length
  return ids * 100 + classes * 10 + elements
}

describe('secondary button hover', () => {
  it('wins over antd’s default-button hover by specificity, not by luck of order', () => {
    const rule = /([^{}]*ant-secondary-button[^{}]*:hover[^{}]*)\{/.exec(styles)?.[1] ?? ''
    expect(rule).not.toBe('')

    const ours = specificity(rule)
    const antd = specificity('.ant-btn-default:not(:disabled):hover')
    expect(ours).toBeGreaterThan(antd)
  })

  it('paints with our tokens, not the interaction colour', () => {
    const block = /ant-secondary-button[^{}]*:hover[^{}]*\{([^}]*)\}/.exec(styles)?.[1] ?? ''
    expect(block).toMatch(/color:\s*var\(--text-strong\)/)
    expect(block).toMatch(/border-color:\s*var\(--border-strong\)/)
    expect(block).not.toMatch(/--accent|colorLink|1668dc/)
  })
})
