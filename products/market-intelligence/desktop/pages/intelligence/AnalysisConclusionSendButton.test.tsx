// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AnalysisConclusionSendButton } from './AnalysisConclusionSendButton'
import { analysisConclusionSendText } from './analysisConclusionSendText'

/**
 * 按钮的三条判据：
 * 1. **发送中真禁用**（`disabled`），不是只换样式——连点会各发一条不同的记录；
 * 2. **文案切换不改变宽度**：两句都排在同一个网格里量宽，所以「发送到频道」那层始终在 DOM 里；
 * 3. 按钮文案只有两句，由调用方给的表决定，组件里没有字面量。
 */
const text = analysisConclusionSendText('zh-CN')

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

const render = (sending: boolean, disabled = false, onSelect = vi.fn()): ReturnType<typeof vi.fn> => {
  act(() => root.render(<AnalysisConclusionSendButton disabled={disabled} onSelect={onSelect} sending={sending} text={text} />))
  return onSelect
}

const button = (): HTMLButtonElement => host.querySelector('button')!
const ghosts = (): readonly HTMLElement[] => Array.from(host.querySelectorAll<HTMLElement>('.mi-analysis-send__label--ghost'))

describe('the send-to-channel button', () => {
  it('shows the action label and reserves the width of the longer sentence', () => {
    render(false)
    expect(button().textContent).toContain(text.button)
    expect(button().disabled).toBe(false)
    // 两层量宽都在：所以按钮宽度已经按「两句里更宽的那句」定下来，切换文案不会缩。
    expect(ghosts().map((node) => node.textContent)).toEqual([text.sending, text.button])
    expect(ghosts().every((node) => node.getAttribute('aria-hidden') === 'true')).toBe(true)
  })

  it('says it is sending, and is really disabled while it does', () => {
    const onSelect = render(true)
    expect(button().textContent).toContain(text.sending)
    expect(button().disabled).toBe(true)
    expect(button().getAttribute('aria-busy')).toBe('true')
    // 「发送到频道」那层还在，宽度不变；点也点不动（真 disabled，不靠样式挡）。
    expect(ghosts().map((node) => node.textContent)).toContain(text.button)
    act(() => button().click())
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('sends once per click when it is idle', () => {
    const onSelect = render(false)
    act(() => button().click())
    expect(onSelect).toHaveBeenCalledTimes(1)
  })

  it('stays disabled when the caller says the action is unavailable', () => {
    const onSelect = render(false, true)
    expect(button().disabled).toBe(true)
    act(() => button().click())
    expect(onSelect).not.toHaveBeenCalled()
  })
})
