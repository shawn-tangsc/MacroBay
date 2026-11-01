// @vitest-environment happy-dom

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { Drawer, DRAWER_SIZES, type DrawerProps } from './Drawer'
import { DRAWER_CLOSE_KEY, resolveDrawerText } from './drawerText'

/**
 * `min(420px, 92vw)` 这类值在 happy-dom 里会被样式解析器丢掉，量 `style.width` 只会得到空串。
 * 所以把传给 antd `Drawer` 的 props 拦下来断言，同时照常渲染真正的组件——DOM 行为照样测。
 */
const passedProps: Record<string, unknown>[] = []
vi.mock('antd', async (importOriginal) => {
  const actual = await importOriginal<typeof import('antd')>()
  const RealDrawer = actual.Drawer
  return {
    ...actual,
    Drawer: (props: Record<string, unknown>) => {
      passedProps.push(props)
      return <RealDrawer {...(props as never)} />
    }
  }
})

const source = readFileSync(join(__dirname, 'Drawer.tsx'), 'utf8')
const css = readFileSync(join(__dirname, 'drawer.css'), 'utf8')

/** 测试只证明「键被解析」，不替调用方造句。 */
const key = (value: string): string => value

let root: Root | undefined
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  document.body.replaceChildren()
})

function props(overrides: Partial<DrawerProps> = {}): DrawerProps {
  return {
    open: true,
    onClose: () => undefined,
    size: 'narrow',
    titleKey: 'ui.test.title',
    resolveText: key,
    children: <p data-body>content</p>,
    ...overrides
  } as DrawerProps
}

async function mount(overrides: Partial<DrawerProps> = {}): Promise<HTMLElement> {
  const host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => {
    root!.render(<Drawer {...props(overrides)} />)
  })
  return host
}

function wrapper(): HTMLElement | null {
  return document.querySelector<HTMLElement>('.ant-drawer-content-wrapper')
}

describe('Drawer', () => {
  it('offers four sizes and no fifth', () => {
    expect(DRAWER_SIZES).toEqual(['narrow', 'large', 'wide', 'full'])
  })

  it('measures each size from the one table, capped at 92vw', async () => {
    const expected: Record<string, string> = {
      narrow: 'min(420px, 92vw)',
      large: 'min(640px, 92vw)',
      wide: 'min(860px, 92vw)',
      full: 'min(1040px, 92vw)'
    }

    for (const [size, width] of Object.entries(expected)) {
      passedProps.length = 0
      await mount({ size: size as DrawerProps['size'] })
      expect(passedProps.at(-1)?.width).toBe(width)
      expect(wrapper()).not.toBeNull()
      await act(async () => root?.unmount())
      root = undefined
      document.body.replaceChildren()
    }
  })

  it('gives the close control one platform key, not a per-call sentence', async () => {
    await mount()

    const close = document.querySelector<HTMLButtonElement>('.ant-drawer-extra button')
    expect(close).not.toBeNull()
    // 关闭键的名字由组件自己的文案表给，不经过调用方的 `resolveText`——那条路会把未知键解析成空串。
    expect(close?.getAttribute('aria-label')).toBe(resolveDrawerText('zh-CN', DRAWER_CLOSE_KEY))
    expect(close?.getAttribute('aria-label')).toBe('关闭抽屉')
  })

  it('calls onClose from the close control', async () => {
    const onClose = vi.fn()
    await mount({ onClose })

    const close = document.querySelector<HTMLButtonElement>('.ant-drawer-extra button')!
    await act(async () => {
      close.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('renders no footer row at all when the caller passes none', async () => {
    await mount()
    expect(document.querySelector('.ant-drawer-footer')).toBeNull()
  })

  it('renders the footer the caller passes, word for word', async () => {
    await mount({ footer: <button type="button">Save</button> })
    expect(document.querySelector('.ant-drawer-footer')?.textContent).toBe('Save')
  })

  it('keeps the mask on modal and drops it on inline, with no boolean prop for it', async () => {
    await mount()
    expect(document.querySelector('.ant-drawer-mask')).not.toBeNull()

    await act(async () => root?.unmount())
    root = undefined
    document.body.replaceChildren()
    await mount({ mode: 'inline' })
    expect(document.querySelector('.ant-drawer-mask')).toBeNull()
  })

  it('takes the title from a key, never from a sentence', async () => {
    await mount()
    expect(document.querySelector('.drawer__title')?.textContent).toBe('ui.test.title')
    expect(source).not.toMatch(/title:\s*string/)
  })

  it('names a headless drawer instead of leaving an unnamed dialog', async () => {
    await mount({ header: 'none', ariaLabelKey: 'ui.test.aria' } as Partial<DrawerProps>)
    expect(document.querySelector('.drawer__sr-only')?.textContent).toBe('ui.test.aria')
  })

  it('takes no width, style, styles, mask, placement or closable escape hatch', () => {
    // 契约 §3：这些口子扫到即红，不靠 `@ts-expect-error`（那在测试文件里不跑）。
    for (const escape of ['width', 'style', 'styles', 'mask', 'closable', 'placement', 'getContainer']) {
      expect(source).not.toMatch(new RegExp(`${escape}\\s*[:=]\\s*\\{?\\s*(string|number|boolean|React)`))
    }
    // 我们自己的样式里不许给抽屉整体定宽（`.drawer__sr-only` 的 1px 是读屏隐藏用的）。
    expect(css).not.toMatch(/\.drawer(?:__panel)?\s*(?:,|\{)[^}]*\bwidth\s*:/)
  })
})
