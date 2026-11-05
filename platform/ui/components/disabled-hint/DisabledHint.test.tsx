// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'

import { DisabledHint } from './DisabledHint'

let root: Root | undefined

afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  document.body.replaceChildren()
})

const resolve = (key: string): string => (key === 'ui.test.needAssistant' ? '先选一个助手' : '')

async function mount(
  resolveText: (key: string) => string = resolve,
  describedBy?: string,
  reasonDisplay?: 'inline' | 'sr-only'
): Promise<HTMLElement> {
  const host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => {
    root!.render(
      <DisabledHint labelKey="ui.test.needAssistant" resolveText={resolveText} reasonDisplay={reasonDisplay}>
        <button aria-describedby={describedBy} disabled type="button">
          new session
        </button>
      </DisabledHint>
    )
  })
  return host
}

describe('DisabledHint', () => {
  it('shows the reason as visible text and links it to the control at the same time', async () => {
    const host = await mount()
    const control = host.querySelector('button')!
    const reason = host.querySelector<HTMLElement>('.disabled-hint__reason')!

    // 两半都要：只挂关联不显示，鼠标用户看不到；只显示不关联，读屏走到控件时听不到。
    expect(reason.textContent).toBe('先选一个助手')
    expect(control.getAttribute('aria-describedby')).toBe(reason.id)
    expect(reason.id).not.toBe('')
  })

  it('keeps the reason in the same view as the control, never in a hover hint', async () => {
    const host = await mount()
    const control = host.querySelector('button')!

    // 「禁用控件不能靠悬停解释自己」是组件级的：只要它出现在 title 里，就说明有人又绕回去了。
    expect(control.getAttribute('title')).toBeNull()
    expect(host.querySelector('[role="tooltip"]')).toBeNull()
  })

  it('appends to an existing description instead of replacing it', async () => {
    const host = await mount(resolve, 'field-error')
    const control = host.querySelector('button')!
    const ids = (control.getAttribute('aria-describedby') ?? '').split(' ').filter(Boolean)

    // 控件可能已经被一个字段级错误说明着，两条都得能被读到。
    expect(ids[0]).toBe('field-error')
    expect(ids).toHaveLength(2)
    expect(document.getElementById(ids[1]!)).toBe(host.querySelector('.disabled-hint__reason'))
  })

  it('renders nothing at all when the reason resolves to an empty string', async () => {
    const host = await mount(() => '')
    const control = host.querySelector('button')!

    // 半个「禁用 + 空原因」比什么都不做更糟：读者会以为界面上少了一块。
    expect(host.querySelector('.disabled-hint__reason')).toBeNull()
    expect(control.getAttribute('aria-describedby')).toBeNull()
    expect(host.querySelector('.disabled-hint')).toBeNull()
  })

  it('does not cache the verdict: a reason that stops applying disappears on the next render', async () => {
    const host = await mount()
    expect(host.querySelector('.disabled-hint__reason')).not.toBeNull()

    // 用户去系统设置放行、回到应用：原因必须消失，否则他会以为设置没生效、再改一遍。
    await act(async () => {
      root!.render(
        <DisabledHint labelKey="ui.test.needAssistant" resolveText={() => ''}>
          <button disabled type="button">
            new session
          </button>
        </DisabledHint>
      )
    })

    expect(host.querySelector('.disabled-hint__reason')).toBeNull()
  })

  it('keeps the control first in the DOM and puts the reason after it', async () => {
    // 视觉上原因在左，但那是 `flex-direction: row-reverse` 排出来的；**DOM 顺序才是读屏和 Tab 走的那条**。
    // 这条钉住的是“视觉顺序与 DOM 顺序解耦”本身——把它们弄回同一个顺序，窄屏换行就会落到控件上方。
    const host = await mount()
    const control = host.querySelector('button')!
    const reason = host.querySelector<HTMLElement>('.disabled-hint__reason')!

    expect(control.compareDocumentPosition(reason) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(control.parentElement).toBe(reason.parentElement)
  })
})

describe('reasonDisplay', () => {
  it('is inline by default: the reason stays visible and readable', async () => {
    const host = await mount()
    const reason = host.querySelector<HTMLElement>('.disabled-hint__reason')!

    expect(reason.getAttribute('data-reason-display')).toBe('inline')
    expect(reason.classList.contains('disabled-hint__reason--sr-only')).toBe(false)
    expect(reason.textContent).toBe('先选一个助手')
  })

  it('keeps the sr-only reason in the DOM and still describes the control', async () => {
    const host = await mount(resolve, undefined, 'sr-only')
    const control = host.querySelector('button')!
    const reason = host.querySelector<HTMLElement>('.disabled-hint__reason')!

    // 两半都不能丢：藏了节点 = 读屏听不到；丢了关联 = 听得到控件也不知道为什么不能点。
    expect(reason.textContent).toBe('先选一个助手')
    expect(reason.getAttribute('data-reason-display')).toBe('sr-only')
    expect(reason.classList.contains('disabled-hint__reason--sr-only')).toBe(true)
    expect(control.getAttribute('aria-describedby')).toBe(reason.id)
    expect(document.getElementById(reason.id)).toBe(reason)
  })

  it('still appends to an existing description in sr-only mode', async () => {
    const host = await mount(resolve, 'field-error', 'sr-only')
    const control = host.querySelector('button')!
    const ids = (control.getAttribute('aria-describedby') ?? '').split(' ').filter(Boolean)

    expect(ids[0]).toBe('field-error')
    expect(ids).toHaveLength(2)
    expect(ids.some((id) => document.getElementById(id)?.classList.contains('disabled-hint__reason'))).toBe(true)
  })

  it('hides visually with the 1px clip technique, never with display:none', async () => {
    // `display:none` 会把节点从可访问树里摘掉，`aria-describedby` 指向一个读不到的元素——
    // 那条关联看起来还在，实际什么也说不出来。所以这里读真实样式文件，不用计算样式（happy-dom 里没有）。
    const { readFileSync } = await import('node:fs')
    const { resolve: resolvePath } = await import('node:path')
    const css = readFileSync(resolvePath(__dirname, 'disabledHint.css'), 'utf8')
    const block = css.split('.disabled-hint__reason--sr-only')[1] ?? ''

    expect(block).toContain('clip-path: inset(50%)')
    expect(block).toContain('width: 1px')
    expect(block).not.toContain('display: none')
    expect(block).not.toContain('visibility: hidden')
  })
})
