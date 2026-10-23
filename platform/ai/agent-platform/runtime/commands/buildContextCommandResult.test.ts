import { describe, expect, it } from 'vitest'

import { buildContextCommandResult } from './buildContextCommandResult'

describe('buildContextCommandResult', () => {
  it('summarizes agent session workspace and capability counts', () => {
    const result = buildContextCommandResult({
      agentName: 'Code Assistant',
      agentType: 'claude-code',
      sessionName: 'New agent session',
      sessionId: 'session-1',
      workspacePath: '/tmp/workspace',
      workspaceType: 'user',
      runtimeRoute: 'direct',
      warmState: 'warm',
      enabledMcpCount: 2,
      enabledSkillCount: 1,
      enabledToolCount: 8,
      recentMessageCount: 12
    })

    expect(result.type).toBe('context')
    expect(result.summary).toContain('Code Assistant')
    expect(result.sections).toEqual(
      expect.arrayContaining([
        { label: 'Runtime route', value: 'direct' },
        { label: 'Enabled MCP servers', value: '2' },
        { label: 'Recent messages', value: '12' }
      ])
    )
  })
})
