import { describe, expect, it } from 'vitest'

import type { AgentSessionMessageEntity } from '@platform/ai/agent-platform/schemas/sessionSchemas'

import { formatTokenCount, summarizeAgentSessionTokenUsage } from './agentSessionUsage'

function message(
  overrides: Partial<AgentSessionMessageEntity> & { stats?: AgentSessionMessageEntity['stats'] }
): AgentSessionMessageEntity {
  return {
    id: 'message-1',
    sessionId: 'session-1',
    role: 'assistant',
    data: { parts: [] },
    searchableText: '',
    status: 'success',
    modelId: null,
    modelSnapshot: null,
    stats: null,
    runtimeResumeToken: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides
  }
}

describe('summarizeAgentSessionTokenUsage', () => {
  it('sums persisted assistant stats and ignores user messages', () => {
    expect(
      summarizeAgentSessionTokenUsage([
        message({ id: 'user-1', role: 'user', stats: { totalTokens: 999 } }),
        message({ id: 'assistant-1', stats: { promptTokens: 1200, completionTokens: 80, totalTokens: 1280 } }),
        message({ id: 'assistant-2', stats: { promptTokens: 300, completionTokens: 20 } })
      ])
    ).toEqual({
      promptTokens: 1500,
      completionTokens: 100,
      totalTokens: 1600,
      turnCount: 2
    })
  })

  it('returns null when no assistant turn has stats', () => {
    expect(summarizeAgentSessionTokenUsage([message({ stats: null })])).toBeNull()
  })

  it('formats counts with grouping and guards empty values', () => {
    expect(formatTokenCount(1234567)).toBe('1,234,567')
    expect(formatTokenCount(0)).toBe('0')
  })
})
