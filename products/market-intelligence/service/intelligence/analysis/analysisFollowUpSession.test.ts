import { describe, expect, it } from 'vitest'
import { createAnalysisFollowUpSession } from './analysisFollowUpSession'

describe('analysis follow-up session binding', () => {
  it('creates only on demand and reuses a persisted session across reloads and simultaneous requests', async () => {
    const sessions: { id: string; agentId: string; description?: string }[] = []
    const deps = {
      getAgentState: async () => ({ sessions }),
      createAgentSession: async (input: { agentId: string; description?: string }) => {
        const session = { ...input, id: `s-${sessions.length}` }
        sessions.push(session)
        return session
      }
    }
    const create = createAnalysisFollowUpSession(deps)
    expect(sessions).toEqual([])
    const input = { agentId: 'crypto-market-analyst', eventGroupId: 'mi-eg-1', analysisRunId: 'mi-ar-1' }
    expect(await Promise.all([create(input), create(input)])).toEqual(['s-0', 's-0'])
    expect(await createAnalysisFollowUpSession(deps)({ ...input, analysisRunId: 'mi-ar-2' })).toBe('s-0')
    expect(sessions).toHaveLength(1)
    await expect(create({ ...input, existingSessionId: 'foreign' })).rejects.toThrow('analysis-follow-up-unavailable')
    expect(sessions).toHaveLength(1)
  })
})
