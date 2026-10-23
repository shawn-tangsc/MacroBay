import { describe, expect, it } from 'vitest'

import type { AssistantMessageEntity } from '@platform/ai/assistant-platform/schemas/messageSchemas'
import { collectAssistantImageParts } from './assistantImageParts'

/**
 * T3：会话内可编辑原图的收集（去重、按会话顺序）。
 * 非图片 part（文本 / 工具 / 错误）一律跳过；没有 image part 的消息不产生候选。
 */
function message(id: string, parts: AssistantMessageEntity['data']['parts']): { message: AssistantMessageEntity } {
  return {
    message: {
      id,
      topicId: 'topic-1',
      parentId: null,
      role: 'assistant',
      data: { parts },
      searchableText: '',
      status: 'success',
      siblingsGroupId: 0,
      modelId: null,
      modelSnapshot: null,
      stats: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z'
    }
  }
}

const first = {
  type: 'image' as const,
  kind: 'image' as const,
  mime: 'image/png',
  fileName: '0123456789abcdef.png',
  byteLength: 10
}
const second = {
  type: 'image' as const,
  kind: 'image' as const,
  mime: 'image/webp',
  fileName: 'fedcba9876543210.webp',
  byteLength: 20
}

describe('collectAssistantImageParts', () => {
  it('collects image parts in conversation order and de-duplicates by file name', () => {
    expect(
      collectAssistantImageParts([
        message('m1', [{ type: 'text', text: 'hello' }]),
        message('m2', [first]),
        message('m3', [second, first]),
        message('m4', [{ type: 'error', message: 'boom', reasonCode: 'http_401' }])
      ])
    ).toEqual([first, second])
  })

  it('ignores malformed image-like parts', () => {
    expect(
      collectAssistantImageParts([
        message('m1', [{ type: 'image' } as never, { type: 'image', kind: 'image' } as never])
      ])
    ).toEqual([])
  })
})
