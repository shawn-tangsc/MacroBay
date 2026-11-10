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
      return <RealDrawer {...(props as React.ComponentProps<typeof RealDrawer>)} />
    }
  }
})

const source = readFileSync(join(__dirname, 'Drawer.tsx'), 'utf8')
const css = readFileSync(join(__dirname, 'drawer.css'), 'utf8')

/** 测试只证明「键被解析」，不替调用方造句。 */
const key = (value: string): string => value

let root: Root | undefined

afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  document.body.replaceChildren()
})

function props(overrides: Partial<DrawerProps> = {}): DrawerProps {
  return {
    open: true,
    onClose: () => undefined,
    mode: 'modal',
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

describe('Drawer 的 destroyOnHidden 透传', () => {
  it('不传就不发：我们没有偷偷改 antd 的默认行为', async () => {
    passedProps.length = 0
    const host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)

    act(() => {
      root!.render(
        <Drawer mode="modal" open onClose={() => undefined} size="narrow" titleKey="ui.test.title" resolveText={key}>
          <span data-probe="content">content</span>
        </Drawer>
      )
    })

    // antd 的面板走 portal、且首帧后才挂载，flush 一次再断言「开着的时候内容在」。
    await act(async () => {
      await Promise.resolve()
    })

    expect(passedProps.every((props) => !('destroyOnHidden' in props))).toBe(true)
    // 面板挂在 body 的 portal 里，不在我们自己的 host 下。
    expect(document.body.querySelector('[data-probe="content"]')).not.toBeNull()
  })

  it('传 true 时原样交给 antd，关闭后子树被卸载', () => {
    passedProps.length = 0
    const host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)

    const render = (open: boolean): void => {
      act(() => {
        root!.render(
          <Drawer
            mode="modal"
            open={open}
            onClose={() => undefined}
            size="narrow"
            titleKey="ui.test.title"
            resolveText={key}
            destroyOnHidden>
            <span data-probe="content">content</span>
          </Drawer>
        )
      })
    }

    render(true)
    expect(passedProps.at(-1)?.destroyOnHidden).toBe(true)
    expect(document.body.querySelector('[data-probe="content"]')).not.toBeNull()

    render(false)
    // 断言子节点是否存在，不断言 antd 内部类名——后者等于把实现细节写进我们的测试。
    expect(document.body.querySelector('[data-probe="content"]')).toBeNull()
  })
})

