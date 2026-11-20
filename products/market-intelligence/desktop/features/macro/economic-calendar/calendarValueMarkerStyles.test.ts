import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

/**
 * 「值 + 标记」这一个格子的样式，按界面设计 2026-11-16 的定稿钉住。
 *
 * 起因是一个现成反例：`em.mi-economic-calendar__consensus-source`（「从市场预期」）是值行的**第三个
 * 子项**，在 `flex + space-between + gap 12` 里被推到行右端，看起来像「行尾可点的动作」；
 * 而那个类名**全仓没有一条 CSS**，所以它到底长什么样全靠运气。
 *
 * 定稿：标记是说明不是控件——`var(--font-meta)` / `var(--muted)`、字族跟正文（不继承值的等宽）、
 * 无背景/描边/内距/hover/cursor、与值之间 4 的间距、整串不换行。
 *
 * **它是样式表文本棘轮**：`vitest` 不处理 CSS，断言计算值只会是假绿；行为证据是上面那份定稿本身
 * （界面设计逐条给的），真机观感归用户。
 */
const css = readFileSync(new URL('./economicCalendar.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
const rule = (selector: string): string => {
  const match = new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')} \\{([^}]*)\\}`, 'u').exec(css)
  expect(match, `${selector} 没有样式规则`).not.toBeNull()
  return match![1]!
}

describe('the value marker is a note, not a control', () => {
  it('uses meta type and the muted colour, with the body font family', () => {
    const marker = rule('.mi-calendar-value__marker')
    expect(marker).toContain('font-size: var(--font-meta)')
    expect(marker).toContain('color: var(--mi-economic-muted)')
    // 值那一档是等宽；标记必须退回正文字族，不能被 14 等宽的观感带过去。
    expect(marker).toContain('font-family: inherit')
  })

  it('carries no affordance of its own', () => {
    const marker = rule('.mi-calendar-value__marker')
    for (const forbidden of ['background', 'border', 'padding', 'cursor', 'text-decoration', 'pointer-events']) {
      expect(marker, `标记不许有 ${forbidden}`).not.toContain(forbidden)
    }
  })

  it('sits 4px from the value and never wraps', () => {
    const wrapper = rule('.mi-calendar-value')
    expect(wrapper).toContain('gap: 4px')
    expect(wrapper).toContain('white-space: nowrap')
    expect(wrapper).toContain('align-items: baseline')
  })

  it('leaves no class without a rule behind (the case that started this)', () => {
    // 那个类名已经不是「没 CSS」，是彻底没了；再出现即红。
    expect(css).not.toContain('mi-economic-calendar__consensus-source')
  })
})
