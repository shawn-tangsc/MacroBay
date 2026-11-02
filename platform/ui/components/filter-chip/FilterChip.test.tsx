// @vitest-environment happy-dom

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { FilterChip, FilterChipGroup, type FilterChipProps } from './FilterChip'

const source = readFileSync(join(__dirname, 'FilterChip.tsx'), 'utf8')
const css = readFileSync(join(__dirname, 'filterChip.css'), 'utf8')
/** 断言只看规则，不看注释。 */
const rules = css.replace(/\/\*[\s\S]*?\*\//g, '')

const key = (value: string): string => value

let root: Root | undefined

afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  document.body.replaceChildren()
})

function props(overrides: Partial<FilterChipProps> = {}): FilterChipProps {
  return {
    labelKey: 'ui.test.category',
    count: '3',
    pressed: false,
    onPressedChange: () => undefined,
    resolveText: key,
    ...overrides
  }
}

function mount(overrides: Partial<FilterChipProps> = {}): HTMLButtonElement {
  const host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  act(() => {
    root!.render(<FilterChip {...props(overrides)} />)
  })
  const button = host.querySelector('button')
  if (!button) throw new Error('FilterChip rendered no button')
  return button
}

describe('FilterChip', () => {
  it('renders the resolved label with the already-formatted count to its right', () => {
    const button = mount({
      count: '1.2k',
      resolveText: (value) => (value === 'ui.test.category' ? '协议' : '')
    })
    const label = button.querySelector('.filter-chip__label')
    const count = button.querySelector('.filter-chip__count')

    expect(label?.textContent).toBe('协议')
    expect(count?.textContent).toBe('1.2k')
    // 计数在文字右侧；组件不重新格式化 `1.2k`。
    expect(label!.compareDocumentPosition(count!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('omits the count element when the caller gives none', () => {
    const button = mount({ count: undefined })
    expect(button.querySelector('.filter-chip__count')).toBeNull()
  })

  it('maps pressed to aria-pressed, and the click hands back the next value', () => {
    const onPressedChange = vi.fn()
    const off = mount({ pressed: false, onPressedChange })
    expect(off.getAttribute('aria-pressed')).toBe('false')

    act(() => off.click())
    expect(onPressedChange).toHaveBeenLastCalledWith(true)

    act(() => root?.unmount())
    root = undefined
    document.body.replaceChildren()

    const on = mount({ pressed: true, onPressedChange })
    expect(on.getAttribute('aria-pressed')).toBe('true')
    act(() => on.click())
    expect(onPressedChange).toHaveBeenLastCalledWith(false)
  })

  it('uses aria-pressed as the only selected-state source', () => {
    // 样式与读屏同源：选中只能由属性选择器画，不能另有一个 `.on` 类或 `data-active`。
    expect(rules).toContain("[aria-pressed='true']")
    expect(rules).not.toMatch(/\.on\b|data-active/)
    expect(source).not.toMatch(/className=.*pressed/)
  })

  it('reserves opacity for disabled, never for "not selected"', () => {
    const opacityRules = rules.split('}').filter((rule) => /opacity\s*:/.test(rule))
    expect(opacityRules.length).toBeGreaterThan(0)
    for (const rule of opacityRules) expect(rule).toMatch(/:disabled/)
  })

  it('keeps the three visual rules: 24 high, pill radius, key-only count', () => {
    expect(rules).toMatch(/height:\s*24px/)
    expect(rules).toMatch(/border-radius:\s*999px/)
    expect(rules).toMatch(/outline:\s*2px solid var\(--accent\)/)
    // 计数是字符串：组件不接数字，也不做第二次格式化。
    expect(source).toMatch(/count\?:\s*string/)
    expect(source).not.toMatch(/count\?:\s*number/)
  })

  it('carries no icon, tone, colour or tooltip escape hatch', () => {
    const propsType = source.slice(source.indexOf('type FilterChipBase'), source.indexOf('export type FilterChipGroupProps'))
    for (const escape of ['icon', 'tone', 'color', 'tooltip', 'className', 'style']) {
      expect(propsType).not.toMatch(new RegExp(`\\b${escape}\\b`))
    }
  })

  it('disables natively and shows no hover-only explanation', () => {
    const button = mount({ disabled: true })
    expect(button.hasAttribute('disabled')).toBe(true)
    expect(button.hasAttribute('title')).toBe(false)
  })
})

describe('FilterChipGroup', () => {
  it('names the group from a key and renders its chips inside role="group"', () => {
    const host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    act(() => {
      root!.render(
        <FilterChipGroup ariaLabelKey="ui.test.category-group" resolveText={(value) => (value === 'ui.test.category-group' ? '分类' : value)}>
          <FilterChip {...props()} />
        </FilterChipGroup>
      )
    })

    const group = host.querySelector('[role="group"]')
    expect(group?.getAttribute('aria-label')).toBe('分类')
    expect(group?.querySelector('button')).not.toBeNull()
  })
})
