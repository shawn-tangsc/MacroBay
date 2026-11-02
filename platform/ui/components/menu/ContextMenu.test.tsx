// @vitest-environment happy-dom

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ContextMenu, MENU_TONES, type ContextMenuProps, type MenuItem } from './index'

const source = readFileSync(join(__dirname, 'ContextMenu.tsx'), 'utf8')
const itemSource = readFileSync(join(__dirname, 'menuItem.ts'), 'utf8')
const css = readFileSync(join(__dirname, 'contextMenu.css'), 'utf8')
const rules = css.replace(/\/\*[\s\S]*?\*\//g, '')

/** 测试只证明「键被解析」，不替调用方造句。 */
const key = (value: string): string => value

const ITEMS: MenuItem[] = [
  { key: 'translate', labelKey: 'ui.menu.translate' },
  { key: 'copy', labelKey: 'ui.menu.copy', disabled: true },
  { key: 'delete', labelKey: 'ui.menu.delete', tone: 'danger' }
]

let root: Root | undefined
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  document.body.replaceChildren()
})

function props(overrides: Partial<ContextMenuProps> = {}): ContextMenuProps {
  return {
    open: true,
    anchor: { x: 40, y: 60 },
    items: ITEMS,
    onSelect: () => undefined,
    onClose: () => undefined,
    ariaLabelKey: 'ui.menu.row-actions',
    resolveText: key,
    ...overrides
  }
}

async function mount(overrides: Partial<ContextMenuProps> = {}): Promise<HTMLDivElement> {
  const host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => {
    root!.render(<ContextMenu {...props(overrides)} />)
  })
  return host
}

function menu(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-context-menu]')
}

function items(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('[data-context-menu] [role="menuitem"]')]
}

describe('ContextMenu', () => {
  it('renders nothing while closed — no empty shell left in the layout', async () => {
    await mount({ open: false })
    expect(menu()).toBeNull()
  })

  it('renders a menu with the resolved accessible name, not the raw key', async () => {
    await mount()
    const list = document.querySelector('[data-context-menu] [role="menu"]')
    expect(list).not.toBeNull()
    expect(list?.getAttribute('aria-label')).toBe('ui.menu.row-actions')
  })

  it('resolves every item label through the caller and never prints the key', async () => {
    await mount()
    const labels = items().map((item) => item.textContent)
    expect(labels).toEqual(['ui.menu.translate', 'ui.menu.copy', 'ui.menu.delete'])
  })

  it('hands back the item key, never the index, and then closes', async () => {
    const onSelect = vi.fn()
    const onClose = vi.fn()
    await mount({ onSelect, onClose })

    const deleteItem = items()[2]
    await act(async () => {
      deleteItem.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(onSelect).toHaveBeenCalledTimes(1)
    expect(onSelect).toHaveBeenCalledWith('delete')
    expect(onClose).toHaveBeenCalled()
  })

  it('does not fire for a disabled item', async () => {
    const onSelect = vi.fn()
    await mount({ onSelect })

    await act(async () => {
      items()[1].dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(onSelect).not.toHaveBeenCalled()
  })

  it('closes on Escape and on a click outside, but not on a click inside', async () => {
    const onClose = vi.fn()
    await mount({ onClose })

    await act(async () => {
      items()[0].dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }))
    })
    expect(onClose).not.toHaveBeenCalled()

    await act(async () => {
      document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }))
    })
    expect(onClose).toHaveBeenCalledTimes(1)

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('marks the danger item with the danger style and takes the colour from the token', async () => {
    await mount()

    expect(items()[2].className).toContain('ant-menu-item-danger')
    // 正文色要过 4.5 对比度，所以是混过 `--text-strong` 的 `--danger`，不是纯 token 直出。
    expect(rules).toMatch(/\.context-menu \.ant-menu-item-danger[\s\S]*?color: color-mix\(in srgb, var\(--danger\)/)
    // 危险项不许由调用方传颜色：组件只认闭集里的 'danger'。
    expect(MENU_TONES).toEqual(['default', 'danger'])
    expect(itemSource).not.toMatch(/\bcolor\s*[:?]/)
  })

  it('takes focus into the menu and hands arrow-key navigation to antd', async () => {
    await mount()

    // 打开即聚焦第一项：Shift+F10 之后上/下键必须立刻可用。
    expect(document.activeElement).toBe(items()[0])

    // 上下键由 antd 的菜单实现接管（它会 preventDefault 防止页面滚动并排一帧后挪焦点）；
    // 组件自己**不**再写一套键盘处理，所以这里断言「按键被消费」，不追它的内部帧。
    const down = new KeyboardEvent('keydown', { key: 'ArrowDown', keyCode: 40, which: 40, bubbles: true, cancelable: true })
    await act(async () => {
      items()[0].dispatchEvent(down)
    })

    expect(down.defaultPrevented).toBe(true)
    expect(source).not.toMatch(/ArrowDown|ArrowUp|onKeyDown/)
  })

  it('keeps itself inside the viewport when opened near the edge', async () => {
    await mount({ anchor: { x: window.innerWidth - 2, y: window.innerHeight - 2 } })

    const shell = menu()
    expect(shell).not.toBeNull()
    expect(Number.parseFloat(shell!.style.left)).toBeLessThanOrEqual(window.innerWidth)
    expect(Number.parseFloat(shell!.style.top)).toBeLessThanOrEqual(window.innerHeight)
    expect(Number.parseFloat(shell!.style.left)).toBeGreaterThanOrEqual(4)
    expect(Number.parseFloat(shell!.style.top)).toBeGreaterThanOrEqual(4)
  })

  it('holds no copy of its own and no second menu implementation', () => {
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    expect(code).not.toMatch(/[\u4e00-\u9fa5]/)
    // 菜单列表必须是 antd 的实现，不是自己再画一套列表：本文件里没有手写的菜单行元素。
    expect(source).toContain("from 'antd'")
    expect(code).not.toMatch(/<li\b/)
    expect(code).not.toMatch(/\blabel\s*:\s*['"`]/)
  })
})
