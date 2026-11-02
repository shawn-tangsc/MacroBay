// @vitest-environment happy-dom

import { act, createElement, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { platformText } from '../../i18n/platformText'
import type { ModelDraft } from '../modelDrafts'
import { ModelServiceModelDrawer } from './ModelServiceModelDrawer'

/**
 * T4/T5：模型抽屉里的「请求协议」。
 * - 默认 chat/completions（不写字段）；
 * - 供应商没配对应端点 ⇒ 该选项禁用并标注「未配置端点」；
 * - 选了非默认协议 ⇒ 明确提示工具调用（网页搜索）不可用。
 */
const labels = platformText['en-US'].models
const draft: ModelDraft = { id: 'acme-chat', name: 'Acme Chat', capabilities: { chat: true } }

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => undefined } })
let root: Root | undefined

function Harness({
  availability,
  initial = draft,
  onDraft
}: {
  availability: { responses: boolean; gemini: boolean; messages: boolean }
  initial?: ModelDraft
  onDraft?: (value: ModelDraft) => void
}): React.ReactElement {
  const [value, setValue] = useState(initial)
  return createElement(ModelServiceModelDrawer, {
    open: true,
    labels,
    draft: value,
    isEditing: true,
    isSaving: false,
    pinned: false,
    chatProtocolAvailability: availability,
    onChange: (next) => {
      setValue(next)
      onDraft?.(next)
    },
    onTogglePin: () => undefined,
    onSave: () => undefined,
    onClose: () => undefined
  })
}

async function mount(props: Parameters<typeof Harness>[0]): Promise<HTMLElement> {
  document.body.replaceChildren()
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => {
    root?.render(createElement(Harness, props))
  })
  return container
}

// antd Drawer 通过 portal 挂到 document.body，查询必须走 document
function select(): HTMLSelectElement {
  const element = document.querySelector<HTMLSelectElement>('[data-model-chat-protocol]')
  if (!element) throw new Error('Expected the chat protocol select.')
  return element
}

function option(value: string): HTMLOptionElement {
  const element = document.querySelector<HTMLOptionElement>(`[data-model-chat-protocol] option[value="${value}"]`)
  if (!element) throw new Error(`Expected option ${value}`)
  return element
}

afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  document.body.replaceChildren()
})

describe('ModelServiceModelDrawer chat protocol', () => {
  it('defaults to chat/completions and disables protocols whose endpoint is missing', async () => {
    const container = await mount({ availability: { responses: false, gemini: false, messages: false } })

    expect(select().value).toBe('chat-completions')
    expect(option('chat-completions').textContent).toBe(labels.chatProtocolChatCompletions)
    expect(option('responses').disabled).toBe(true)
    expect(option('gemini').disabled).toBe(true)
    // PLAT-69：Anthropic Messages 选项也只在配置了 Anthropic 端点时可用。
    expect(option('messages').disabled).toBe(true)
    expect(option('messages').textContent).toContain(labels.chatProtocolEndpointMissing)
    expect(option('responses').textContent).toContain(labels.chatProtocolEndpointMissing)
    expect(document.querySelector('[data-chat-protocol-hint]')).toBeNull()
  })

  it('allows a protocol whose endpoint is configured and reports the tool limitation', async () => {
    const onDraft = vi.fn()
    const container = await mount({ availability: { responses: true, gemini: false, messages: false }, onDraft })

    expect(option('responses').disabled).toBe(false)
    expect(option('gemini').disabled).toBe(true)

    await act(async () => {
      select().value = 'responses'
      select().dispatchEvent(new Event('change', { bubbles: true }))
    })

    expect(onDraft).toHaveBeenLastCalledWith(expect.objectContaining({ chatProtocol: 'responses' }))
    expect(document.querySelector('[data-chat-protocol-hint]')?.textContent).toBe(labels.chatProtocolToolHint)
  })

  it('stores chat/completions explicitly when switching back', async () => {
    const onDraft = vi.fn()
    const container = await mount({
      availability: { responses: true, gemini: true, messages: true },
      initial: { ...draft, chatProtocol: 'gemini' },
      onDraft
    })

    expect(select().value).toBe('gemini')
    expect(document.querySelector('[data-chat-protocol-hint]')).not.toBeNull()

    await act(async () => {
      select().value = 'chat-completions'
      select().dispatchEvent(new Event('change', { bubbles: true }))
    })

    const updated = onDraft.mock.calls.at(-1)?.[0] as ModelDraft
    expect(updated.chatProtocol).toBe('chat-completions')
    expect(document.querySelector('[data-chat-protocol-hint]')).toBeNull()
  })

  it('offers the Anthropic Messages protocol once an Anthropic endpoint exists', async () => {
    const onDraft = vi.fn()
    await mount({ availability: { responses: false, gemini: false, messages: true }, onDraft })

    expect(option('messages').disabled).toBe(false)
    expect(option('messages').textContent).toBe(labels.chatProtocolMessages)
    expect(option('messages').textContent).not.toContain(labels.chatProtocolEndpointMissing)

    await act(async () => {
      select().value = 'messages'
      select().dispatchEvent(new Event('change', { bubbles: true }))
    })

    expect(onDraft).toHaveBeenLastCalledWith(expect.objectContaining({ chatProtocol: 'messages' }))
    expect(document.querySelector('[data-chat-protocol-hint]')?.textContent).toBe(labels.chatProtocolToolHint)
  })
})
