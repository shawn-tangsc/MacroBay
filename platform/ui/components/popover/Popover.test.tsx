// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'

import { IconButton } from '../icon-button'
import { Popover, type PopoverTriggerProps } from './Popover'

import type { ReactElement } from 'react'

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

/**
 * 等到浮层内容真的出现，**轮询到条件成立，不用固定 sleep**。
 *
 * 原来这里等一次 20ms，单独跑够用、全套并发跑就不够——同一棵树、同一时刻，跑全套红、单跑绿，
 * 那是测试在对时序作假设，不是产品行为。等待要等的是「东西出现了」，不是一个时长。
 */
async function waitForLines(): Promise<HTMLElement[]> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const rendered = [...document.querySelectorAll<HTMLElement>('[data-popover-line]')]
    if (rendered.length > 0) return rendered
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10))
    })
  }
  return []
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

  it('renders nothing when every line resolves to an empty string', async () => {
    const trigger = await mountLines(['ui.test.missing'], () => '')
    expect(isOpen(trigger)).toBe(false)
    expect(document.body.textContent).not.toContain('ui.test.missing')
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
    expect(button.className).toContain('ant-popover-open')
  })
})
