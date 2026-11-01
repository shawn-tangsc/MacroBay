import { describe, expect, it } from 'vitest'

import type { AgentRuntimeComposition } from '../../AgentRuntimeCompositionService'
import { buildClaudeCodeSettingsFromComposition } from './ClaudeCodeSettingsBuilder'
import { buildClaudeCodeToolPolicyFromSettings } from './ClaudeCodeToolPolicy'

function builtin(id: string, approval: 'auto' | 'prompt') {
  return { id, name: id, origin: 'builtin' as const, approval }
}

const platformWebSearchRuntimeName = 'mcp__macrobay_web__web_search'

/**
 * The console line this regression covers:
 *
 * `[CLAUDE_SDK_CAN_USE_TOOL_SHADOWED] canUseTool will not be invoked for:
 *  Glob, Grep, NotebookRead, Read, Task, TodoWrite, mcp_..._web_search`
 *
 * A bare name in `allowedTools` auto-approves the whole tool before `canUseTool` runs. Only the
 * read-only auto builtins may stay on that list; gated tools must fall through to the runtime
 * policy, which still honors an approval the composition already granted.
 */
function dailyBriefLikeComposition(overrides: Partial<AgentRuntimeComposition> = {}): AgentRuntimeComposition {
  const readOnly = [
    builtin('Glob', 'auto'),
    builtin('Grep', 'auto'),
    builtin('NotebookRead', 'auto'),
    builtin('Read', 'auto')
  ]
  const taskTools = [builtin('Task', 'auto'), builtin('TodoWrite', 'auto')]

  return {
    agentId: 'agent-1',
    sessionId: 'session-1',
    agentType: 'claude-code',
    instructions: null,
    modelId: 'provider:model-a',
    modelName: null,
    permissionMode: 'plan',
    workspacePath: '/tmp/workspace',
    workspaceType: 'user',
    environment: {},
    requireSessionToolAllowlist: true,
    sessionAllowedTools: ['web_search'],
    tools: {
      all: [...readOnly, ...taskTools, builtin('Bash', 'prompt')],
      enabled: [...readOnly, ...taskTools, builtin('Bash', 'prompt')],
      disabled: []
    },
    mcp: { sources: [], servers: [] },
    skills: { skills: [], toolIds: [] },
    ...overrides
  } as AgentRuntimeComposition
}

describe('SDK allowedTools shadowing', () => {
  it('only bare-preapproves read-only auto builtins and routes gated tools through the policy', () => {
    const settings = buildClaudeCodeSettingsFromComposition(dailyBriefLikeComposition(), {
      serverWebToolsSupported: false
    })

    expect(settings.allowedTools).toEqual(['Glob', 'Grep', 'NotebookRead', 'Read'])
    expect(settings.allowedTools).not.toContain('Task')
    expect(settings.allowedTools).not.toContain('TodoWrite')
    expect(settings.allowedTools).not.toContain(platformWebSearchRuntimeName)
    expect(settings.policyAllowedTools).toEqual([
      'Task',
      'TodoWrite',
      platformWebSearchRuntimeName
    ])

    const policy = buildClaudeCodeToolPolicyFromSettings(settings)
    for (const toolName of ['Task', 'TodoWrite', platformWebSearchRuntimeName]) {
      expect(policy.canUseTool(toolName)).toEqual({ kind: 'allow', toolName })
      expect(policy.preToolUse({ toolName })).toEqual({ kind: 'allow', toolName })
    }
  })

  it('still sends read-only auto and session-approved read-only tools without a prompt', () => {
    const settings = buildClaudeCodeSettingsFromComposition({
      ...dailyBriefLikeComposition({ sessionAllowedTools: ['Read', 'WebSearch'] })
    })

    expect(settings.allowedTools).toEqual(['Glob', 'Grep', 'NotebookRead', 'Read'])
    expect(settings.policyAllowedTools).toEqual(['Task', 'TodoWrite', 'WebSearch'])
    expect(buildClaudeCodeToolPolicyFromSettings(settings).canUseTool('Read')).toEqual({
      kind: 'allow',
      toolName: 'Read'
    })
    expect(buildClaudeCodeToolPolicyFromSettings(settings).canUseTool('WebSearch')).toEqual({
      kind: 'allow',
      toolName: 'WebSearch'
    })
  })

  it('lets MCP web search reach the policy only when a session opted in', () => {
    const withoutOptIn = buildClaudeCodeSettingsFromComposition({
      ...dailyBriefLikeComposition({ sessionAllowedTools: [] })
    })

    expect(withoutOptIn.allowedTools).not.toContain(platformWebSearchRuntimeName)
    expect(withoutOptIn.policyAllowedTools).not.toContain(platformWebSearchRuntimeName)
    expect(buildClaudeCodeToolPolicyFromSettings(withoutOptIn).canUseTool(platformWebSearchRuntimeName)).toEqual({
      kind: 'prompt',
      toolName: platformWebSearchRuntimeName
    })
  })

  it('keeps normal agents on their previous decisions while removing the bare shadow', () => {
    const settings = buildClaudeCodeSettingsFromComposition(
      dailyBriefLikeComposition({
        requireSessionToolAllowlist: false,
        sessionAllowedTools: undefined,
        tools: {
          all: [builtin('Read', 'auto'), builtin('Bash', 'prompt'), builtin('Task', 'auto')],
          enabled: [builtin('Read', 'auto'), builtin('Bash', 'prompt'), builtin('Task', 'auto')],
          disabled: []
        }
      })
    )

    expect(settings.allowedTools).toEqual(['Read'])
    expect(settings.policyAllowedTools).toEqual(['Bash', 'Task'])
    const policy = buildClaudeCodeToolPolicyFromSettings(settings)
    expect(policy.canUseTool('Read')).toEqual({ kind: 'allow', toolName: 'Read' })
    expect(policy.canUseTool('Bash')).toEqual({ kind: 'allow', toolName: 'Bash' })
    expect(policy.canUseTool('Task')).toEqual({ kind: 'allow', toolName: 'Task' })
  })

  it('never pre-approves a disabled tool through either list', () => {
    const settings = buildClaudeCodeSettingsFromComposition(
      dailyBriefLikeComposition({
        sessionAllowedTools: [],
        tools: {
          all: [builtin('Read', 'auto'), builtin('Task', 'auto')],
          enabled: [builtin('Read', 'auto')],
          disabled: [builtin('Task', 'auto')]
        }
      })
    )

    expect(settings.allowedTools).toEqual(['Read'])
    expect(settings.policyAllowedTools).toEqual([])
    expect(buildClaudeCodeToolPolicyFromSettings(settings).canUseTool('Task')).toEqual({
      kind: 'deny',
      toolName: 'Task',
      reason: 'tool-disabled'
    })
  })
})
