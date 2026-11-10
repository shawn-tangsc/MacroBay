import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * 左列与内容区的**顶部内距必须相等**：不然左列第一项比右侧第一个区块高/低一截
 * （用户截图指的就是 8 对 16 那 8px 差）。断言纯值，不量像素。
 */
const CSS = join(process.cwd(), 'products/market-intelligence/desktop/settings/config-drawer/configDrawer.css')

/** 纯函数：从 CSS 里取某条规则的 `padding` 简写，返回每一项。 */
export function paddingOf(css: string, selector: string): string[] {
  const rule = new RegExp(`${selector.replace('.', '\\.')}\\s*\\{([^}]*)\\}`, 'u').exec(css)
  if (rule === null) return []
  const value = /padding\s*:\s*([^;]+);/u.exec(rule[1] ?? '')?.[1]?.trim()
  return value === undefined ? [] : value.split(/\s+/u)
}

const top = (parts: readonly string[]): string => parts[0]!

describe('the nav and the pane start on the same line', () => {
  it('gives both columns the same top padding', () => {
    const css = readFileSync(CSS, 'utf8')
    expect(top(paddingOf(css, '.config-drawer__nav'))).toBe('16px')
    expect(top(paddingOf(css, '.config-drawer__pane'))).toBe('16px')
  })

  it('flags a rule whose top padding differs', () => {
    const fixture = '.a__nav { padding: 8px 6px; } .a__pane { padding: 16px; }'
    expect(top(paddingOf(fixture, '.a__nav'))).not.toBe(top(paddingOf(fixture, '.a__pane')))
  })
})
