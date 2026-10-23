// @vitest-environment happy-dom

import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { platformText } from '../../i18n/platformText'
import { AssistantReadOnlyConversationViewer } from './AssistantReadOnlyConversationViewer'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

afterEach(() => {
  document.body.replaceChildren()
  vi.unstubAllGlobals()
})

describe('AssistantReadOnlyConversationViewer', () => {
  it('renders only the exact persisted user/assistant turn', async () => {
    installAssistantApi({
      topics: [topic('assistant-1')],
      messages: [message('user-1', 'user', null, 'Question'), message('assistant-1', 'assistant', 'user-1', 'Exact answer'), message('other', 'assistant', 'user-1', 'Wrong sibling')]
    })
    const container = document.createElement('div')
    const root = createRoot(container)

    await act(async () => {
      root.render(createElement(AssistantReadOnlyConversationViewer, { labels: platformText['en-US'].assistants, unavailableText: 'Unavailable', anchor: anchor() }))
      await Promise.resolve()
    })

    expect(container.textContent).toContain('Question')
    expect(container.textContent).toContain('Exact answer')
    expect(container.textContent).not.toContain('Wrong sibling')
    expect(container.textContent).not.toContain('Unavailable')
  })

  it('fails closed for a foreign topic instead of rendering any conversation', async () => {
    installAssistantApi({
      topics: [topic('other-assistant')],
      messages: [message('user-1', 'user', null, 'Question'), message('assistant-1', 'assistant', 'user-1', 'Wrong answer')]
    })
    const container = document.createElement('div')
    const root = createRoot(container)

    await act(async () => {
      root.render(createElement(AssistantReadOnlyConversationViewer, { labels: platformText['en-US'].assistants, unavailableText: 'Unavailable', anchor: anchor() }))
      await Promise.resolve()
    })

    expect(container.textContent).toContain('Unavailable')
    expect(container.textContent).not.toContain('Question')
    expect(container.textContent).not.toContain('Wrong answer')
  })

  it('hides a programmatic structured input while preserving the exact anchored assistant answer', async () => {
    installAssistantApi({
      topics: [topic('assistant-1')],
      messages: [
        message('user-1', 'user', null, '请基于以下 JSON 输入生成结论。\nINPUT:\n{"schemaVersion":2,"inputHash":"secret"}\nOUTPUT_SCHEMA:\n{}'),
        message('assistant-1', 'assistant', 'user-1', '{"schemaVersion":1,"trend":{"direction":"range"}}')
      ]
    })
    const container = document.createElement('div')
    const root = createRoot(container)

    await act(async () => {
      root.render(createElement(AssistantReadOnlyConversationViewer, {
        labels: platformText['zh-CN'].assistants, unavailableText: '不可用', anchor: anchor(),
        assistantText: 'ETH 处于震荡区间，关注上方压力。'
      }))
      await Promise.resolve()
    })

    expect(container.textContent).toContain('ETH 处于震荡区间')
    expect(container.textContent).not.toContain('INPUT:')
    expect(container.textContent).not.toContain('schemaVersion')
    expect(container.textContent).not.toContain('inputHash')
    expect(container.textContent).not.toContain('schemaVersion')
  })
})

function installAssistantApi(input: { topics: unknown[]; messages: unknown[] }) {
  vi.stubGlobal('window', { platform: { assistants: { listTopics: vi.fn(async () => ({ topics: input.topics })), listTopicMessages: vi.fn(async () => ({ messages: input.messages.map((message) => ({ message })) })) } } })
}

function anchor() {
  return { assistantId: 'assistant-1', topicId: 'topic-1', userMessageId: 'user-1', assistantMessageId: 'assistant-1' }
}

function topic(assistantId: string) {
  return { id: 'topic-1', assistantId, name: 'Exact', isNameManuallyEdited: false, orderKey: 'a', createdAt: '', updatedAt: '' }
}

function message(id: string, role: 'user' | 'assistant', parentId: string | null, text: string) {
  return { id, topicId: 'topic-1', parentId, role, data: { parts: [{ type: 'text', text }] }, searchableText: text, status: 'success', siblingsGroupId: 0, modelId: null, modelSnapshot: null, stats: null, createdAt: '2026-07-19T00:00:00.000Z', updatedAt: '2026-07-19T00:00:00.000Z' }
}
