// @vitest-environment happy-dom

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { Tabs } from './Tabs'

const css = readFileSync(join(__dirname, 'tabs.css'), 'utf8')
const key = (value: string): string => value

const items = [
  { value: 'a', labelKey: 'ui.test.a' },
  { value: 'b', labelKey: 'ui.test.b' },
  { value: 'c', labelKey: 'ui.test.c', disabled: true }
]

let root: Root | undefined

afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  document.body.replaceChildren()
})

async function mount(value = 'a'): Promise<{ host: HTMLElement; onChange: ReturnType<typeof vi.fn> }> {
  const host = document.createElement('div')
  document.body.append(host)
  const onChange = vi.fn()
  root = createRoot(host)
  await act(async () => {
    root!.render(
      <Tabs
        ariaLabelKey="ui.test.tabs"
        items={items}
        onChange={onChange}
        panels={{ a: <p data-panel-a>panel a</p>, b: <p data-panel-b>panel b</p>, c: null }}
        resolveText={key}
        value={value}
      />
    )
  })
  return { host, onChange }
}

describe('Tabs', () => {
  it('wires the tablist and the panel both ways, with ids it generates itself', async () => {
    const { host } = await mount()
    const list = host.querySelector('[role="tablist"]')
    const panel = host.querySelector('[role="tabpanel"]:not([hidden])')
    const selected = host.querySelector('[role="tab"][aria-selected="true"]')

    expect(list?.getAttribute('aria-label')).toBe('ui.test.tabs')
    expect(selected?.getAttribute('aria-controls')).toBe(panel?.id)
    expect(panel?.getAttribute('aria-labelledby')).toBe(selected?.id)
    // 恰好一处选中：两个 true 会让读屏念出两个当前项。
    expect(host.querySelectorAll('[role="tab"][aria-selected="true"]')).toHaveLength(1)
  })

  it('switches on ArrowRight, because this interaction means "show me the other block"', async () => {
    const { host, onChange } = await mount()
    const first = host.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')!

    await act(async () => {
      first.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    })

    expect(onChange).toHaveBeenCalledWith('b')
    // 焦点跟着选中项走，读屏才会念新页签。
    expect(document.activeElement?.textContent).toBe('ui.test.b')
  })

  it('jumps to the first and last tab with Home and End', async () => {
    const { host, onChange } = await mount('b')
    const selected = host.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')!

    await act(async () => {
      selected.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }))
    })
    expect(onChange).toHaveBeenLastCalledWith('b')

    await act(async () => {
      selected.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }))
    })
    expect(onChange).toHaveBeenLastCalledWith('a')
  })

  it('keeps disabled tabs out of the tab order and out of arrow navigation', async () => {
    const { host, onChange } = await mount('b')
    const disabled = host.querySelector<HTMLButtonElement>('[role="tab"][disabled]')!

    expect(disabled.disabled).toBe(true)
    expect(disabled.getAttribute('tabindex')).toBe('-1')

    const selected = host.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')!
    await act(async () => {
      selected.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    })
    // c 是禁用的：向右应该绕回 a，而不是停在 c 上。
    expect(onChange).toHaveBeenLastCalledWith('a')
  })

  it('scrolls horizontally instead of folding items into a "more" menu', async () => {
    const { host } = await mount()
    expect(host.querySelector('[role="tablist"]')).not.toBeNull()
    expect(css).toContain('overflow-x: auto')
    expect(css).not.toContain('more')
  })

  it('keeps the group reachable when the selected value is gone, and reports it once', async () => {
    const host = document.createElement('div')
    document.body.append(host)
    const onChange = vi.fn()
    root = createRoot(host)
    // `ghost` 不在 items 里：items 增删后旧的选中值失效是常态。
    await act(async () => {
      root!.render(
        <Tabs ariaLabelKey="ui.test.tabs" items={items} onChange={onChange} panels={{ a: <p>panel</p> }} resolveText={key} value="ghost" />
      )
    })

    // 兜底：首个可用项拿到 tabIndex 0，Tab 键进得来。
    const reachable = host.querySelectorAll<HTMLButtonElement>('[role="tab"][tabindex="0"]')
    expect(reachable).toHaveLength(1)
    expect(reachable[0]?.textContent).toBe('ui.test.a')

    // 而且「可聚焦的那一项」就是「被渲染成选中的那一项」——否则键盘进得来却看不出落在哪。
    const selectedTab = host.querySelectorAll('[role="tab"][aria-selected="true"]')
    expect(selectedTab).toHaveLength(1)
    expect(selectedTab[0]).toBe(reachable[0])
    // 面板仍有名字：aria-labelledby 指向同一个元素。
    expect(host.querySelector('[role="tabpanel"]')?.getAttribute('aria-labelledby')).toBe(reachable[0]?.id)
    // 而且回调一次：只兜显示不回调，就会「看着是 A、动起来是 B」。
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith('a')

    // 父级把合法值传回来之后，不许二次触发。
    await act(async () => {
      root!.render(
        <Tabs ariaLabelKey="ui.test.tabs" items={items} onChange={onChange} panels={{ a: <p>panel</p> }} resolveText={key} value="a" />
      )
    })
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('treats a selected-but-disabled value as stale, so the disabled tab never wears the underline', async () => {
    const host = document.createElement('div')
    document.body.append(host)
    const onChange = vi.fn()
    root = createRoot(host)
    await act(async () => {
      root!.render(
        <Tabs ariaLabelKey="ui.test.tabs" items={items} onChange={onChange} panels={{ c: <p>panel</p> }} resolveText={key} value="c" />
      )
    })

    const disabled = host.querySelector<HTMLElement>('[role="tab"][disabled]')!
    expect(disabled.getAttribute('aria-selected')).toBe('false')
    expect(disabled.className).not.toContain('tabs__tab--selected')
    expect(host.querySelectorAll('[role="tab"][aria-selected="true"]')).toHaveLength(1)
  })

  it('never renders a spinner in the tab strip itself', async () => {
    const { host } = await mount()
    expect(host.querySelector('[role="tablist"] [data-loading-state]')).toBeNull()
  })

  it('renders an item icon when one is given, and leaves no empty slot when it is not', async () => {
    const host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    const { Sun } = await import('lucide-react')
    await act(async () => {
      root!.render(
        <Tabs
          ariaLabelKey="ui.test.theme"
          items={[
            { value: 'light', labelKey: 'ui.test.light', icon: Sun },
            { value: 'dark', labelKey: 'ui.test.dark' }
          ]}
          onChange={vi.fn()}
          panels={{ a: null, b: null }}
          resolveText={key}
          value="light"
        />
      )
    })

    const [withIcon, withoutIcon] = host.querySelectorAll<HTMLButtonElement>('[role="tab"]')
    const glyph = withIcon?.querySelector('svg')
    expect(glyph).not.toBeNull()
    // 图标对读屏是冗余辅助：文字才是这一项的名字，标签的可访问名不能因此变空。
    expect(glyph?.getAttribute('aria-hidden')).toBe('true')
    expect(glyph?.getAttribute('width')).toBe('14')

    // 不给图标就不占位：没有包裹元素，文字直接是标签的第一个子节点。
    expect(withoutIcon?.querySelector('svg')).toBeNull()
    expect(withoutIcon?.firstChild?.nodeType).toBe(Node.TEXT_NODE)
  })

  it('keeps the other panel mounted and its state intact across a switch and back', async () => {
    // 主用例（架构师 2026-11-02）：切走再切回，另一半里的东西都还在。
    // 这正是「只渲染选中那块」的界面做不到的事——键盘对了、状态没了，比不做更糟。
    const host = document.createElement('div')
    document.body.append(host)
    let current = 'a'
    const onChange = vi.fn((next: string) => {
      current = next
      render()
    })
    const root_ = createRoot(host)
    root = root_

    function render(): void {
      act(() => {
        root_.render(
          <Tabs
            ariaLabelKey="ui.test.tabs"
            items={items}
            onChange={onChange}
            panels={{
              a: <p data-panel-a>panel a</p>,
              b: <input data-panel-b defaultValue="" />
            }}
            resolveText={key}
            value={current}
          />
        )
      })
    }

    render()
    const input = host.querySelector<HTMLInputElement>('[data-panel-b]')
    if (!input) throw new Error('inactive panel is not mounted')
    input.value = 'typed in the hidden half'

    // 先切到 b，再切回 a：b 的输入必须还在。
    await act(async () => {
      host.querySelectorAll<HTMLElement>('[role="tab"]')[1]!.click()
    })
    await act(async () => {
      host.querySelectorAll<HTMLElement>('[role="tab"]')[0]!.click()
    })

    expect(host.querySelector<HTMLInputElement>('[data-panel-b]')?.value).toBe('typed in the hidden half')
  })

  it('removes an inactive panel from the accessibility tree with the hidden attribute', async () => {
    const { host } = await mount('a')
    const panels = [...host.querySelectorAll<HTMLElement>('[role="tabpanel"]')]

    // 三块都在 DOM 里（保持挂载），但只有活动那块可达。
    expect(panels).toHaveLength(3)
    expect(panels.filter((panel) => !panel.hasAttribute('hidden'))).toHaveLength(1)
    // 用原生 `hidden`，不是 `aria-hidden` 冒充：`aria-hidden` 只是把辅助技术挡在外面，
    // 布局和无障碍树都不动，而这里要的正是「退出布局与无障碍树」。
    expect(panels.filter((panel) => panel.hasAttribute('hidden'))).toHaveLength(2)
    for (const panel of panels) expect(panel.hasAttribute('aria-hidden')).toBe(false)
  })

  it('points every tab at its own panel and every panel back at its own tab', async () => {
    const { host } = await mount('a')
    const tabs = [...host.querySelectorAll<HTMLElement>('[role="tab"]')]
    const panels = [...host.querySelectorAll<HTMLElement>('[role="tabpanel"]')]

    expect(tabs).toHaveLength(panels.length)
    tabs.forEach((tab, index) => {
      expect(tab.getAttribute('aria-controls')).toBe(panels[index]?.id)
      expect(panels[index]?.getAttribute('aria-labelledby')).toBe(tab.id)
    })
  })

  it('does not re-run a hidden panel\'s effects when the reader switches tabs', async () => {
    // 「保持挂载」不等于「继续运行」：组件只负责挂载与可达性，暂停由调用方判断。
    // 能钉住的是这一条——切换不会让面板重挂载，所以它自己的 effect 不会因为切换而多跑一轮。
    const host = document.createElement('div')
    document.body.append(host)
    const effectRuns = vi.fn()
    function PollingPanel(): React.ReactElement {
      React.useEffect(() => {
        effectRuns()
      }, [])
      return <p data-polling>polling</p>
    }
    let current = 'a'
    const root_ = createRoot(host)
    root = root_
    const rerender = (): void => {
      act(() => {
        root_.render(
          <Tabs
            ariaLabelKey="ui.test.tabs"
            items={items}
            onChange={(next) => {
              current = next
              rerender()
            }}
            panels={{ a: <p>panel a</p>, b: <PollingPanel /> }}
            resolveText={key}
            value={current}
          />
        )
      })
    }

    rerender()
    const before = effectRuns.mock.calls.length
    for (const index of [1, 0, 1, 0]) {
      await act(async () => {
        host.querySelectorAll<HTMLElement>('[role="tab"]')[index]!.click()
      })
    }
    expect(effectRuns.mock.calls.length).toBe(before)
  })

  it('fills a counted label from labelParams instead of a pre-built sentence', async () => {
    // 标签天生带计数（「内置工具 3/5」）。没有这个口子，调用点只能自己拼句子塞给 resolveText，
    // 「只收键」立刻变成空话——所以按占位符填，句子留在文案表里。
    const host = document.createElement('div')
    document.body.append(host)
    const root_ = createRoot(host)
    root = root_
    act(() => {
      root_.render(
        <Tabs
          ariaLabelKey="ui.test.tabs"
          items={[{ value: 'a', labelKey: 'ui.test.counted', labelParams: { enabled: '3', total: '5' } }]}
          onChange={() => undefined}
          panels={{ a: <p>panel</p> }}
          resolveText={(value) => (value === 'ui.test.counted' ? 'Built-in tools {enabled}/{total}' : value)}
          value="a"
        />
      )
    })
    const tab = host.querySelector('[role="tab"]')
    expect(tab?.textContent).toBe('Built-in tools 3/5')
    // 缺参时占位符留在脸上，不安静地少一个数字。
    expect(tab?.textContent).not.toContain('{enabled}')
  })
})
