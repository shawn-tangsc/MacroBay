import { describe, expect, it } from 'vitest'

import { buildCostCommandResult } from './buildCostCommandResult'

describe('buildCostCommandResult', () => {
  it('reports empty usage when no stats exist', () => {
    const result = buildCostCommandResult({
      messageCount: 3,
      messagesWithStats: 0,
      promptTokens: 0,
      completionTokens: 0,
      thoughtsTokens: 0,
      totalTokens: 0
    })

    expect(result.type).toBe('cost')
    expect(result.summary).toContain('No token usage stats')
    expect(result.usage.find((item) => item.label === 'Total tokens')?.value).toBe('0')
  })

  it('summarizes aggregated token usage', () => {
    const result = buildCostCommandResult({
      messageCount: 4,
      messagesWithStats: 2,
      promptTokens: 120,
      completionTokens: 80,
      thoughtsTokens: 10,
      totalTokens: 210
    })

    expect(result.summary).toContain('2 message(s)')
    expect(result.usage).toEqual(
      expect.arrayContaining([
        { label: 'Prompt tokens', value: '120' },
        { label: 'Total tokens', value: '210' }
      ])
    )
  })
})
