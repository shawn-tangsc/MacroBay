// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'

import { Popover } from './Popover'

const key = (value: string): string => value

let root: Root | undefined
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  document.body.replaceChildren()
})

async function mount(resolveText: (value: string) => string = key): Promise<HTMLButtonElement> {
  const host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => {
    root!.render(
      <Popover labelKey="ui.test.help" resolveText={resolveText}>
        <button type="button" data-trigger>
          trigger
        </button>
      </Popover>
    )
  })
  const trigger = host.querySelector<HTMLButtonElement>('[data-trigger]')
  if (!trigger) throw new Error('no trigger rendered')
  return trigger
}

async function tick(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20))
  })
}

/** 开着的时候 antd 会给触发器加上这个类；比「浮层还在 DOM 里」可靠——容器会留着做动画。 */
function isOpen(trigger: HTMLElement): boolean {
  return trigger.className.includes('ant-popover-open')
}

async function fire(target: HTMLElement, type: string): Promise<void> {
  // React 在根节点上听 `mouseover` / `mouseout` 再合成 enter / leave，直接派发 `mouseenter` 什么也不会发生。
  const related = type === 'mouseout' ? document.body : null
  await act(async () => {
    target.dispatchEvent(new MouseEvent(type, { bubbles: true, relatedTarget: related }))
  })
  await tick()
}

const hoverIn = (target: HTMLElement): Promise<void> => fire(target, 'mouseover')
const hoverOut = (target: HTMLElement): Promise<void> => fire(target, 'mouseout')

describe('Popover', () => {
  it('shows on focus, because a keyboard reader must reach it too', async () => {
    const trigger = await mount()
    await act(async () => {
      trigger.focus()
    })
    await tick()
    expect(isOpen(trigger)).toBe(true)
  })

  it('shows on hover as well', async () => {
    const trigger = await mount()
    await hoverIn(trigger)
    expect(isOpen(trigger)).toBe(true)
  })

  it('pins on click, so the reader can read while the pointer moves away', async () => {
    const trigger = await mount()
    await fire(trigger, 'click')
    await hoverOut(trigger)
    expect(isOpen(trigger)).toBe(true)
  })

  it('closes when the reader clicks somewhere else', async () => {
    const trigger = await mount()
    await fire(trigger, 'click')
    expect(isOpen(trigger)).toBe(true)

    await act(async () => {
      document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    })
    await tick()
    expect(isOpen(trigger)).toBe(false)
  })

  it('closes on Escape and returns the focus to the trigger', async () => {
    const trigger = await mount()
    await act(async () => {
      trigger.focus()
    })
    await tick()
    expect(isOpen(trigger)).toBe(true)

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    })
    await tick()

    expect(isOpen(trigger)).toBe(false)
    expect(document.activeElement).toBe(trigger)
  })

  it('keeps a max width, so a long explanation wraps instead of widening the page', async () => {
    const trigger = await mount()
    await act(async () => {
      trigger.focus()
    })
    await tick()
    const node = document.querySelector<HTMLElement>('[data-popover-content]')
    expect(node?.style.maxWidth).toBe('320px')
  })

  it('sits below the trigger with a gap, so it never covers what it explains', async () => {
    const trigger = await mount()
    await act(async () => {
      trigger.focus()
    })
    await tick()
    const layer = document.querySelector<HTMLElement>('.ant-popover')
    // 位置是组件的固定行为，不是调用点选项：下方、空间不足时由 antd 向上翻。
    expect(layer?.className).toContain('ant-popover-placement-bottom')
    expect(layer?.className).not.toContain('ant-popover-placement-top')
  })

  it('renders nothing when the resolver misses, so no empty frame appears', async () => {
    const trigger = await mount(() => '')
    await act(async () => {
      trigger.focus()
    })
    await tick()
    expect(isOpen(trigger)).toBe(false)
    expect(document.body.textContent).not.toContain('ui.test.help')
  })
})
