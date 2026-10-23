// @vitest-environment happy-dom

import { act, createElement, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { platformText } from '../../i18n/platformText'

import { AssistantMessageRow } from './AssistantMessageRow'

vi.mock('antd', () => ({
  Button: ({ children, icon, onClick, ...props }: { children?: ReactNode; icon?: ReactNode; onClick?: () => void }) =>
    createElement('button', { ...props, onClick }, icon, children),
  Input: {
    TextArea: ({ value = '' }: { value?: string }) => createElement('textarea', { value })
  },
  Popconfirm: ({ children }: { children?: ReactNode }) => createElement('span', null, children)
}))

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

afterEach(() => {
  document.body.replaceChildren()
})

describe('AssistantMessageRow', () => {
  it('does not expose raw runtime role identifiers in the visible message header', () => {
    const labels = platformText['zh-CN'].assistants
    const markup = renderToStaticMarkup(
      <AssistantMessageRow
        labels={labels}
        message={{
          id: 'message-1',
          createdAt: '2026-07-19T09:05:00.000Z',
          role: 'assistant',
          status: 'success',
          text: '你好',
          parts: [{ type: 'text', text: '你好' }],
          modelId: 'openai:gpt-test',
          modelName: 'GPT Test',
          siblingBuckets: [],
          activeSiblingId: 'message-1',
          isLiveOverlay: false
        }}
        siblings={[]}
        confirmDelete={false}
        onSelectSibling={() => undefined}
        onDelete={() => undefined}
        onRegenerate={() => undefined}
        onEditResend={() => undefined}
      />
    )

    expect(markup).not.toContain('>assistant<')
    expect(markup).not.toContain('>user<')
  })

  it('does not reserve a persistent header row for plain user bubbles', () => {
    const labels = platformText['zh-CN'].assistants
    const markup = renderToStaticMarkup(
      <AssistantMessageRow
        labels={labels}
        message={{
          id: 'message-2',
          createdAt: '2026-07-19T09:05:00.000Z',
          role: 'user',
          status: 'success',
          text: '你好',
          parts: [{ type: 'text', text: '你好' }],
          modelId: null,
          modelName: null,
          siblingBuckets: [],
          activeSiblingId: 'message-2',
          isLiveOverlay: false
        }}
        siblings={[]}
        confirmDelete={false}
        onSelectSibling={() => undefined}
        onDelete={() => undefined}
        onRegenerate={() => undefined}
        onEditResend={() => undefined}
      />
    )

    expect(markup).not.toContain('assistant-message-header')
  })

  it('renders assistant markdown instead of exposing raw markdown markers', () => {
    const labels = platformText['zh-CN'].assistants
    const markup = renderToStaticMarkup(
      <AssistantMessageRow
        labels={labels}
        message={{
          id: 'message-3',
          createdAt: '2026-07-19T09:05:00.000Z',
          role: 'assistant',
          status: 'success',
          text: [
            '## 能力清单',
            '',
            '**输出结果：**',
            '- 文件：`hello.py`',
            '- 状态：运行成功',
            '',
            '```',
            'console.log("hi")',
            '```'
          ].join('\n'),
          parts: [
            {
              type: 'text',
              text: [
                '## 能力清单',
                '',
                '**输出结果：**',
                '- 文件：`hello.py`',
                '- 状态：运行成功',
                '',
                '```',
                'console.log("hi")',
                '```'
              ].join('\n')
            }
          ],
          modelId: null,
          modelName: null,
          siblingBuckets: [],
          activeSiblingId: 'message-3',
          isLiveOverlay: false
        }}
        siblings={[]}
        confirmDelete={false}
        onSelectSibling={() => undefined}
        onDelete={() => undefined}
        onRegenerate={() => undefined}
        onEditResend={() => undefined}
      />
    )

    expect(markup).toContain('<h2>能力清单</h2>')
    expect(markup).toContain('<strong>输出结果：</strong>')
    expect(markup).toContain('<code>hello.py</code>')
    expect(markup).toContain('<pre class="chat-markdown-code"><code>console.log(&quot;hi&quot;)</code></pre>')
    expect(markup).not.toContain('## 能力清单')
    expect(markup).not.toContain('**输出结果：**')
    expect(markup).not.toContain('```')
  })

  it('renders Web Search cards and source citations without exposing secrets', () => {
    const labels = platformText['en-US'].assistants
    const markup = renderToStaticMarkup(
      <AssistantMessageRow
        labels={labels}
        message={{
          id: 'message-4',
          createdAt: '2026-07-19T09:05:00.000Z',
          role: 'assistant',
          status: 'success',
          text: 'Answer with citation.',
          parts: [
            {
              type: 'web-search',
              toolName: 'web_search',
              status: 'success',
              providerId: 'tavily',
              query: 'docs',
              sources: [{ id: 1, title: 'Docs', url: 'https://example.com/docs', snippet: 'Short source summary' }]
            },
            { type: 'text', text: 'Answer with citation.' }
          ],
          modelId: null,
          modelName: null,
          siblingBuckets: [],
          activeSiblingId: 'message-4',
          isLiveOverlay: false
        }}
        siblings={[]}
        confirmDelete={false}
        onSelectSibling={() => undefined}
        onDelete={() => undefined}
        onRegenerate={() => undefined}
        onEditResend={() => undefined}
      />
    )

    expect(markup).toContain('Web Search')
    expect(markup).toContain('Docs')
    expect(markup).toContain('https://example.com/docs')
    expect(markup).not.toContain('apiKey')
    expect(markup).not.toContain('tvly-secret')
  })

  it('renders a timestamp and the user action matrix without runtime role labels', () => {
    const labels = platformText['en-US'].assistants
    const markup = renderToStaticMarkup(
      <AssistantMessageRow
        labels={labels}
        language="en-US"
        message={{
          id: 'user-message',
          createdAt: '2026-07-19T09:05:00.000Z',
          role: 'user',
          status: 'success',
          text: 'Copy this',
          parts: [{ type: 'text', text: 'Copy this' }],
          modelId: null,
          modelName: null,
          siblingBuckets: [],
          activeSiblingId: 'user-message',
          isLiveOverlay: false
        }}
        siblings={[]}
        confirmDelete={false}
        isTopicStreaming={false}
        onSelectSibling={() => undefined}
        onDelete={() => undefined}
        onRegenerate={() => undefined}
        onEditResend={() => undefined}
      />
    )

    // 时间戳的完整形态取决于「消息是不是今天」（同一天只给 HH:MM，跨天带短日期），旧断言把"同一天"
    // 当成前提，于是运行日期一过 2026-07-19 就变红 —— 是断言脆弱，不是渲染回归。这里锁定的是：
    // 一个 <time> 元素、dateTime 来自 createdAt、文本始终精确到分钟。
    const timestamp = markup.match(/<time class="assistant-message-timestamp" dateTime="([^"]+)">([^<]+)<\/time>/)
    expect(timestamp?.[1]).toBe('2026-07-19T09:05:00.000Z')
    expect(timestamp?.[2]).toMatch(/\d{2}:\d{2}/)
    expect(markup).toContain('aria-label="Copy message"')
    expect(markup).toContain('aria-label="Edit message"')
    expect(markup).toContain('aria-label="Delete message"')
    expect(markup).not.toContain('aria-label="Regenerate"')
  })

  it('only exposes stable-body copy while the topic is streaming', () => {
    const labels = platformText['en-US'].assistants
    const markup = renderToStaticMarkup(
      <AssistantMessageRow
        labels={labels}
        language="en-US"
        message={{
          id: 'assistant-message',
          createdAt: '2026-07-19T09:05:00.000Z',
          role: 'assistant',
          status: 'success',
          text: 'Stable answer',
          parts: [{ type: 'text', text: 'Stable answer' }],
          modelId: 'openai:gpt-test',
          modelName: 'GPT Test',
          siblingBuckets: [],
          activeSiblingId: 'assistant-message',
          isLiveOverlay: false
        }}
        siblings={[]}
        parentUserMessageId="user-message"
        confirmDelete={true}
        isTopicStreaming
        onSelectSibling={() => undefined}
        onDelete={() => undefined}
        onRegenerate={() => undefined}
        onEditResend={() => undefined}
      />
    )

    expect(markup).toContain('aria-label="Copy message"')
    expect(markup).not.toContain('aria-label="Regenerate"')
    expect(markup).not.toContain('aria-label="Delete message"')
  })

  it('does not expose actions for system messages', () => {
    const labels = platformText['en-US'].assistants
    const markup = renderToStaticMarkup(
      <AssistantMessageRow
        labels={labels}
        language="en-US"
        message={{
          id: 'system-message',
          createdAt: '2026-07-19T09:05:00.000Z',
          role: 'system',
          status: 'success',
          text: 'System context',
          parts: [{ type: 'text', text: 'System context' }],
          modelId: null,
          modelName: null,
          siblingBuckets: [],
          activeSiblingId: 'system-message',
          isLiveOverlay: false
        }}
        siblings={[]}
        confirmDelete={true}
        isTopicStreaming={false}
        onSelectSibling={() => undefined}
        onDelete={() => undefined}
        onRegenerate={() => undefined}
        onEditResend={() => undefined}
      />
    )

    expect(markup).not.toContain('assistant-message-actions')
  })

  it('uses the localized stopped state instead of a persisted runtime sentence', () => {
    const labels = platformText['en-US'].assistants
    const markup = renderToStaticMarkup(
      <AssistantMessageRow
        labels={labels}
        message={{
          id: 'paused-message',
          createdAt: '2026-07-19T09:05:00.000Z',
          role: 'assistant',
          status: 'paused',
          text: '',
          parts: [{ type: 'interruption', message: '' }],
          modelId: null,
          modelName: null,
          siblingBuckets: [],
          activeSiblingId: 'paused-message',
          isLiveOverlay: false
        }}
        siblings={[]}
        confirmDelete={true}
        onSelectSibling={() => undefined}
        onDelete={() => undefined}
        onRegenerate={() => undefined}
        onEditResend={() => undefined}
      />
    )

    expect(markup).toContain('Generation stopped')
    expect(markup).not.toContain('Waiting for reply')
  })

  it('uses the localized stopped state for paused model cohorts too', () => {
    const labels = platformText['en-US'].assistants
    const sibling = {
      id: 'paused-sibling',
      topicId: 'topic',
      parentId: 'user-message',
      role: 'assistant' as const,
      data: { parts: [{ type: 'interruption', message: '' }] },
      searchableText: '',
      status: 'paused' as const,
      siblingsGroupId: 1,
      modelId: 'openai:gpt-test',
      modelSnapshot: { id: 'gpt-test', name: 'GPT Test', provider: 'openai' },
      stats: null,
      createdAt: '2026-07-19T09:05:00.000Z',
      updatedAt: '2026-07-19T09:05:00.000Z'
    }
    const markup = renderToStaticMarkup(
      <AssistantMessageRow
        labels={labels}
        message={{
          id: sibling.id,
          createdAt: sibling.createdAt,
          role: sibling.role,
          status: sibling.status,
          text: '',
          parts: sibling.data.parts,
          modelId: sibling.modelId,
          modelName: sibling.modelSnapshot.name,
          siblingBuckets: [
            { modelId: 'openai:gpt-test', messages: [sibling] },
            { modelId: 'openai:gpt-other', messages: [sibling] }
          ],
          activeSiblingId: sibling.id,
          isLiveOverlay: false
        }}
        siblings={[sibling]}
        confirmDelete={true}
        onSelectSibling={() => undefined}
        onDelete={() => undefined}
        onRegenerate={() => undefined}
        onEditResend={() => undefined}
      />
    )

    expect(markup).toContain('Generation stopped')
    expect(markup).not.toContain('Waiting for reply')
  })

  it('localizes provider error codes without rendering a persisted error payload', () => {
    const labels = platformText['en-US'].assistants
    const fixture = 'fixture-assistant-error-key-1234567890'
    const markup = renderToStaticMarkup(
      <AssistantMessageRow
        labels={labels}
        language="en-US"
        message={{
          id: 'provider-error',
          createdAt: '2026-07-19T09:05:00.000Z',
          role: 'assistant',
          status: 'error',
          text: `upstream payload ${fixture}`,
          parts: [{ type: 'error', code: 'provider-configuration-required', message: `upstream payload ${fixture}` }],
          modelId: 'openai:gpt-test',
          modelName: 'GPT Test',
          siblingBuckets: [],
          activeSiblingId: 'provider-error',
          isLiveOverlay: false
        }}
        siblings={[]}
        confirmDelete={true}
        onSelectSibling={() => undefined}
        onDelete={() => undefined}
        onRegenerate={() => undefined}
        onEditResend={() => undefined}
      />
    )

    expect(markup).toContain('Configure an enabled model service before trying again.')
    expect(markup).not.toContain(fixture)
    expect(markup).not.toContain('provider-configuration-required')
  })

  it('uses the localized generic failure for request and unknown provider error codes', () => {
    const labels = platformText['zh-CN'].assistants
    const fixture = 'fixture-assistant-ref-payload-1234567890'
    const requestMarkup = renderToStaticMarkup(
      <AssistantMessageRow
        labels={labels}
        language="zh-CN"
        message={{
          id: 'provider-request-error',
          createdAt: '2026-07-19T09:05:00.000Z',
          role: 'assistant',
          status: 'error',
          text: fixture,
          parts: [{ type: 'error', code: 'provider-request-failed', message: fixture }],
          modelId: null,
          modelName: null,
          siblingBuckets: [],
          activeSiblingId: 'provider-request-error',
          isLiveOverlay: false
        }}
        siblings={[]}
        confirmDelete={true}
        onSelectSibling={() => undefined}
        onDelete={() => undefined}
        onRegenerate={() => undefined}
        onEditResend={() => undefined}
      />
    )
    const unknownMarkup = renderToStaticMarkup(
      <AssistantMessageRow
        labels={labels}
        language="zh-CN"
        message={{
          id: 'provider-unknown-error',
          createdAt: '2026-07-19T09:05:00.000Z',
          role: 'assistant',
          status: 'error',
          text: fixture,
          parts: [{ type: 'error', code: fixture, message: fixture }],
          modelId: null,
          modelName: null,
          siblingBuckets: [],
          activeSiblingId: 'provider-unknown-error',
          isLiveOverlay: false
        }}
        siblings={[]}
        confirmDelete={true}
        onSelectSibling={() => undefined}
        onDelete={() => undefined}
        onRegenerate={() => undefined}
        onEditResend={() => undefined}
      />
    )

    expect(requestMarkup).toContain('模型请求失败，请重试。')
    expect(unknownMarkup).toContain('模型请求失败，请重试。')
    expect(requestMarkup).not.toContain(fixture)
    expect(unknownMarkup).not.toContain(fixture)
  })

  it('deletes directly when message deletion confirmation is disabled', async () => {
    const labels = platformText['en-US'].assistants
    const onDelete = vi.fn()
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)

    await act(async () => {
      root.render(
        <AssistantMessageRow
          labels={labels}
          message={{
            id: 'user-message',
            createdAt: '2026-07-19T09:05:00.000Z',
            role: 'user',
            status: 'success',
            text: 'Delete this message',
            parts: [{ type: 'text', text: 'Delete this message' }],
            modelId: null,
            modelName: null,
            siblingBuckets: [],
            activeSiblingId: 'user-message',
            isLiveOverlay: false
          }}
          siblings={[]}
          confirmDelete={false}
          onSelectSibling={() => undefined}
          onDelete={onDelete}
          onRegenerate={() => undefined}
          onEditResend={() => undefined}
        />
      )
    })

    await act(async () => {
      container.querySelector<HTMLButtonElement>('[aria-label="Delete message"]')?.click()
    })

    expect(onDelete).toHaveBeenCalledExactlyOnceWith('user-message')
    await act(async () => root.unmount())
  })
})
