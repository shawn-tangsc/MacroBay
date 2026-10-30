import { describe, expect, it } from 'vitest'

import type { AgentRuntimeComposition } from '../../AgentRuntimeCompositionService'
import { buildClaudeCodeSettingsFromComposition } from './ClaudeCodeSettingsBuilder'
import { buildClaudeCodeToolPolicyFromSettings } from './ClaudeCodeToolPolicy'

function builtin(id: string, approval: 'auto' | 'prompt') {
  return { id, name: id, origin: 'builtin' as const, approval }
}

function composition(overrides: Partial<AgentRuntimeComposition> = {}): AgentRuntimeComposition {
  return {
    agentId: 'agent-1',
    sessionId: 'session-1',
    agentType: 'claude-code',
    instructions: null,
    modelId: 'tokenrhythm:deepseek-v4.1-flash-1017',
    modelName: null,
    permissionMode: 'default',
    workspacePath: '/tmp/workspace',
    workspaceType: 'user',
    environment: {},
    tools: {
      all: [builtin('Read', 'auto'), builtin('WebSearch', 'prompt'), builtin('WebFetch', 'prompt')],
      enabled: [builtin('Read', 'auto'), builtin('WebSearch', 'prompt'), builtin('WebFetch', 'prompt')],
      disabled: []
    },
    mcp: { sources: [], servers: [] },
    skills: { skills: [], toolIds: [] },
    ...overrides
  } as AgentRuntimeComposition
}

describe('provider-gated Anthropic server-side web tools', () => {
  it('removes WebSearch/WebFetch from allowed and disallows them for an unsupported provider', () => {
    const settings = buildClaudeCodeSettingsFromComposition(composition(), {
      serverWebToolsSupported: false
    })

    expect(settings.allowedTools).toEqual(['Read'])
    expect(settings.disallowedTools).toEqual(['WebSearch', 'WebFetch'])

    const policy = buildClaudeCodeToolPolicyFromSettings(settings)
    expect(policy.canUseTool('Read')).toEqual({ kind: 'allow', toolName: 'Read' })
    expect(policy.canUseTool('WebSearch')).toEqual({
      kind: 'deny',
      toolName: 'WebSearch',
      reason: 'tool-disabled'
    })
    expect(policy.canUseTool('WebFetch')).toEqual({
      kind: 'deny',
      toolName: 'WebFetch',
      reason: 'tool-disabled'
    })
  })

  it('keeps the tool set unchanged for a supported provider', () => {
    const settings = buildClaudeCodeSettingsFromComposition(composition(), {
      serverWebToolsSupported: true
    })

    expect(settings.allowedTools).toEqual(['Read', 'WebSearch', 'WebFetch'])
    expect(settings.disallowedTools).toEqual([])
    expect(buildClaudeCodeToolPolicyFromSettings(settings).canUseTool('WebSearch')).toEqual({
      kind: 'allow',
      toolName: 'WebSearch'
    })
  })

  it('keeps the pre-change behavior when the caller cannot determine provider capability', () => {
    const settings = buildClaudeCodeSettingsFromComposition(composition())

    expect(settings.allowedTools).toEqual(['Read', 'WebSearch', 'WebFetch'])
    expect(settings.disallowedTools).toEqual([])
  })

  it('never lets a session allowlist reintroduce an unsupported server tool', () => {
    const settings = buildClaudeCodeSettingsFromComposition({
      ...composition(),
      sessionAllowedTools: ['WebSearch', 'WebFetch']
    }, { serverWebToolsSupported: false })

    expect(settings.allowedTools).toEqual(['Read'])
    expect(settings.disallowedTools).toEqual(['WebSearch', 'WebFetch'])
  })

  it('does not duplicate an agent deny that already lists WebSearch', () => {
    const settings = buildClaudeCodeSettingsFromComposition({
      ...composition(),
      tools: {
        all: [builtin('Read', 'auto'), builtin('WebSearch', 'prompt')],
        enabled: [builtin('Read', 'auto')],
        disabled: [builtin('WebSearch', 'prompt')]
      }
    }, { serverWebToolsSupported: false })

    expect(settings.disallowedTools).toEqual(['WebSearch', 'WebFetch'])
    expect(buildClaudeCodeToolPolicyFromSettings(settings).canUseTool('WebSearch')).toEqual({
      kind: 'deny',
      toolName: 'WebSearch',
      reason: 'tool-disabled'
    })
  })

  it('maps a session web_search opt-in to the platform MCP runtime name', () => {
    const settings = buildClaudeCodeSettingsFromComposition({
      ...composition(),
      sessionAllowedTools: ['web_search']
    }, { serverWebToolsSupported: false })

    expect(settings.allowedTools).toEqual(['Read', 'mcp__macrobay_web__web_search'])
    expect(settings.disallowedTools).toEqual(['WebSearch', 'WebFetch'])
    expect(buildClaudeCodeToolPolicyFromSettings(settings).canUseTool('mcp__macrobay_web__web_search')).toEqual({
      kind: 'allow',
      toolName: 'mcp__macrobay_web__web_search'
    })
  })

  it('keeps an allowlist-only agent without extra tools unchanged when the provider supports them', () => {
    const settings = buildClaudeCodeSettingsFromComposition({
      ...composition({
        requireSessionToolAllowlist: true,
        tools: {
          all: [builtin('Read', 'auto'), builtin('WebSearch', 'prompt'), builtin('WebFetch', 'prompt')],
          enabled: [builtin('Read', 'auto'), builtin('WebSearch', 'prompt'), builtin('WebFetch', 'prompt')],
          disabled: []
        }
      })
    }, { serverWebToolsSupported: true })

    expect(settings.allowedTools).toEqual(['Read'])
    expect(settings.disallowedTools).toEqual([])
  })
})
