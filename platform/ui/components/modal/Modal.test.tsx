// @vitest-environment happy-dom

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { MODAL_ALIGNS, MODAL_LAYERS, MODAL_WIDTHS, Modal, type ModalProps } from './Modal'
import { MODAL_CLOSE_KEY, resolveModalText } from './modalText'

/**
 * 截下传给 antd `Modal` 的 props，同时照常渲染真正的组件——
 * `destroyOnHidden` 的卸载发生在关闭动画之后，happy-dom 不会跑完那段动画，
 * 所以「有没有原样交给 antd」是这一层能证明的事实，「关闭后卸载」归 antd。
 */
const passedProps = vi.hoisted(() => [] as Record<string, unknown>[])
vi.mock('antd', async (importOriginal) => {
  const actual = await importOriginal<typeof import('antd')>()
  return {
    ...actual,
    Modal: (props: Record<string, unknown>) => {
      passedProps.push(props)
      return <actual.Modal {...(props as never)} />
    }
  }
})

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
    width: 'standard',
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

describe('Modal 的宽度', () => {
  it('offers four widths and no fifth', () => {
    expect(MODAL_WIDTHS).toEqual(['compact', 'standard', 'expanded', 'maximum'])
  })

  it('measures each width from the one table, never from the call site', async () => {
    const expected: Record<string, string> = {
      compact: '420px',
      standard: '520px',
      expanded: '720px',
      maximum: '860px'
    }
    for (const [width, px] of Object.entries(expected)) {
      await mount({ width: width as ModalProps['width'] })
      expect(document.querySelector<HTMLElement>('.ant-modal')?.style.width).toBe(px)
      await act(async () => root?.unmount())
      root = undefined
      document.body.replaceChildren()
    }
  })
})

describe('Modal 的形态与层级', () => {
  it('offers two alignments and two layers, and no boolean or number for either', () => {
    expect(MODAL_ALIGNS).toEqual(['top', 'center'])
    expect(MODAL_LAYERS).toEqual(['base', 'over-drawer'])
  })

  it('leaves the dialog at the top by default and centres it on request', async () => {
    await mount()
    // 默认与 antd 一致：不居中。
    expect(document.querySelector('.ant-modal-centered')).toBeNull()

    await act(async () => root?.unmount())
    root = undefined
    document.body.replaceChildren()

    await mount({ align: 'center' })
    expect(document.querySelector('.ant-modal-centered')).not.toBeNull()
  })

  it('keeps the z-index numbers inside the component and only accepts a layer word', async () => {
    await mount({ layer: 'over-drawer' })
    const wrap = document.querySelector<HTMLElement>('.ant-modal-wrap')
    expect(wrap?.style.zIndex).toBe('1500')

    await act(async () => root?.unmount())
    root = undefined
    document.body.replaceChildren()

    await mount()
    // base 不跳到弹窗层：保持 antd 自己的默认，不在这里另写一个数字。
    expect(document.querySelector<HTMLElement>('.ant-modal-wrap')?.style.zIndex).not.toBe('1500')
  })

  it('fills a parameterised title and keeps a missing placeholder visible', async () => {
    const resolveText = (value: string): string => (value === 'ui.test.title' ? '技能 {name}' : value)
    await mount({ resolveText, titleParams: { name: '检索' } })
    expect(document.querySelector('.ant-modal-title')?.textContent).toBe('技能 检索')

    await act(async () => root?.unmount())
    root = undefined
    document.body.replaceChildren()

    // 缺参数原样保留：少一个名字看得见，比安静地少一个词好。
    await mount({ resolveText })
    expect(document.querySelector('.ant-modal-title')?.textContent).toBe('技能 {name}')
  })
})

describe('Modal 的生命周期开关', () => {
  it('keeps the content mounted after close when the caller omits destroyOnHidden', async () => {
    await mount({ children: <span data-probe="content">content</span> })
    expect(document.querySelector('[data-probe="content"]')).not.toBeNull()

    await act(async () => {
      root!.render(<Modal {...props({ open: false, children: <span data-probe="content">content</span> })} />)
    })
    await act(async () => {
      await Promise.resolve()
    })
    // 不传即 antd 默认：内容留在 DOM 里，下一次打开不会重新挂载。
    expect(document.querySelector('[data-probe="content"]')).not.toBeNull()
  })

  it('passes destroyOnHidden to antd only when the caller sets it', async () => {
    passedProps.length = 0
    await mount()
    // 不传就不发：没有隐式行为，也没有第二份「关闭即卸载」的实现。
    expect(passedProps.every((entry) => !('destroyOnHidden' in entry))).toBe(true)

    await act(async () => root?.unmount())
    root = undefined
    document.body.replaceChildren()

    passedProps.length = 0
    await mount({ destroyOnHidden: true })
    expect(passedProps.at(-1)?.destroyOnHidden).toBe(true)
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

  it('takes no pixel width, style, centered boolean or zIndex number', () => {
    const propsType = source.slice(source.indexOf('type ModalBase'), source.indexOf('export function Modal'))
    // 宽度只收档位名：`width: number` 或 `width: string` 都是口子。
    expect(propsType).toMatch(/width:\s*ModalWidth/)
    expect(propsType).not.toMatch(/width:\s*(number|string)/)
    for (const escape of ['style', 'centered', 'zIndex']) {
      expect(propsType).not.toMatch(new RegExp(`\\b${escape}\\b`))
    }
    // 样式文件里也不许提前长出一套宽度；读屏隐藏的 1px 是隐身旁路，不是档位。
    expect(css.replace(/\.modal__sr-only \{[\s\S]*?\}/, '')).not.toMatch(/\bwidth\s*:/)
  })
})
