import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 智能体「基础」页的三个模型字段：选择器触发器默认是 260–420px 的固定宽度，
 * 放进 860px 抽屉的 230px 导航 + 28px 内边距后正文只剩 ~574px。三列并列时每列不到 200px，
 * 触发器会溢出列宽、压到相邻字段上（文字互相重叠）。这里锁死「每个模型字段各占一行、
 * 触发器填满字段」的约束，避免宽度回退。
 */
describe('agent basic section model field layout', () => {
  it('puts every model field on its own row', () => {
    expect(cssRules().get('.agent-form-grid')).toContain('grid-template-columns: minmax(0, 1fr)')
  })

  it('lets the picker fill the field instead of overflowing into the next column', () => {
    const trigger = cssRules().get('.agent-form-grid .model-picker-trigger')
    expect(trigger).toContain('width: 100%')
    expect(trigger).toContain('min-width: 0')
    expect(trigger).toContain('max-width: none')
  })

  it('keeps the standalone picker fixed width so the form override stays necessary', () => {
    expect(cssRules().get('.model-picker-trigger')).toContain('min-width: 260px')
  })
})

function cssRules(): Map<string, string> {
  const css = readFileSync(resolve(process.cwd(), 'apps/desktop-shell/src/renderer/src/styles.css'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
  const rules = new Map<string, string>()
  for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    for (const selector of match[1].split(',')) rules.set(selector.trim(), match[2])
  }
  return rules
}
