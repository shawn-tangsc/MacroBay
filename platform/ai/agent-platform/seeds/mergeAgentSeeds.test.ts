import { describe, expect, it } from 'vitest'

import { mergeAgentSeeds } from './mergeAgentSeeds'

describe('mergeAgentSeeds', () => {
  it('combines generic and product seeds without dropping messages', () => {
    const seed = mergeAgentSeeds(
      { agents: [{ id: 'a' } as never], messagesBySessionId: { s1: [] } },
      { agents: [{ id: 'b' } as never], messagesBySessionId: { s2: [] }, activeAgentId: 'b' }
    )

    expect(seed.agents?.map((agent) => agent.id)).toEqual(['a', 'b'])
    expect(Object.keys(seed.messagesBySessionId ?? {})).toEqual(['s1', 's2'])
    expect(seed.activeAgentId).toBe('b')
  })
})