describe('Drawer', () => {
  it('offers four sizes and no fifth', () => {
    expect(DRAWER_SIZES).toEqual(['narrow', 'large', 'wide', 'full'])
  })

  it('measures each size from the one table, capped at 94vw', async () => {
    const expected: Record<string, string> = {
      narrow: 'min(420px, 94vw)',
      large: 'min(640px, 94vw)',
      wide: 'min(860px, 94vw)',
      full: 'min(1280px, 94vw)'
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

  it('opens an inline panel without moving focus, and closes it on Escape from anywhere', async () => {
    // 改之前这条是红的：inline 走 antd 默认 autoFocus、又关掉了 keyboard，
    // 于是「焦点被拽进面板」且「按 Esc 毫无反应」——两个毛病一起被这条钉住。
    const trigger = document.createElement('button')
    document.body.append(trigger)
    trigger.focus()
    expect(document.activeElement).toBe(trigger)

    const onClose = vi.fn()
    await mount({ mode: 'inline', onClose })

    // ① 打开不移动焦点：读者正在页面上操作，把他拽进面板就是丢位置。
    expect(document.activeElement).toBe(trigger)
    // 也不许偷偷换一种写法：antd 收到的是显式的 autoFocus=false。
    expect(passedProps.at(-1)?.autoFocus).toBe(false)

    // ② 焦点在面板外面，Esc 仍要关得掉。
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(onClose).toHaveBeenCalledTimes(1)

    // ③ 关闭后焦点仍然在原处（没进过面板，也就没有「还回去」这回事）。
    expect(document.activeElement).toBe(trigger)
  })

  it('leaves modal focus behaviour exactly to antd', async () => {
    await mount()
    // 浮层不传 autoFocus：锁焦点、Esc 都归 antd，我们不在这里改第二个模式的行为。
    expect(passedProps.at(-1)?.autoFocus).toBeUndefined()
  })

  it('puts the action slot left of the close control, and keeps the title first', async () => {
    const host = await mount({
      titleExtra: <span data-title-extra>?</span>,
      actions: <button data-actions type="button">send</button>
    })

    const header = document.querySelector('.ant-drawer-header')
    expect(header).not.toBeNull()
    const html = header?.innerHTML ?? ''
    // 顺序固定：标题 → 标题旁解释 → 右端动作 → 关闭。
    // 分组节点本身先出现，动作在分组里、关闭在动作之后：顺序按开标签算。
    const order = ['drawer__title-row', 'data-title-extra', 'drawer__header-actions', 'data-actions'].map((marker) =>
      html.indexOf(marker)
    )
    expect(order.every((index) => index > -1)).toBe(true)
    expect(order).toEqual([...order].sort((a, b) => a - b))
    // 动作槽在关闭键**左侧**：同一个分组里，动作在前、关闭在后。
    const group = document.querySelector('.drawer__header-actions')
    expect(group?.lastElementChild?.tagName).toBe('BUTTON')
    expect(group?.querySelector('[data-actions]')).not.toBeNull()
    void host
  })

  it('never lets the title push the close control', () => {
    // 缩短优先级 关闭键 > 动作 > 标题：关闭键所在分组 `flex: none`，标题可缩且有 `min-width: 0`。
    const rules = css.replace(/\/\*[\s\S]*?\*\//g, '')
    expect(rules).toMatch(/\.drawer__header-actions\s*\{[^}]*flex:\s*none/)
    expect(rules).toMatch(/\.drawer__title-row\s*\{[^}]*flex:\s*1 1 auto/)
    expect(rules).toMatch(/\.drawer__title-row\s*\{[^}]*min-width:\s*0/)
  })

  it('caps the action at 45% of the header, not of its own content-sized group', () => {
    // 2026-11-08 退回重做：`max-width: 45%` 挂在 `flex: none` 的分组里，百分比对宽度未定的盒子
    // 会先按内容算，于是上限成了「分组宽 × 45%」，分组却保留未压缩的宽度——关闭键被推到中间
    // （602px 头实测 ✕ 距右缘 148.7px）。所以参照物必须是**头**：头声明容器，上限用 `cqw`。
    const rules = css.replace(/\/\*[\s\S]*?\*\//g, '')
    expect(rules).toMatch(/\.drawer \.ant-drawer-header\s*\{[^}]*container-type:\s*inline-size/)
    expect(rules).toMatch(/\.drawer__actions\s*\{[^}]*max-width:\s*45cqw/)
    // 反向：一旦退回裸百分比，参照物又变回分组，这条必须红。
    expect(rules).not.toMatch(/\.drawer__actions\s*\{[^}]*max-width:\s*\d+%/)
    expect(rules).toMatch(/\.drawer__actions\s*\{[^}]*flex:\s*0 0 auto/)
    // 槽内文字自己有省略号：槽是通用的，里面放什么由调用方决定。
    expect(rules).toMatch(/\.drawer__actions\s*>\s*\*\s*\{[^}]*text-overflow:\s*ellipsis/)
    // 动作槽与关闭键之间的 12px 写在组件里，不是调用方传的。
    expect(rules).toMatch(/\.drawer__header-actions\s*\{[^}]*gap:\s*12px/)
  })

  it('keeps the close control as the last element of the unsqueezed group', async () => {
    await mount({ actions: <button data-actions type="button">send</button> })
    // happy-dom 不做布局，这里**证明不了**「✕ 距右缘 ≤1px」。所以只断言能机械判的两件事：
    // 关闭键是分组里最后一个元素（`flex: none` 的分组本身不被压缩），以及上限的参照物是头。
    // 真实数值由浏览器量：`docs-private/05-desktop/ui-audit/evidence/drawer/measure-header-slot.html`
    // 在 602px 长文案下实测 ✕ 距右缘 0px、动作 270.9（=602×45%）、间距 12；退回裸百分比时同页量到 148.7px。
    const group = document.querySelector('.drawer__header-actions')
    expect(group).not.toBeNull()
    expect(group?.lastElementChild?.tagName).toBe('BUTTON')

    const rules = css.replace(/\/\*[\s\S]*?\*\//g, '')
    expect(rules).toMatch(/\.drawer__header-actions\s*\{[^}]*flex:\s*none/)
  })

  it('takes no gap or width for the slot: the caller cannot resize the header', () => {
    // 一旦开了「调用方传间距」，两个调用点就会传 8 和 16，平台这边就没有比例可言了。
    expect(source).not.toMatch(/actionsGap|actionsWidth|actionsStyle|actionsClassName/)
    expect(source).toMatch(/actions\?:\s*ReactElement/)
    // 12 是组件自己的决定，写死在样式里，不是变量、不是 prop。
    expect(css).toMatch(/gap:\s*12px/)
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

  it('rejects a side on a modal and a titleExtra on a headless drawer', () => {
    // 这两条只是留档：`@ts-expect-error` 在 platform 的测试里不参与 `tsc`（§15），
    // 真正的证据是消费方调用点的 typecheck 变红。留在这里是为了说明「为什么这么分」。
    // @ts-expect-error 浮层一律右置，`side` 只活在 inline 分支。
    const sideOnModal: DrawerProps = { open: true, onClose: () => undefined, size: 'narrow', mode: 'modal', titleKey: 'k', side: 'left', resolveText: key, children: null }
    // @ts-expect-error 无头抽屉没有标题行，`titleExtra` 无处可放。
    const extraOnHeadless: DrawerProps = { open: true, onClose: () => undefined, size: 'narrow', mode: 'modal', header: 'none', ariaLabelKey: 'ui.test.aria', titleExtra: null, resolveText: key, children: null }

    expect(sideOnModal).toBeDefined()
    expect(extraOnHeadless).toBeDefined()
  })

  it('takes no width, style, styles, mask, placement or closable escape hatch', () => {
    // 契约 §3：这些口子扫到即红，不靠 `@ts-expect-error`（那在测试文件里不跑）。
    for (const escape of ['width', 'style', 'styles', 'mask', 'closable', 'placement', 'getContainer']) {
      expect(source).not.toMatch(new RegExp(`${escape}\\s*[:=]\\s*\\{?\\s*(string|number|boolean|React)`))
    }
    // 我们自己的样式里不许给抽屉整体定宽（`.drawer__sr-only` 的 1px 是读屏隐藏用的）。
    expect(css).not.toMatch(/\.drawer(?:__panel)?\s*(?:,|\{)[^}]*\bwidth\s*:/)
  })

  it('fills a parameterised title and keeps a missing placeholder visible', () => {
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    const resolve = (value: string): string => (value === 'ui.test.counted' ? 'Gaps ({count})' : value)

    act(() => {
      root.render(
        <Drawer
          open
          mode="modal"
          size="narrow"
          titleKey="ui.test.counted"
          titleParams={{ count: '3' }}
          onClose={() => undefined}
          resolveText={resolve}>
          <p>body</p>
        </Drawer>
      )
    })
    expect(document.body.textContent).toContain('Gaps (3)')

    act(() => {
      root.render(
        <Drawer
          open
          mode="modal"
          size="narrow"
          titleKey="ui.test.counted"
          titleParams={{}}
          onClose={() => undefined}
          resolveText={resolve}>
          <p>body</p>
        </Drawer>
      )
    })
    // 缺参时占位符原样留着：读者看得见「这里少了一个数」，组件不替调用方猜。
    expect(document.body.textContent).toContain('Gaps ({count})')

    act(() => root.unmount())
    host.remove()
  })
})
