import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  TASK_AUTOMATION_CONTROL_CLASSES,
  TASK_AUTOMATION_CONTROL_WIDTHS,
  TASK_AUTOMATION_SOURCE_POPUP_CLASS,
  TASK_AUTOMATION_SOURCE_POPUP_PROPS
} from './taskAutomationControlWidths'

const controlCase = [
  ['name', 240],
  ['source', 220],
  ['registration', 150],
  ['status', 150],
  ['policy', 180]
] as const

describe('task automation control widths', () => {
  it('pins every control to the agreed fixed width', () => {
    expect(TASK_AUTOMATION_CONTROL_WIDTHS).toEqual({
      name: 240,
      source: 220,
      registration: 150,
      status: 150,
      policy: 180
    })
  })

  it('backs every width constant with a fixed CSS class in styles.css', () => {
    const rules = cssRules()
    for (const [key, width] of controlCase) {
      const className = TASK_AUTOMATION_CONTROL_CLASSES[key]
      const body = rules.get(`.${className}`)
      expect(body, `.${className} must exist in styles.css`).toBeDefined()
      expect(body).toContain(`width: ${width}px`)
      expect(body).toContain('flex: 0 0 auto')
      expect(TASK_AUTOMATION_CONTROL_WIDTHS[key]).toBe(width)
    }
  })

  it('keeps the source popup at least as wide as its trigger and free of ellipsis', () => {
    expect(TASK_AUTOMATION_SOURCE_POPUP_PROPS.popupMatchSelectWidth).toBe(false)
    expect(TASK_AUTOMATION_SOURCE_POPUP_PROPS.styles.popup?.root?.minWidth)
      .toBe(TASK_AUTOMATION_CONTROL_WIDTHS.source)
    expect(TASK_AUTOMATION_SOURCE_POPUP_PROPS.classNames.popup?.root)
      .toBe(TASK_AUTOMATION_SOURCE_POPUP_CLASS)

    const rules = cssRules()
    expect(rules.get(`.${TASK_AUTOMATION_SOURCE_POPUP_CLASS}`)).toContain('min-width: 220px')
    const optionContent = rules.get(`.${TASK_AUTOMATION_SOURCE_POPUP_CLASS} .ant-select-item-option-content`)
    expect(optionContent).toContain('text-overflow: clip')
    expect(optionContent).toContain('overflow: visible')
    expect(optionContent).not.toContain('ellipsis')
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
