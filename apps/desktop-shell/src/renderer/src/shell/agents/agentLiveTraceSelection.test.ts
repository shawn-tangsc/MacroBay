import { describe, expect, it } from 'vitest'

import type { AgentRuntimeActivityCard } from './agentRuntimeActivityViewModel'
import { hasPersistedRuntimeParts, selectLiveActivityCards } from './agentLiveTraceSelection'

function card(overrides: Partial<AgentRuntimeActivityCard>): AgentRuntimeActivityCard {
  return {
    key: 'tool:1',
    kind: 'tool',
    title: 'Bash',
    status: 'done',
    subtitle: 'pnpm test',
    detail: null,
    approvalId: null,
    toolCallId: '1',
    ...overrides
  }
}

describe('hasPersistedRuntimeParts', () => {
  it('detects persisted runtime parts on a streamed assistant message', () => {
    expect(
      hasPersistedRuntimeParts([
        { data: { parts: [{ type: 'text', text: 'answer' }] } },
        { data: { parts: [{ type: 'claude-sdk-tool-call', source: 'claude-agent-sdk' }] } }
      ] as never)
    ).toBe(true)
  })

  it('stays false for a turn whose message only holds text', () => {
    expect(
      hasPersistedRuntimeParts([
        { data: { parts: [{ type: 'text', text: 'answer' }] } }
      ] as never)
    ).toBe(false)
    expect(hasPersistedRuntimeParts([])).toBe(false)
  })
})

describe('selectLiveActivityCards', () => {
  it('keeps every live card before the message has persisted the turn', () => {
    const cards = [card({}), card({ key: 'reasoning:1', kind: 'reasoning' })]
    expect(selectLiveActivityCards(cards, false)).toEqual(cards)
  })

  it('drops the duplicated trace once the message carries it, keeping pending approvals', () => {
    const approval = card({
      key: 'approval:1',
      kind: 'approval',
      status: 'pending',
      title: 'Bash',
      approvalId: 'approval-1'
    })
    expect(selectLiveActivityCards([card({}), approval], true)).toEqual([approval])
  })

  it('hides the live panel entirely when the message already shows a settled trace', () => {
    expect(selectLiveActivityCards([card({})], true)).toEqual([])
  })
})
