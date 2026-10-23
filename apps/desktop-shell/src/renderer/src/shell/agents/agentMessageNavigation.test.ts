import { describe, expect, it } from 'vitest'

import type { AgentSessionMessageEntity } from '@platform/ai/agent-platform/schemas/sessionSchemas'

import {
  buildAgentMessageAnchorItems,
  getNavigationTargetIndex,
  getVisibleMessageIndices
} from './agentMessageNavigation'

const createdAt = '2026-01-01T00:00:00.000Z'

function message(
  id: string,
  role: AgentSessionMessageEntity['role'],
  overrides: Partial<AgentSessionMessageEntity> = {}
): AgentSessionMessageEntity {
  return {
    id,
    sessionId: 'session-1',
    role,
    data: { parts: [{ type: 'text', text: overrides.searchableText ?? `${role}-${id}` }] },
    searchableText: overrides.searchableText ?? `${role}-${id}`,
    status: 'success',
    modelId: null,
    modelSnapshot: null,
    stats: null,
    runtimeResumeToken: null,
    createdAt,
    updatedAt: createdAt,
    ...overrides
  }
}

describe('agentMessageNavigation', () => {
  it('builds anchor items from user and assistant messages only', () => {
    expect(
      buildAgentMessageAnchorItems(
        [
          message('user-1', 'user', { searchableText: 'first question' }),
          message('assistant-1', 'assistant', { searchableText: 'first answer' }),
          message('system-1', 'system', { searchableText: 'ignored system' })
        ],
        {
          assistantName: 'Research Agent',
          userName: 'You',
          nonTextContent: '[non-text]'
        }
      )
    ).toEqual([
      {
        id: 'user-1',
        preview: 'first question',
        role: 'user',
        status: 'success',
        title: 'You'
      },
      {
        id: 'assistant-1',
        preview: 'first answer',
        role: 'assistant',
        status: 'success',
        title: 'Research Agent'
      }
    ])
  })

  it('detects the currently visible messages inside the scroll viewport', () => {
    expect(
      getVisibleMessageIndices(
        [
          { top: -30, bottom: 70 },
          { top: 80, bottom: 180 },
          { top: 190, bottom: 290 }
        ],
        200
      )
    ).toEqual([0, 1])
  })

  it('moves to the previous or next message around the visible range', () => {
    expect(getNavigationTargetIndex({ visibleIndices: [1, 2], total: 5, direction: 'previous' })).toBe(0)
    expect(getNavigationTargetIndex({ visibleIndices: [1, 2], total: 5, direction: 'next' })).toBe(3)
  })

  it('stops at the boundaries of the message list', () => {
    expect(getNavigationTargetIndex({ visibleIndices: [0], total: 3, direction: 'previous' })).toBeNull()
    expect(getNavigationTargetIndex({ visibleIndices: [2], total: 3, direction: 'next' })).toBeNull()
  })
})
