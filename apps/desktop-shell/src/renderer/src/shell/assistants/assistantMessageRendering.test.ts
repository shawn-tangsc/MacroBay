import { describe, expect, it } from 'vitest'

import { mergeAssistantStreamOverlay, selectAssistantSiblingIndex } from './assistantMessageRendering'

describe('assistantMessageRendering', () => {
  it('merges live stream overlay over persisted assistant text', () => {
    const rendered = mergeAssistantStreamOverlay(
      [
        {
          message: {
            id: 'assistant-1',
            topicId: 'topic-1',
            parentId: 'user-1',
            role: 'assistant',
            data: { parts: [{ type: 'text', text: 'Hel' }] },
            searchableText: 'Hel',
            status: 'pending',
            siblingsGroupId: 0,
            modelId: 'openai:gpt-test',
            modelSnapshot: { id: 'gpt-test', name: 'GPT Test', provider: 'openai' },
            stats: null,
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z'
          }
        }
      ],
      {
        topicId: 'topic-1',
        status: 'streaming',
        activeExecutions: [{ executionId: 'exec-1', anchorMessageId: 'assistant-1' }],
        awaitingApprovalAnchors: [],
        updatedAt: '2026-01-01T00:00:00.000Z'
      },
      [{ topicId: 'topic-1', executionId: 'exec-1', chunk: { type: 'text-delta', text: 'Hello world' } }]
    )

    expect(rendered[0]?.text).toBe('Hello world')
    expect(rendered[0]?.parts).toEqual([{ type: 'text', text: 'Hel' }])
    expect(rendered[0]?.createdAt).toBe('2026-01-01T00:00:00.000Z')
    expect(rendered[0]?.isLiveOverlay).toBe(true)
  })

  it('selects sibling index for navigator', () => {
    const siblings = [{ id: 'a' }, { id: 'b' }] as Array<{ id: string }>
    expect(selectAssistantSiblingIndex(siblings as never, 'b')).toBe(1)
  })
})
