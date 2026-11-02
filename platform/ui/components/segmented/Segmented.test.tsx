// @vitest-environment happy-dom

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { Segmented } from './Segmented'

const key = (value: string): string => value
const items = [
  { value: 'day', labelKey: 'ui.test.day' },
  { value: 'week', labelKey: 'ui.test.week' },
  { value: 'month', labelKey: 'ui.test.month', disabled: true }
]

let root: Root | undefined

afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  document.body.replaceChildren()
})

async function mount(value = 'day'): Promise<{ host: HTMLElement; onChange: ReturnType<typeof vi.fn> }> {
  const host = document.createElement('div')
  document.body.append(host)
  const onChange = vi.fn()
  root = createRoot(host)
  await act(async () => {
    root!.render(<Segmented ariaLabelKey="ui.test.range" items={items} onChange={onChange} resolveText={key} value={value} />)
  })
  return { host, onChange }
}

describe('Segmented', () => {
  it('is a group of pressed values, not a tablist', async () => {
    const { host } = await mount()

    expect(host.querySelector('[role="group"]')?.getAttribute('aria-label')).toBe('ui.test.range')
    expect(host.querySelectorAll('[aria-pressed="true"]')).toHaveLength(1)
    expect(host.querySelector('[role="tab"]')).toBeNull()
  })

  it('moves focus with arrows but only selects on Enter or Space', async () => {
    const { host, onChange } = await mount()
    const first = host.querySelector<HTMLElement>('[aria-pressed="true"]')!

    await act(async () => {
      first.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    })
    // 只移焦，不换值：同一块内容换取值时，读者往往要先看两三个再定。
    expect(onChange).not.toHaveBeenCalled()
    expect(document.activeElement?.textContent).toBe('ui.test.week')

    const second = host.querySelector<HTMLElement>('[aria-pressed="false"]') as HTMLElement
    await act(async () => {
      second.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    })
    expect(onChange).toHaveBeenCalledWith('week')
  })

  it('skips disabled values in the arrow sequence and keeps them out of the tab order', async () => {
    const { host } = await mount('week')
    const disabled = host.querySelector<HTMLButtonElement>('button[disabled]')!
    expect(disabled.getAttribute('tabindex')).toBe('-1')

    const pressed = host.querySelector<HTMLElement>('[aria-pressed="true"]')!
    await act(async () => {
      pressed.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    })
    expect(document.activeElement?.textContent).toBe('ui.test.day')
  })

  it('keeps the group reachable when the value is gone, and reports it once', async () => {
    const host = document.createElement('div')
    document.body.append(host)
    const onChange = vi.fn()
    root = createRoot(host)
    await act(async () => {
      root!.render(<Segmented ariaLabelKey="ui.test.range" items={items} onChange={onChange} resolveText={key} value="ghost" />)
    })

    const reachable = host.querySelectorAll<HTMLButtonElement>('button[tabindex="0"]')
    expect(reachable).toHaveLength(1)
    // 可聚焦项 = 被渲染成按下的那一项，且恰好一个。
    const pressed = host.querySelectorAll('button[aria-pressed="true"]')
    expect(pressed).toHaveLength(1)
    expect(pressed[0]).toBe(reachable[0])
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith('day')

    await act(async () => {
      root!.render(<Segmented ariaLabelKey="ui.test.range" items={items} onChange={onChange} resolveText={key} value="day" />)
    })
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('treats a pressed-but-disabled value as stale', async () => {
    const host = document.createElement('div')
    document.body.append(host)
    const onChange = vi.fn()
    root = createRoot(host)
    await act(async () => {
      root!.render(<Segmented ariaLabelKey="ui.test.range" items={items} onChange={onChange} resolveText={key} value="month" />)
    })

    const disabled = host.querySelector<HTMLButtonElement>('button[disabled]')!
    expect(disabled.getAttribute('aria-pressed')).toBe('false')
    expect(disabled.className).not.toContain('segmented__item--selected')
    expect(host.querySelectorAll('[aria-pressed="true"]')).toHaveLength(1)
  })

  it('selects on click', async () => {
    const { host, onChange } = await mount()
    const second = host.querySelectorAll<HTMLButtonElement>('button')[1]!
    await act(async () => {
      second.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(onChange).toHaveBeenCalledWith('week')
  })

  it('renders an item icon when one is given, and leaves no empty slot when it is not', async () => {
    const host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    const { Palette } = await import('lucide-react')
    await act(async () => {
      root!.render(
        <Segmented
          ariaLabelKey="ui.test.theme"
          items={[
            { value: 'light', labelKey: 'ui.test.light', icon: Palette },
            { value: 'dark', labelKey: 'ui.test.dark' }
          ]}
          onChange={vi.fn()}
          resolveText={key}
          value="light"
        />
      )
    })

    const [withIcon, withoutIcon] = host.querySelectorAll<HTMLButtonElement>('button')
    const glyph = withIcon?.querySelector('svg')
    expect(glyph).not.toBeNull()
    // 图标对读屏是冗余辅助：文字才是这一项的名字。
    expect(glyph?.getAttribute('aria-hidden')).toBe('true')
    expect(glyph?.getAttribute('width')).toBe('14')

    // 不给图标就不占位：没有包裹元素，文字直接是按钮的第一个子节点。
    expect(withoutIcon?.querySelector('svg')).toBeNull()
    expect(withoutIcon?.firstChild?.nodeType).toBe(Node.TEXT_NODE)
  })

  it('never builds the selected state from a layer token, whose light/dark meaning is inverted', () => {
    // 这条钉的是**方法**，不是色值。曾经写的是 `background: var(--surface)`：
    //   浅色 --surface > --surface-soft  → 选中是白块浮在灰底上 ✓
    //   深色 --surface < --surface-soft  → 选中是暗块陷进亮容器 ✗（还和页面同色，像凿穿一个洞）
    // 同一行 CSS 在两套主题里方向相反，所以值怎么调都会有一半是错的。
    const css = readFileSync(join(__dirname, 'segmented.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
    const start = css.indexOf('.segmented__item--selected {')
    const body = css.slice(css.indexOf('{', start) + 1, css.indexOf('}', start))

    for (const token of ['--surface', '--surface-soft', '--surface-strong']) {
      expect(body).not.toContain(`var(${token})`)
    }
    // 相对叠加：深色叠白变亮、浅色叠黑变深，两套都成立。
    expect(body).toMatch(/background:\s*color-mix\(in srgb, var\(--text-strong\)/)/
    // 深色界面上纯黑阴影等于不存在，留着只会让人以为它起了作用。
    expect(body).not.toMatch(/box-shadow/)
  })
})
