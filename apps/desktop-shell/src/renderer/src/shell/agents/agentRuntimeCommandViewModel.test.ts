import { describe, expect, it } from 'vitest'

import { buildAgentRuntimeCommandCard, isAgentRuntimeCommandResultPart } from './agentRuntimeCommandViewModel'

describe('agentRuntimeCommandViewModel', () => {
  it('builds compact rows for context results', () => {
    const card = buildAgentRuntimeCommandCard(
      '/context',
      {
        type: 'context',
        summary: 'Context for Agent',
        sections: [{ label: 'Session', value: 'Demo' }]
      },
      {
        context: 'Context',
        cost: 'Cost',
        todos: 'Todos'
      }
    )

    expect(card.title).toBe('Context')
    expect(card.rows).toEqual([{ label: 'Session', value: 'Demo' }])
  })

  it('detects runtime command result parts', () => {
    expect(
      isAgentRuntimeCommandResultPart({
        type: 'agent-runtime-command-result',
        command: '/cost',
        result: { type: 'cost', summary: 'ok', usage: [] }
      })
    ).toBe(true)
    expect(isAgentRuntimeCommandResultPart({ type: 'text' })).toBe(false)
  })
})
