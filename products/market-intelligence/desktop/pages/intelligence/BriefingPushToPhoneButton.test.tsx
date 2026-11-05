// @vitest-environment happy-dom

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { briefingPushText } from './dailyBriefingPushText'
import type { BriefingPushState } from './dailyBriefingPushWiring'
import { BriefingPushToPhoneButton } from './BriefingPushToPhoneButton'

const text = briefingPushText['zh-CN']
const source = readFileSync(join(__dirname, 'BriefingPushToPhoneButton.tsx'), 'utf8')

let root: Root | undefined

afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  document.body.replaceChildren()
})

async function mount(state: BriefingPushState): Promise<{ host: HTMLElement; onPush: ReturnType<typeof vi.fn> }> {
  const host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  const onPush = vi.fn()
  await act(async () => {
    root!.render(createElement(BriefingPushToPhoneButton, { state, text, onPush }))
  })
  return { host, onPush }
}

function button(host: HTMLElement): HTMLButtonElement {
  const found = host.querySelector<HTMLButtonElement>('button')
  if (!found) throw new Error('no button rendered')
  return found
}

describe('the push button speaks for every blocked reason', () => {
  it('gives each blocked reason its own sentence, wired to the control', async () => {
    const sentences = new Set<string>()
    for (const reason of ['generating', 'no-edition', 'missing-locale', 'capability'] as const) {
      const { host } = await mount({ kind: 'disabled', reason })
      const control = button(host)
      expect(control.disabled).toBe(true)
      // The reason is the disabled control's own description: a disabled button gets neither hover nor focus.
      const describedBy = control.getAttribute('aria-describedby')
      expect(describedBy).toBeTruthy()
      const reasonNode = host.querySelector(`#${CSS.escape(describedBy!)}`)
      expect(reasonNode?.textContent).toBe(text.disabled[reason])
      sentences.add(reasonNode!.textContent!)
      await act(async () => root?.unmount())
      root = undefined
    }
    // Four reasons, four sentences: folding them into one is the "never says why" defect this guards.
    expect(sentences.size).toBe(4)
  })
})

describe('the push button leaves the toolbar to the button alone', () => {
  it('says nothing about a failure inline, and a click retries the send', async () => {
    // 失败与回执都走平台 toast（用户 2026-11-05）：工具栏里不许再挂一行「没发出去…重试」。
    const { host, onPush } = await mount({ kind: 'failed', reason: 'channel-disconnected' })
    expect(host.textContent).not.toContain(text.failed['channel-disconnected'])
    expect(host.textContent).not.toContain(text.failedTitle)
    await act(async () => button(host).click())
    expect(onPush).toHaveBeenCalledTimes(1)
  })

  it('disables itself while sending, so a double click cannot send twice', async () => {
    const { host, onPush } = await mount({ kind: 'sending' })
    expect(button(host).disabled).toBe(true)
    expect(host.textContent).toContain(text.sending)
    await act(async () => button(host).click())
    expect(onPush).not.toHaveBeenCalled()
  })

  it('sends one push per click when the reader can act', async () => {
    const { host, onPush } = await mount({ kind: 'idle' })
    await act(async () => button(host).click())
    expect(onPush).toHaveBeenCalledTimes(1)
  })

  it('keeps the button usable after a send, so a second push is possible', async () => {
    const { host, onPush } = await mount({ kind: 'sent', receipt: 'accepted' })
    expect(button(host).disabled).toBe(false)
    await act(async () => button(host).click())
    expect(onPush).toHaveBeenCalledTimes(1)
  })
})

describe('the component owns no transport and no channel name', () => {
  it('imports no IPC layer and hard-codes no channel', () => {
    // "The page does the wiring" only holds if this file cannot reach the bridge by itself.
    expect(source.includes('window.platform')).toBe(false)
    expect(/from '.*ipc/.test(source)).toBe(false)
    // The channel and account come from data; an English build must compose the same sentence.
    expect(source.includes('Telegram')).toBe(false)
    expect(source.includes('贾维斯')).toBe(false)
  })
})
