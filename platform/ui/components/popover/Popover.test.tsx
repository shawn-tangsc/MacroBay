// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { IconButton } from '../icon-button'
import { Popover, type PopoverTriggerProps } from './Popover'

import type { ReactElement, ReactNode } from 'react'

import { Info } from 'lucide-react'

const key = (value: string): string => value

/** 普通按钮当触发器：属性由调用方显式摊上去——浮层不再注入处理器。 */
function buttonTrigger(triggerProps: PopoverTriggerProps): ReactElement {
  return (
    <button
      aria-expanded={triggerProps.expanded}
      data-trigger
      onBlur={triggerProps.onBlur}
      onClick={triggerProps.onSelect}
      onFocus={triggerProps.onFocus}
      onMouseEnter={triggerProps.onMouseEnter}
      onMouseLeave={triggerProps.onMouseLeave}
      type="button">
      trigger
    </button>
  )
}

let root: Root | undefined

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
      <Popover labelKey="ui.test.help" resolveText={resolveText} trigger={buttonTrigger} />
    )
  })
  const trigger = host.querySelector<HTMLButtonElement>('[data-trigger]')
  if (!trigger) throw new Error('no trigger rendered')
  return trigger
}

async function mountLines(keys: readonly string[], resolveText: (value: string) => string = key, params?: Record<string, string>) {
  // 多行的参数进 `lines[].params`（契约 §8）：`labelParams` 只在单行分支存在。
  const lines = keys.map((labelKey) => (params === undefined ? { labelKey } : { labelKey, params }))
  const host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => {
    root!.render(
      <Popover lines={lines} resolveText={resolveText} trigger={buttonTrigger} />
    )
  })
  const trigger = host.querySelector<HTMLButtonElement>('[data-trigger]')
  if (!trigger) throw new Error('no trigger rendered')
  await act(async () => {
    trigger.focus()
  })
  return trigger
}

async function mountContent(content: ReactNode): Promise<HTMLButtonElement> {
  const host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => {
    root!.render(<Popover content={content} trigger={buttonTrigger} />)
  })
  const trigger = host.querySelector<HTMLButtonElement>('[data-trigger]')
  if (!trigger) throw new Error('no trigger rendered')
  return trigger
}

/**
 * 等到浮层内容真的出现，**轮询到条件成立，不用固定 sleep**。
 *
 * 原来这里等一次 20ms，单独跑够用、全套并发跑就不够——同一棵树、同一时刻，跑全套红、单跑绿，
 * 那是测试在对时序作假设，不是产品行为。等待要等的是「东西出现了」，不是一个时长。
 */
async function waitForElement(selector: string, attempts = 60): Promise<HTMLElement | null> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const found = document.querySelector<HTMLElement>(selector)
    if (found !== null) return found
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10))
    })
  }
  return document.querySelector<HTMLElement>(selector)
}

async function waitForLines(): Promise<HTMLElement[]> {
  await waitForElement('[data-popover-line]')
  return [...document.querySelectorAll<HTMLElement>('[data-popover-line]')]
}

async function tick(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20))
  })
}

/**
 * 开着的时候 antd 会把 `ant-popover-open` 标在它拿到的**锚点**上；比「浮层还在 DOM 里」可靠——
 * 容器会留着做动画。锚点现在是浮层自己包出来的 `.platform-popover__anchor`（不是触发器本身），
 * 所以这里从触发器往上找它：标记搬家了，语义没变。
 */
