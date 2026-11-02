// @vitest-environment happy-dom

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { act } from 'react'
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
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

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
      <Tabs ariaLabelKey="ui.test.tabs" items={items} onChange={onChange} panel={<p data-panel>panel</p>} resolveText={key} value={value} />
    )
  })
  return { host, onChange }
}

describe('Tabs', () => {
  it('wires the tablist and the panel both ways, with ids it generates itself', async () => {
    const { host } = await mount()
    const list = host.querySelector('[role="tablist"]')
    const panel = host.querySelector('[role="tabpanel"]')
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
        <Tabs ariaLabelKey="ui.test.tabs" items={items} onChange={onChange} panel={<p>panel</p>} resolveText={key} value="ghost" />
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
        <Tabs ariaLabelKey="ui.test.tabs" items={items} onChange={onChange} panel={<p>panel</p>} resolveText={key} value="a" />
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
        <Tabs ariaLabelKey="ui.test.tabs" items={items} onChange={onChange} panel={<p>panel</p>} resolveText={key} value="c" />
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
})
