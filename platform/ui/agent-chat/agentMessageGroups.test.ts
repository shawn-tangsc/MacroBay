import { describe, expect, it } from 'vitest'

import type { AgentSessionMessageEntity } from '@platform/ai/agent-platform/schemas/sessionSchemas'

import { groupAgentSessionMessages, sortAgentSessionMessages } from './agentMessageGroups'

function message(
  input: Partial<AgentSessionMessageEntity> & Pick<AgentSessionMessageEntity, 'id' | 'role'>
): AgentSessionMessageEntity {
  return {
    id: input.id,
    sessionId: input.sessionId ?? 'session-1',
    role: input.role,
    data: input.data ?? { parts: [] },
    searchableText: input.searchableText ?? '',
    status: input.status ?? 'success',
    modelId: null,
    modelSnapshot: null,
    stats: null,
    runtimeResumeToken: null,
    createdAt: input.createdAt ?? '2026-10-22T06:39:06.706Z',
    updatedAt: input.updatedAt ?? '2026-10-22T06:39:06.706Z'
  }
}

describe('agent message order', () => {
  it('puts the user message before an instant assistant error that shares its timestamps', () => {
    // Real failure data: the runtime wrote both rows in the same millisecond, and the
    // assistant id (`assistant-agent-run-…`) sorts before the user id (`message-…`).
    const createdAt = '2026-10-22T06:39:06.706Z'
    const messages = [
      message({ id: 'assistant-agent-run-mvj67he3-7uvxk7', role: 'assistant', status: 'error', createdAt, updatedAt: createdAt }),
      message({ id: 'message-mvj67hea-wue5wu', role: 'user', createdAt, updatedAt: createdAt })
    ]

    expect(sortAgentSessionMessages(messages).map((item) => item.role)).toEqual(['user', 'assistant'])
    expect(groupAgentSessionMessages(messages).map((group) => group.role)).toEqual(['user', 'assistant'])
  })

  it('keeps a completed assistant reply after its user message', () => {
    const createdAt = '2026-10-22T08:32:44.887Z'
    const messages = [
      message({ id: 'assistant-agent-run-mvja9mc2', role: 'assistant', createdAt, updatedAt: '2026-10-22T08:32:52.794Z' }),
      message({ id: 'message-mvja9mc7', role: 'user', createdAt, updatedAt: createdAt })
    ]

    expect(sortAgentSessionMessages(messages).map((item) => item.role)).toEqual(['user', 'assistant'])
  })
})