function isOpen(trigger: HTMLElement): boolean {
  const anchor = trigger.closest('.platform-popover__anchor') ?? trigger
  return anchor.className.includes('ant-popover-open')
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

  it('keeps Escape to itself, so the panel under it does not close with the bubble', async () => {
    // 真窗口里量到的缺陷（2026-11-03）：浮层开在设置面板里，按一次 Esc，浮层关了、**设置面板也关了**，
    // 焦点落回页面上那颗开启按钮。行为上就是「按掉一段说明，丢掉整个设置页」。
    const trigger = await mount()
    const outerEscape = vi.fn()
    const onOuterKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') outerEscape()
    }
    // 外层按冒泡阶段监听，与设置面板自己的处理同一层；浮层在捕获阶段拦下来。
    document.addEventListener('keydown', onOuterKeyDown)
    try {
      await act(async () => {
        trigger.focus()
      })
      await tick()
      expect(isOpen(trigger)).toBe(true)

      await act(async () => {
        trigger.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Escape' }))
      })
      await tick()

      expect(isOpen(trigger)).toBe(false)
      expect(document.activeElement).toBe(trigger)
      expect(outerEscape).not.toHaveBeenCalled()

      // 浮层已经关了，再按一次必须传出去——监听只在开着时挂着，不许变成一直吞按键的组件。
      await act(async () => {
        trigger.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Escape' }))
      })
      expect(outerEscape).toHaveBeenCalledTimes(1)
    } finally {
      document.removeEventListener('keydown', onOuterKeyDown)
    }
  })

  it('keeps a max width, so a long explanation wraps instead of widening the page', async () => {
    const trigger = await mount()
    await act(async () => {
      trigger.focus()
    })
    await tick()
    const node = document.querySelector<HTMLElement>('[data-popover-content]')
    // 上限是规格值（宽 360 / 高 320），不是调用方能改的：超了在框内滚动。
    expect(node?.style.maxWidth).toBe('360px')
    expect(node?.style.maxHeight).toBe('320px')
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

  it('describes the trigger by an id that really names the floating content', async () => {
    const trigger = await mount()
    await act(async () => {
      trigger.focus()
    })
    await tick()

    const describedBy = trigger.getAttribute('aria-describedby')
    // 指向一个不存在的 id 比没有更糟：读屏会念「说明：」然后停住。
    expect(describedBy).not.toBeNull()
    const described = document.getElementById(describedBy as string)
    expect(described).not.toBeNull()
    expect(described).toBe(document.querySelector('[data-popover-content]'))
  })

  it('still describes the trigger when the trigger is an IconButton, not a bare button', async () => {
    // 真实场景：触发器几乎都是 `IconButton`，它的 props 是收窄的——注进去的属性若不被转发，
    // 症状与「没挂」完全一样，所以这条必须用组件实例跑，不能只用裸 `<button>`。
    const host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    await act(async () => {
      root!.render(
        <Popover
          labelKey="ui.test.help"
          resolveText={key}
          trigger={(triggerProps) => (
            <IconButton
              ariaLabelKey="ui.test.help"
              expanded={triggerProps.expanded}
              icon={Info}
              onSelect={(event) => triggerProps.onSelect(event)}
              onFocus={triggerProps.onFocus}
              onBlur={triggerProps.onBlur}
              resolveText={key}
              size="sm"
            />
          )}
        />
      )
    })
    const trigger = host.querySelector<HTMLButtonElement>('button')
    if (trigger === null) throw new Error('no trigger rendered')
    await act(async () => {
      trigger.focus()
    })
    await tick()

    const describedBy = trigger.getAttribute('aria-describedby')
    expect(describedBy).not.toBeNull()
    expect(document.getElementById(describedBy as string)).toBe(document.querySelector('[data-popover-content]'))
  })

  it('never swallows the pointer: clicks pass through the bubble to the control below', async () => {
    const trigger = await mount()
    await act(async () => {
      trigger.focus()
    })
    await tick()

    // 读渲染值：antd 把浮层渲染成外层与内层两个元素，只给一个，另一个仍会接住点击。
    const layer = document.querySelector<HTMLElement>('.ant-popover')
    const inner = document.querySelector<HTMLElement>('.ant-popover-inner')
    expect(layer).not.toBeNull()
    expect(inner).not.toBeNull()
    expect(layer?.style.pointerEvents).toBe('none')
    expect(inner?.style.pointerEvents).toBe('none')
  })

  it('renders one key per line, with the first line carrying the emphasis', async () => {
    await mountLines(['ui.test.line0', 'ui.test.line1', 'ui.test.line2'])
    const rendered = await waitForLines()
    expect(rendered.map((node) => node.textContent)).toEqual(['ui.test.line0', 'ui.test.line1', 'ui.test.line2'])
    // 首行是这句说明的主题，其余是细节：丢了这个区分，三行并列读起来就是同一件事。
    expect(rendered[0]?.style.fontWeight).toBe('600')
    expect(rendered[1]?.style.fontWeight).toBe('')
  })

  it('gives each line its own params, so five facts can share one bubble', async () => {
    const host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    await act(async () => {
      root!.render(
        <Popover
          lines={[
            { labelKey: 'ui.test.a', params: { v: '1' } },
            { labelKey: 'ui.test.b', params: { v: '2' } }
          ]}
          resolveText={(value) => (value === 'ui.test.a' ? 'A {v}' : value === 'ui.test.b' ? 'B {v}' : '')}
          trigger={buttonTrigger}
        />
      )
    })
    const trigger = host.querySelector<HTMLButtonElement>('[data-trigger]')!
    await act(async () => {
      trigger.focus()
    })
    await tick()

    // 每行自带参数：共用一份参数会让第二行拿到第一行的值。
    const rendered = [...document.querySelectorAll<HTMLElement>('[data-popover-line]')]
    expect(rendered.map((node) => node.textContent)).toEqual(['A 1', 'B 2'])
    // 参数填进去了才叫填：残留 `{` 说明只是「句子在那儿」，没测到填充。
    expect(rendered.map((node) => node.textContent ?? '').join('')).not.toContain('{')
  })

  it('fills the template with already-formatted values and leaves no placeholder behind', async () => {
    await mountLines(['ui.test.coverage'], (value) => (value === 'ui.test.coverage' ? 'Coverage {coverage} of {total}' : ''), {
      coverage: '289/289',
      total: '289'
    })
    const [rendered] = await waitForLines()
    expect(rendered?.textContent).toBe('Coverage 289/289 of 289')
    // 没有残留占位：`{` 还在说明参数没填进去，读者会把模板当正文。
    expect(rendered?.textContent).not.toContain('{')
  })

  it('keeps a missing placeholder visible instead of dropping the number silently', async () => {
    await mountLines(['ui.test.coverage'], (value) => (value === 'ui.test.coverage' ? 'Coverage {coverage}' : ''), {})
    const [kept] = await waitForLines()
    expect(kept?.textContent).toBe('Coverage {coverage}')
  })

  it('throws in development when the copy is missing, because that is a defect', async () => {
    // 缺文案是缺陷，不是运行态：开发期当场炸，逼人去补句子，而不是让交互把缺陷藏起来。
    // 生产期走另一条路——触发器与浮层都不渲染（留一个点了没反应的按钮才是假控件）。
    await expect(mountLines(['ui.test.missing'], () => '')).rejects.toThrow(/has no copy/)
  })

  it('throws in development when the resolver misses, instead of rendering an empty frame', async () => {
    await expect(mount(() => '')).rejects.toThrow(/has no copy/)
  })

  it('composes with the platform icon button as its trigger', async () => {
    // 两个平台组件必须能合成一个触发器：`Popover` 交出的鼠标/焦点处理器要能落到 `IconButton`
    // 内部的 `<button>` 上。持仓卡那颗「?」卡的就是这一步——`IconButton` 早先只绑了自己的
    // `onSelect`，注入进来的处理器被丢掉，悬停和聚焦都不会开。
    const host = document.createElement('div')
    document.body.append(host)
    const root_ = createRoot(host)
    root = root_
    act(() => {
      root_.render(
        <Popover
          labelKey="ui.test.help"
          resolveText={key}
          trigger={(triggerProps) => (
            <IconButton
              {...triggerProps}
              ariaLabelKey="ui.test.trigger"
              icon={Info}
              resolveText={key}
              size="sm"
            />
          )}
        />
      )
    })
    const button = host.querySelector<HTMLButtonElement>('button')
    if (!button) throw new Error('no trigger rendered')

    await act(async () => {
      button.focus()
    })
    await tick()
    // 两个平台组件要合成一个触发器：浮层交出的处理器落到真实 `<button>` 上，锚点由浮层自己包。
    expect(button.closest('.platform-popover__anchor')).not.toBeNull()
    expect(isOpen(button)).toBe(true)
  })

  it('anchors the bubble through its own wrapper, so a trigger that drops the ref still opens in place', async () => {
    // 2026-11-02 用户报的症状：气泡不出现，或者跑到整个应用左上角。根因是浮层拿不到锚点——
    // 当时 `IconButton` 没有把 `ref` 转到真实 `<button>`，`Popover` 又直接拿子元素当锚点。
    // 这条用例故意用一个**只摊事件、不接 ref** 的触发器：浮层必须照样定位正确，
    // 因为锚点是它自己包出来的那个真实节点，不是调用方记得转发的那一个。
    const render = async (top: number, left: number): Promise<{ left: number; top: number }> => {
      await act(async () => {
        root?.unmount()
      })
      document.body.replaceChildren()
      const host = document.createElement('div')
      document.body.append(host)
      root = createRoot(host)
      await act(async () => {
        root!.render(
          <Popover
            labelKey="ui.test.help"
            resolveText={(value) => value}
            trigger={(triggerProps) => (
              <button
                data-trigger
                onBlur={triggerProps.onBlur}
                onClick={triggerProps.onSelect}
                onFocus={triggerProps.onFocus}
                onMouseEnter={triggerProps.onMouseEnter}
                onMouseLeave={triggerProps.onMouseLeave}
                type="button">
                help
              </button>
            )}
          />
        )
      })
      const anchor = document.querySelector<HTMLElement>('.platform-popover__anchor')
      if (anchor === null) throw new Error('popover has no anchor element of its own')
      expect(anchor.querySelector('[data-trigger]')).not.toBeNull()
      const rect = { x: left, y: top, width: 24, height: 24, top, left, right: left + 24, bottom: top + 24, toJSON: () => ({}) }
      Object.defineProperty(anchor, 'getBoundingClientRect', { configurable: true, value: () => rect })
      const button = anchor.querySelector<HTMLButtonElement>('[data-trigger]')!
      await act(async () => {
        button.focus()
      })
      const layer = await waitForElement('.ant-popover')
      expect(layer).not.toBeNull()
      expect(layer!.parentElement).toBe(document.body)
      return { left: Number.parseFloat(layer!.style.left), top: Number.parseFloat(layer!.style.top) }
    }

    const first = await render(300, 400)
    expect(first.left).not.toBe(0)
    expect(first.top).not.toBe(0)
    const second = await render(600, 900)
    expect(second.left - first.left).toBe(500)
    expect(second.top - first.top).toBe(300)
  })

  it('keeps the key path unchanged when no content slot is given', async () => {
    // 传了 `content` 的分支不能把老路挤掉：逐行渲染、首行强调、开合与焦点回收都还是原来那套。
    const trigger = await mountLines(['ui.test.first', 'ui.test.second'])
    const rendered = await waitForLines()

    expect(rendered.map((line) => line.textContent)).toEqual(['ui.test.first', 'ui.test.second'])
    expect(rendered[0]?.style.fontWeight).toBe('600')
    expect(rendered[1]?.style.fontWeight).toBe('')
    // 描述指向的仍是这块内容节点。
    const describedBy = trigger.getAttribute('aria-describedby')
    expect(document.getElementById(describedBy!)).toBe(rendered[0]?.closest('[data-popover-content]'))

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    })
    await vi.waitFor(() => { expect(isOpen(trigger)).toBe(false) })
    expect(document.activeElement).toBe(trigger)
  })

  it('renders the caller-built node in the same bubble and still describes the trigger by it', async () => {
    const trigger = await mountContent(
      <div data-caller-node>
        <span>alpha fragment</span>
        <span>second fragment</span>
      </div>
    )
    await act(async () => {
      trigger.focus()
    })

    const bubble = await waitForElement('[data-popover-content]')
    expect(bubble).not.toBeNull()
    // 槽里的节点原样进来：组件不解析它、也不给它加行样式。
    expect(bubble!.querySelector('[data-caller-node]')?.textContent).toContain('second fragment')
    expect(bubble!.querySelector('[data-popover-line]')).toBeNull()

    // 无障碍走的是同一条：触发件的描述就是这块内容节点。
    const describedBy = trigger.getAttribute('aria-describedby')
    expect(describedBy).not.toBeNull()
    expect(document.getElementById(describedBy!)).toBe(bubble)

    // 开合与焦点回收不变。
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    })
    await vi.waitFor(() => { expect(isOpen(trigger)).toBe(false) })
    expect(document.activeElement).toBe(trigger)
  })

  it('treats an empty slot as nothing to say, not as missing copy', async () => {
    // 调用方按条件拼行，这一帧可能一个片段都没有：那时不画空框，也不当成「文案没写」的缺陷。
    const host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    await act(async () => {
      root!.render(<Popover content={null} trigger={buttonTrigger} />)
    })

    expect(document.querySelector('[data-trigger]')).toBeNull()
    expect(document.querySelector('[data-popover-content]')).toBeNull()
  })
})
