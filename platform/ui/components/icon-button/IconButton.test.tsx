// @vitest-environment happy-dom

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { HelpCircle } from 'lucide-react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ICON_BUTTON_SIZES, IconButton, type IconButtonProps } from './IconButton'

const source = readFileSync(join(__dirname, 'IconButton.tsx'), 'utf8')
const css = readFileSync(join(__dirname, 'iconButton.css'), 'utf8')
/** 断言只看规则，不看注释：注释里写「不许 outline:none」不该让守卫自己变红。 */
const rules = css.replace(/\/\*[\s\S]*?\*\//g, '')

/** 测试只证明「键被解析」，不替调用方造句。 */
const shirts = (value: string): string => value

let root: Root | undefined
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  document.body.replaceChildren()
})

function props(overrides: Partial<IconButtonProps> = {}): IconButtonProps {
  return {
    ariaLabelKey: 'ui.test.more-actions',
    icon: HelpCircle,
    size: 'md',
    onSelect: () => undefined,
    resolveText: shirts,
    ...overrides
  }
}

function markup(overrides: Partial<IconButtonProps> = {}): string {
  return renderToStaticMarkup(<IconButton {...props(overrides)} />)
}

function mountElement(overrides: Partial<IconButtonProps> = {}): HTMLButtonElement {
  const host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  renderButton(root, overrides)
  const button = host.querySelector('button')
  if (!button) throw new Error('IconButton rendered no button')
  return button
}

function renderButton(target: Root, overrides: Partial<IconButtonProps> = {}): void {
  act(() => {
    target.render(<IconButton {...props(overrides)} />)
  })
}

describe('IconButton', () => {
  it('takes the screen-reader name from the resolver, never from the raw key', () => {
    const seen: string[] = []
    const resolved = (value: string): string => {
      seen.push(value)
      return 'More actions'
    }

    const html = markup({ ariaLabelKey: 'ui.test.more-actions', resolveText: resolved })

    expect(html).toContain('aria-label="More actions"')
    expect(html).not.toContain('ui.test.more-actions')
    expect(seen).toEqual(['ui.test.more-actions'])
  })

  it('is a plain button, so it can never submit a surrounding form', () => {
    expect(markup()).toContain('type="button"')
  })

  it('measures exactly the requested size, in pixels, on the element itself', () => {
    expect(markup({ size: 'sm' })).toContain('style="width:22px;height:22px"')
    expect(markup({ size: 'md' })).toContain('style="width:24px;height:24px"')
  })

  it('offers only the two sizes the spec allows, in the shared size vocabulary', () => {
    expect(ICON_BUTTON_SIZES).toEqual(['sm', 'md'])
    expect(source).not.toMatch(/size:\s*(18|20|26)\b/)
    expect(rules).not.toMatch(/(18|20|26)px/)
  })

  it('rejects a pixel size at compile time', () => {
    // @ts-expect-error 尺寸只有 sm / md 两档；收数字等于让 18 / 20 / 26 重新长回来。
    const numeric: IconButtonProps = { ...props(), size: 22, icon: HelpCircle }

    expect(numeric).toBeDefined()
  })

  it('keeps the glyph decorative, so the name is spoken once', () => {
    const html = markup()
    expect(html).toContain('aria-hidden="true"')
    expect(html).toContain('<svg')
  })

  it('wears the one focus ring: 2px accent, offset 2, never removed without a replacement', () => {
    expect(rules).toContain('outline: 2px solid var(--accent)')
    expect(rules).toContain('outline-offset: 2px')
    expect(rules).not.toMatch(/outline:\s*none/)
  })

  it('is plain by default and gains a border only in the toolbar variant', () => {
    expect(markup()).not.toContain('icon-button--solid')
    expect(markup({ variant: 'solid' })).toContain('icon-button--solid')
    expect(rules).toContain('.icon-button--solid')
  })

  it('leaves the tab order and stops firing when disabled', () => {
    const onSelect = vi.fn()
    const button = mountElement({ disabled: true, onSelect })

    expect(button.disabled).toBe(true)
    act(() => button.click())
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('fires on click when enabled', () => {
    const onSelect = vi.fn()
    const button = mountElement({ onSelect })

    expect(button.disabled).toBe(false)
    act(() => button.click())
    expect(onSelect).toHaveBeenCalledTimes(1)
  })

  it('resolves the tooltip copy through the same resolver and never uses a native title', () => {
    const seen: string[] = []
    const resolved = (value: string): string => {
      seen.push(value)
      return value
    }

    const html = markup({ tooltipKey: 'ui.test.hint', resolveText: resolved })

    expect(seen).toContain('ui.test.hint')
    expect(html).not.toMatch(/<button[^>]*\stitle=/)
  })

  it('carries no copy of its own: no literal Chinese outside comments, no spinner, no motion', () => {
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

    expect(code).not.toMatch(/[\u4e00-\u9fff]/)
    expect(code).not.toMatch(/spinner/i)
    expect(rules).not.toMatch(/@keyframes|animation/)
  })
})
