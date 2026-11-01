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

  it('fills the entity name into the label template instead of taking a whole sentence', () => {
    const html = markup({
      ariaLabelKey: 'macro.icon.open-in-calendar',
      ariaLabelParams: { name: 'CPI' },
      resolveText: (value) => (value === 'macro.icon.open-in-calendar' ? 'Open {name} in the calendar' : value)
    })

    expect(html).toContain('aria-label="Open CPI in the calendar"')
    expect(html).not.toContain('{name}')
  })

  it('leaves a missing parameter visible instead of dropping the phrase', () => {
    // 静默删掉整段会得到「Open in the calendar」——读得通，但指错了对象。
    const html = markup({
      ariaLabelKey: 'macro.icon.open-in-calendar',
      ariaLabelParams: { other: 'CPI' },
      resolveText: (value) => (value === 'macro.icon.open-in-calendar' ? 'Open {name} in the calendar' : value)
    })

    expect(html).toContain('aria-label="Open {name} in the calendar"')
  })

  it('leaves a template without placeholders untouched when no parameters are passed', () => {
    const html = markup({ resolveText: (value) => (value === 'ui.test.more-actions' ? 'More actions' : value) })

    expect(html).toContain('aria-label="More actions"')
  })

  it('shows the platform spinner and stops firing while loading', () => {
    const onSelect = vi.fn()
    const button = mountElement({ loading: true, onSelect })

    expect(button.disabled).toBe(true)
    expect(button.querySelector('.loading-spinner')).not.toBeNull()
    act(() => button.click())
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('keeps its name and its measured size while loading', () => {
    const button = mountElement({
      loading: true,
      ariaLabelKey: 'ui.test.save',
      resolveText: (value) => (value === 'ui.test.save' ? 'Save' : value)
    })

    // 读屏仍要知道「哪个按钮在忙」；尺寸不变，说明 loading 不是第三个档位。
    expect(button.getAttribute('aria-label')).toBe('Save')
    expect(button.style.width).toBe('24px')
    expect(button.style.height).toBe('24px')
  })

  it('is a plain button, so it can never submit a surrounding form', () => {
    expect(markup()).toContain('type="button"')
  })

  it('sits on antd Button, so keyboard and disabled behaviour are not ours to re-implement', () => {
    const html = markup()
    expect(html).toContain('ant-btn')
    // 外观仍由我们覆盖：圆角 5、无内边距、焦点环 2px offset 2 都写在本组件的 CSS 里。
    expect(rules).toContain('border-radius: 5px')
    expect(rules).toContain('.icon-button.ant-btn')
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

  it('ties the described text to the trigger once the button takes focus', async () => {
    const host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    await act(async () => {
      root!.render(<IconButton {...props({ tooltipKey: 'ui.test.hint' })} />)
    })

    const button = host.querySelector('button')!
    await act(async () => {
      button.focus()
    })

    // antd 把弹层挂在传送门里，一帧后才进 DOM；这里轮询而不是靠固定 sleep。
    let described: string | null = null
    for (let attempt = 0; attempt < 40 && described === null; attempt += 1) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10))
      })
      const id = button.getAttribute('aria-describedby')
      if (id === null) continue
      const target = document.getElementById(id)
      if (target === null) continue
      if (target.textContent === 'ui.test.hint') described = target.textContent
    }

    // 键盘用户 Tab 到它时，提示文字必须已经挂在可访问描述上；这是「禁用 + Tooltip」被禁掉的前提。
    expect(described).toBe('ui.test.hint')
  })

  it('rejects "disabled with a tooltip" at compile time — keyboard users never reach it', () => {
    const blocked: IconButtonProps = {
      ...props(),
      disabled: true,
      // @ts-expect-error 禁用的按钮接不到 focus，Tooltip 只对鼠标生效；原因要写成可见说明。
      tooltipKey: 'ui.test.hint'
    }

    expect(blocked).toBeDefined()
  })

  it('gives the loading state its own marker and its own colour, never the disabled one', () => {
    const html = markup({ loading: true } as Partial<IconButtonProps>)

    // 加载中必须不可点，但状态标记与 disabled 分开：绑在一起就没法只给 loading 换色。
    expect(html).toContain('data-state="loading"')
    expect(html).toMatch(/<button[^>]*disabled/)

    // 负判据：loading 的颜色不许来自禁用样式，也不许写死色值——读者得看出哪个按钮在忙。
    expect(rules).toContain(".icon-button[data-state='loading']")
    expect(rules).toMatch(/\.icon-button\[data-state='loading'\][^}]*--muted-strong/)
    expect(rules).not.toMatch(/\.icon-button:disabled[^{]*\{[^}]*color:/)
  })

  it('carries no copy of its own: no literal Chinese outside comments, no spinner, no motion', () => {
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

    expect(code).not.toMatch(/[\u4e00-\u9fff]/)
    // 不许自己造转圈（旋转关键帧、`.spin`、lucide loader）；用平台那一个是可以的，而且应该用。
    expect(code).not.toMatch(/@keyframes|animation:|\bspin\b|Loader/i)
    expect(code).toMatch(/from '\.\.\/loading'/)
    expect(rules).not.toMatch(/@keyframes|animation/)
  })
})
