// @vitest-environment happy-dom

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { Modal, type ModalProps } from './Modal'
import { MODAL_CLOSE_KEY, resolveModalText } from './modalText'

const source = readFileSync(join(__dirname, 'Modal.tsx'), 'utf8')
const css = readFileSync(join(__dirname, 'modal.css'), 'utf8')

/** 测试只证明「键被解析」，不替调用方造句。 */
const key = (value: string): string => value

let root: Root | undefined
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  document.body.replaceChildren()
})

function props(overrides: Partial<ModalProps> = {}): ModalProps {
  return {
    open: true,
    onClose: () => undefined,
    titleKey: 'ui.test.title',
    resolveText: key,
    children: <p data-body>content</p>,
    ...overrides
  } as ModalProps
}

async function mount(overrides: Partial<ModalProps> = {}): Promise<HTMLElement> {
  const host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => {
    root!.render(<Modal {...props(overrides)} />)
  })
  // antd 的面板走 portal、首帧后才挂载，flush 一次再断言。
  await act(async () => {
    await Promise.resolve()
  })
  return host
}

function dialog(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[role="dialog"]')
}

function closeButton(): HTMLButtonElement | null {
  return document.querySelector<HTMLButtonElement>('.ant-modal-close')
}

describe('Modal 的标题与读屏名', () => {
  it('resolves the visible title from a key, never from a sentence', async () => {
    await mount()
    const title = document.querySelector('.ant-modal-title')
    expect(title?.textContent).toBe('ui.test.title')
    expect(source).not.toMatch(/title:\s*string/)
  })

  it('points aria-labelledby at the title it rendered', async () => {
    await mount()
    const labelledBy = dialog()?.getAttribute('aria-labelledby')
    expect(labelledBy).toBeTruthy()
    expect(document.getElementById(labelledBy!)?.textContent).toBe('ui.test.title')
  })

  it('names a headless dialog instead of leaving an unnamed one, and hides the title bar', async () => {
    await mount({ titleKey: undefined, ariaLabelKey: 'ui.test.aria' } as Partial<ModalProps>)

    const title = document.querySelector('.ant-modal-title')
    expect(title?.textContent).toBe('ui.test.aria')
    // 名字仍在，只是视觉隐藏：它必须是 `aria-labelledby` 的落点。
    expect(dialog()?.getAttribute('aria-labelledby')).toBe(title?.id)
    // 标题栏整块不占位置。
    const header = document.querySelector<HTMLElement>('.ant-modal-header')
    expect(header).not.toBeNull()
    expect(header?.style.display).toBe('none')
  })

  it('does not fall back to the key name when the resolver returns nothing', async () => {
    await mount({ resolveText: () => '' })
    // 未知键返回空串是调用方的约定；组件不替它把键名念给用户。
    expect(document.querySelector('.ant-modal-title')?.textContent).toBe('')
  })
})

describe('Modal 的关闭键', () => {
  it('takes its name from the component table, not from the caller resolver', async () => {
    await mount()
    const close = closeButton()
    expect(close).not.toBeNull()
    expect(close?.getAttribute('aria-label')).toBe(resolveModalText('zh-CN', MODAL_CLOSE_KEY))
    expect(close?.getAttribute('aria-label')).toBe('关闭弹窗')
  })

  it('keeps a name even when the caller resolver resolves every key to empty', async () => {
    // 这条是 drawer 踩出来的：关闭键是按钮唯一的名字，走 `resolveText` 就会没有名字。
    await mount({ resolveText: () => '' })
    expect(closeButton()?.getAttribute('aria-label')).toBe('关闭弹窗')
  })

  it('is not left to the caller: no closable prop is exposed', () => {
    const propsType = source.slice(source.indexOf('export type ModalProps'), source.indexOf('export function Modal'))
    expect(propsType).not.toMatch(/\bclosable\b/)
  })
})

describe('Modal 的打开态与关闭', () => {
  it('calls onClose from the close control', async () => {
    const onClose = vi.fn()
    await mount({ onClose })

    await act(async () => {
      closeButton()!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('closes on Escape without a second keyboard implementation of our own', async () => {
    const onClose = vi.fn()
    await mount({ onClose })

    const wrap = document.querySelector<HTMLElement>('.ant-modal-wrap')!
    await act(async () => {
      // rc-dialog 判的是 `keyCode`（`Dialog/index.js:135`），只给 `key` 它收不到。
      wrap.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true } as never))
    })
    expect(onClose).toHaveBeenCalledTimes(1)
    // 键盘归 antd：组件源码里没有自己的 keydown 监听。
    expect(source).not.toMatch(/addEventListener\('keydown'/)
  })
})

describe('Modal 的页脚槽', () => {
  it('renders no footer row at all when the caller passes none', async () => {
    await mount()
    // antd 的默认页脚是「确定/取消」；不传也必须整块不渲染。
    expect(document.querySelector('.ant-modal-footer')).toBeNull()
  })

  it('renders the footer the caller passes, word for word', async () => {
    await mount({ footer: <button type="button">Save</button> })
    expect(document.querySelector('.ant-modal-footer')?.textContent).toBe('Save')
  })
})

describe('Modal 的边界', () => {
  it('passes the caller className through and adds no business class', async () => {
    await mount({ className: 'legacy-dialog' })
    const rendered = dialog()
    expect(rendered?.classList.contains('legacy-dialog')).toBe(true)
    expect(rendered?.classList.contains('modal')).toBe(true)
  })

  it('takes no width, style, centered or layer prop while the spec is open', () => {
    const propsType = source.slice(source.indexOf('type ModalBase'), source.indexOf('export function Modal'))
    for (const escape of ['width', 'style', 'centered', 'zIndex', 'layer']) {
      expect(propsType).not.toMatch(new RegExp(`\\b${escape}\\b`))
    }
    // 样式文件里也不许提前长出一套宽度；读屏隐藏的 1px 是隐身旁路，不是档位。
    expect(css.replace(/\.modal__sr-only \{[\s\S]*?\}/, '')).not.toMatch(/\bwidth\s*:/)
  })
})
