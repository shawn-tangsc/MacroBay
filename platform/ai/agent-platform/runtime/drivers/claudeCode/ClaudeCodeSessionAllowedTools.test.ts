import { describe, expect, it } from 'vitest'

import type { AgentRuntimeComposition } from '../../AgentRuntimeCompositionService'
import { buildClaudeCodeSettingsFromComposition } from './ClaudeCodeSettingsBuilder'
import { buildClaudeCodeToolPolicyFromSettings } from './ClaudeCodeToolPolicy'

function builtin(id: string, approval: 'auto' | 'prompt') {
  return { id, name: id, origin: 'builtin' as const, approval }
}

/**
 * WebSearch/WebFetch are present in the built-in surface but not pre-approved for this agent:
 * exactly the state a scheduled session starts from before it opts into a tool for one run.
 */
function composition(overrides: Partial<AgentRuntimeComposition> = {}): AgentRuntimeComposition {
  return {
    agentId: 'agent-1',
    sessionId: 'session-1',
    agentType: 'claude-code',
    instructions: null,
    modelId: 'provider:model-a',
    modelName: null,
    permissionMode: 'default',
    workspacePath: '/tmp/workspace',
    workspaceType: 'user',
    environment: {},
    tools: {
      all: [builtin('Read', 'auto'), builtin('WebSearch', 'prompt'), builtin('WebFetch', 'prompt')],
      enabled: [builtin('Read', 'auto')],
      disabled: []
    },
    mcp: { sources: [], servers: [] },
    skills: { skills: [], toolIds: [] },
    ...overrides
  } as AgentRuntimeComposition
}

describe('session-scoped allowed tools', () => {
  it('adds the builtin tools a session opted into on top of the agent allowlist', () => {
    const settings = buildClaudeCodeSettingsFromComposition({
      ...composition(),
      sessionAllowedTools: ['WebSearch', 'WebFetch']
    })

    expect(settings.allowedTools).toEqual(['Read', 'WebSearch', 'WebFetch'])
    expect(buildClaudeCodeToolPolicyFromSettings(settings).canUseTool('WebSearch')).toEqual({
      kind: 'allow',
      toolName: 'WebSearch'
    })
  })

  it('leaves another session without the allowlist on the agent defaults', () => {
    const settings = buildClaudeCodeSettingsFromComposition(composition())

    expect(settings.allowedTools).toEqual(['Read'])
    expect(buildClaudeCodeToolPolicyFromSettings(settings).canUseTool('WebSearch')).toEqual({
      kind: 'prompt',
      toolName: 'WebSearch'
    })
  })

  it('never lets a session allow a tool the agent disabled', () => {
    const settings = buildClaudeCodeSettingsFromComposition({
      ...composition({
        tools: {
          all: [builtin('Read', 'auto'), builtin('WebSearch', 'prompt')],
          enabled: [builtin('Read', 'auto')],
          disabled: [builtin('WebSearch', 'prompt')]
        }
      }),
      sessionAllowedTools: ['WebSearch']
    })

    expect(settings.allowedTools).not.toContain('WebSearch')
    expect(settings.disallowedTools).toContain('WebSearch')
    expect(buildClaudeCodeToolPolicyFromSettings(settings).canUseTool('WebSearch')).toEqual({
      kind: 'deny',
      toolName: 'WebSearch',
      reason: 'tool-disabled'
    })
  })

  it('drops unknown, duplicated and non-builtin session names', () => {
    const settings = buildClaudeCodeSettingsFromComposition({
      ...composition(),
      sessionAllowedTools: ['WebSearch', 'WebSearch', 'mcp__filesystem__readFile', 'NotATool', '   ']
    })

    expect(settings.allowedTools).toEqual(['Read', 'WebSearch'])
  })

  it('keeps the agent allowlist byte-identical when the session carries no tools', () => {
    const base = buildClaudeCodeSettingsFromComposition(composition())
    const withoutField = buildClaudeCodeSettingsFromComposition({ ...composition(), sessionAllowedTools: [] })

    expect(withoutField.allowedTools).toEqual(base.allowedTools)
    expect(withoutField.disallowedTools).toEqual(base.disallowedTools)
  })
})
