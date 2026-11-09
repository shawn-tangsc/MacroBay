import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

/**
 * 目录标记的**外形**守卫（界面设计 2026-11-10）。
 *
 * 这一条只能证明「规则还在」——同一选择器在下面再补一条 `width: 10px`，文本守卫照样绿；
 * 真正证明计算样式没被覆盖，要在真机上量 `offsetWidth/Height` 与 `getComputedStyle`。
 * 那条 CI 里没有合法手段，已记「真机待验」（BACKLOG §9 修订记录），**不许在这里写成已验**。
 *
 * 三档共用一套外形，只换填充/描边：`is-muted` 是空心环（描边、不填充），`is-warn`/`is-bad` 实心。
 */
const CSS = readFileSync('products/market-intelligence/desktop/settings/intelligence-sources/intelligence-sources.css', 'utf8')

function rule(selector: string): string {
  const start = CSS.indexOf(`${selector} {`)
  if (start === -1) throw new Error(`missing rule: ${selector}`)
  const end = CSS.indexOf('}', start)
  return CSS.slice(start + selector.length + 2, end)
}

function declarations(body: string): Map<string, string> {
  const found = new Map<string, string>()
  // 注释里也可能出现冒号（如「带 fallback：…」），先剥掉注释再按声明切。
  for (const line of body.replace(/\/\*[\s\S]*?\*\//g, '').split(';')) {
    const [property, ...rest] = line.split(':')
    if (!property || rest.length === 0) continue
    found.set(property.trim(), rest.join(':').trim())
  }
  return found
}

describe('the catalog marker shape', () => {
  it('draws all three tiers as the same 8×8 circle', () => {
    const shape = declarations(rule('.intelligence-provider-state i'))
    expect(shape.get('width')).toBe('8px')
    expect(shape.get('height')).toBe('8px')
    expect(shape.get('border-radius')).toBe('50%')
    // 空心环靠 border-box 保持外框 8px，与两颗实心点同尺寸。
    expect(shape.get('box-sizing')).toBe('border-box')
  })

  it('draws the muted ring hollow: a border and no fill', () => {
    const ring = declarations(rule('.intelligence-provider-state i.is-muted'))
    expect(ring.get('background')).toBe('transparent')
    expect(ring.get('border')).toContain('solid')
    expect(ring.get('border')).toContain('var(--muted)')
  })

  it('fills the warn and bad tiers, so shape and colour encode together', () => {
    for (const selector of ['.intelligence-provider-state i.is-warn', '.intelligence-provider-state i.is-bad']) {
      const filled = declarations(rule(selector))
      const background = filled.get('background')
      expect(background, selector).toBeDefined()
      expect(background, selector).not.toBe('transparent')
      expect(background, selector).toContain('var(--')
    }
  })
})
