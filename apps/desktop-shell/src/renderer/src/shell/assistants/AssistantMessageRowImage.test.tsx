// @vitest-environment happy-dom

import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import type { AssistantMessagePart } from '@platform/ai/assistant-platform/schemas/messageSchemas'
import { platformText } from '../../i18n/platformText'
import { AssistantMessageRow } from './AssistantMessageRow'

/**
 * T2：图片消息就是普通 assistant/user 消息（带 image part），
 * 所以它必须走消息行的既有排版：渲染卡片、不要「等待回复」、失败用 reasonCode 翻人话、
 * 且不提供「重新生成 / 编辑重发」（图片消息没有可重放的文本上下文）。
 */
vi.mock('antd', () => ({
  Button: ({ children, icon, onClick, ...props }: { children?: ReactNode; icon?: ReactNode; onClick?: () => void }) =>
    createElement('button', { ...props, onClick }, icon, children),
  Input: {
    TextArea: ({ value = '' }: { value?: string }) => createElement('textarea', { value })
  },
  Popconfirm: ({ children }: { children?: ReactNode }) => createElement('span', null, children),
  Image: ({ src, alt }: { src?: string; alt?: string }) => createElement('img', { src, alt })
}))

const labels = platformText['en-US'].assistants
const models = platformText['en-US'].models

function message(parts: AssistantMessagePart[], role: 'assistant' | 'user' = 'assistant') {
  return {
    id: 'message-1',
    createdAt: '2026-07-19T09:05:00.000Z',
    role,
    status: 'success' as const,
    text: parts
      .flatMap((part) => (part.type === 'text' && typeof part.text === 'string' ? [part.text] : []))
      .join('\n'),
    parts,
    modelId: 'acme:acme-image',
    modelName: 'Acme Image',
    siblingBuckets: [],
    activeSiblingId: 'message-1',
    isLiveOverlay: false
  }
}

function render(parts: AssistantMessagePart[], role: 'assistant' | 'user' = 'assistant'): string {
  return renderToStaticMarkup(
    createElement(AssistantMessageRow, {
      labels,
      message: message(parts, role),
      siblings: [],
      parentUserMessageId: 'user-1',
      confirmDelete: false,
      onSelectSibling: () => undefined,
      onDelete: () => undefined,
      onRegenerate: () => undefined,
      onEditResend: () => undefined
    })
  )
}

describe('AssistantMessageRow image parts', () => {
  it('renders the image card and does not fall back to the pending sentence', () => {
    const markup = render([
      {
        type: 'image',
        kind: 'image',
        mime: 'image/png',
        fileName: '0123456789abcdef.png',
        byteLength: 128
      }
    ])

    expect(markup).toContain('app-image://generated-images/0123456789abcdef.png')
    expect(markup).not.toContain('data:')
    expect(markup).not.toContain(labels.pendingMessage)
    // 图片消息不提供重新生成
    expect(markup).not.toContain(labels.regenerate)
  })

  it('renders the persisted generating placeholder as image wording, not the generic pending sentence', () => {
    const generating = render([{ type: 'image-generation', status: 'generating', operation: 'generate' }])

    expect(generating).toContain(labels.imageGenerating)
    expect(generating).not.toContain(labels.pendingMessage)
    expect(render([{ type: 'image-generation', status: 'generating', operation: 'edit' }])).toContain(
      labels.imageEditGenerating
    )
  })

  it('shows the localized reason for an image failure and renders no image', () => {
    const markup = render([{ type: 'error', message: 'HTTP 401 · Unauthorized', reasonCode: 'http_401' }])

    expect(markup).toContain(models.connectionCheckReasonUnauthorized)
    expect(markup).not.toContain('<img')
  })

  it('renders the user source image plus the edit prompt as one user bubble', () => {
    const markup = render(
      [
        {
          type: 'image',
          kind: 'image',
          mime: 'image/png',
          fileName: '0123456789abcdef.png',
          byteLength: 128
        },
        { type: 'text', text: 'make it blue' }
      ],
      'user'
    )

    expect(markup).toContain('app-image://generated-images/0123456789abcdef.png')
    expect(markup).toContain('make it blue')
    // 用户图片消息不提供「编辑」（编辑会丢掉原图）
    expect(markup).not.toContain(labels.editMessage)
  })
})
