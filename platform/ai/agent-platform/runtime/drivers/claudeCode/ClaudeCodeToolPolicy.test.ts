import { describe, expect, it } from 'vitest'

import type { ClaudeCodeCompositionSettings } from './ClaudeCodeSettingsBuilder'
import {
  buildClaudeCodeToolPolicyFromSettings,
  type ClaudeCodeToolInvocationApprovalRequest
} from './ClaudeCodeToolPolicy'

const baseSettings: ClaudeCodeCompositionSettings = {
  cwd: '/tmp/workspace',
  env: {
    FOO: 'bar'
  },
  permissionMode: 'acceptEdits',
  allowedTools: ['Read', 'Edit', 'mcp__filesystem__readFile'],
  disallowedTools: ['Bash', 'mcp__filesystem__writeFile'],
  mcpSources: [{ serverId: 'mcp-files', sourceId: 'mcp:mcp-files', toolCount: 2, isActive: true, runtimeState: 'connected' }],
  mcpServers: [],
  skills: [{ skillId: 'skill-1', name: 'Code Reader', folderName: 'code-reader', source: 'local', tools: ['Read'] }],
  skillToolIds: ['skill__code-reader__read']
}

describe('Claude Code tool policy', () => {
  it('tracks allowed/disallowed tools and preserves permission mode/runtime metadata', () => {
    const policy = buildClaudeCodeToolPolicyFromSettings(baseSettings)

    expect(policy).toEqual({
      permissionMode: 'acceptEdits',
      allowedTools: ['Read', 'Edit', 'mcp__filesystem__readFile'],
      disallowedTools: ['Bash', 'mcp__filesystem__writeFile'],
      mcpSources: [{ serverId: 'mcp-files', sourceId: 'mcp:mcp-files', toolCount: 2, isActive: true, runtimeState: 'connected' }],
      skillToolIds: ['skill__code-reader__read'],
  runtimeMcpToolNames: [],
  runtimeMcpApprovalByName: {},
      canUseTool: expect.any(Function),
      preToolUse: expect.any(Function),
      toApprovalRequest: expect.any(Function)
    })
  })

  it('allows tools already resolved as enabled at the composition/settings layer', () => {
    const policy = buildClaudeCodeToolPolicyFromSettings(baseSettings)

    expect(policy.canUseTool('Read')).toEqual({
      kind: 'allow',
      toolName: 'Read'
    })
    expect(policy.canUseTool('Edit')).toEqual({
      kind: 'allow',
      toolName: 'Edit'
    })
    expect(policy.canUseTool('mcp__filesystem__readFile')).toEqual({
      kind: 'allow',
      toolName: 'mcp__filesystem__readFile'
    })
  })

  it('auto-allows skill-derived runtime tool ids even when they are not duplicated into allowedTools', () => {
    const policy = buildClaudeCodeToolPolicyFromSettings({
      ...baseSettings,
      allowedTools: ['Edit', 'mcp__filesystem__readFile'],
      skillToolIds: ['skill__code-reader__read']
    })

    expect(policy.canUseTool('skill__code-reader__read')).toEqual({
      kind: 'allow',
      toolName: 'skill__code-reader__read'
    })
  })

  it('prompts when a tool is known but not pre-approved by settings', () => {
    const policy = buildClaudeCodeToolPolicyFromSettings({
      ...baseSettings,
      allowedTools: ['Read'],
      disallowedTools: []
    })

    expect(policy.canUseTool('WebSearch')).toEqual({
      kind: 'prompt',
      toolName: 'WebSearch'
    })
  })

  it('denies tools already marked disallowed by settings', () => {
    const policy = buildClaudeCodeToolPolicyFromSettings(baseSettings)

    expect(policy.canUseTool('Bash')).toEqual({
      kind: 'deny',
      toolName: 'Bash',
      reason: 'tool-disabled'
    })
    expect(policy.canUseTool('mcp__filesystem__writeFile')).toEqual({
      kind: 'deny',
      toolName: 'mcp__filesystem__writeFile',
      reason: 'tool-disabled'
    })
  })

  it('keeps explicit disallow higher priority than skill auto-allow', () => {
    const policy = buildClaudeCodeToolPolicyFromSettings({
      ...baseSettings,
      disallowedTools: ['skill__code-reader__read']
    })

    expect(policy.canUseTool('skill__code-reader__read')).toEqual({
      kind: 'deny',
      toolName: 'skill__code-reader__read',
      reason: 'tool-disabled'
    })
  })

  it('keeps deny semantics in pre-tool-use checks so disabled tools stay blocked even if auto-approved upstream', () => {
    const policy = buildClaudeCodeToolPolicyFromSettings(baseSettings)

    expect(
      policy.preToolUse({
        toolName: 'Bash',
        input: {
          command: 'mkdir logs'
        }
      })
    ).toEqual({
      kind: 'deny',
      toolName: 'Bash',
      reason: 'tool-disabled'
    })
  })

  it('prompts for product tools unless approval is auto', () => {
    const policy = buildClaudeCodeToolPolicyFromSettings({
      ...baseSettings,
      runtimeMcpToolNames: ['mcp__market-intelligence__get_source_health'],
      runtimeMcpApprovalByName: {
        'mcp__market-intelligence__get_source_health': 'prompt'
      }
    })

    expect(policy.canUseTool('mcp__market-intelligence__get_source_health')).toEqual({
      kind: 'prompt',
      toolName: 'mcp__market-intelligence__get_source_health'
    })
  })

  it('auto-allows product tools when mapped approval is auto', () => {
    const policy = buildClaudeCodeToolPolicyFromSettings({
      ...baseSettings,
      runtimeMcpToolNames: ['mcp__market-intelligence__get_source_health'],
      runtimeMcpApprovalByName: {
        'mcp__market-intelligence__get_source_health': 'auto'
      }
    })

    expect(policy.canUseTool('mcp__market-intelligence__get_source_health')).toEqual({
      kind: 'allow',
      toolName: 'mcp__market-intelligence__get_source_health'
    })
  })

  it('auto-allows internal task tools through the same runtime MCP approval map', () => {
    const policy = buildClaudeCodeToolPolicyFromSettings({
      ...baseSettings,
      runtimeMcpToolNames: ['scheduled_task_create'],
      runtimeMcpApprovalByName: { scheduled_task_create: 'auto' }
    })

    expect(policy.canUseTool('scheduled_task_create')).toEqual({
      kind: 'allow',
      toolName: 'scheduled_task_create'
    })
  })

  it('allows policy-only approvals without putting them in the SDK bare allowlist', () => {
    const policy = buildClaudeCodeToolPolicyFromSettings({
      ...baseSettings,
      allowedTools: ['Read'],
      policyAllowedTools: ['Task', 'mcp__macrobay_web__web_search'],
      disallowedTools: []
    })

    expect(policy.allowedTools).toEqual(['Read'])
    expect(policy.canUseTool('Task')).toEqual({ kind: 'allow', toolName: 'Task' })
    expect(policy.preToolUse({ toolName: 'mcp__macrobay_web__web_search' })).toEqual({
      kind: 'allow',
      toolName: 'mcp__macrobay_web__web_search'
    })
  })

  it('keeps an explicit deny above a policy-only approval', () => {
    const policy = buildClaudeCodeToolPolicyFromSettings({
      ...baseSettings,
      allowedTools: ['Read'],
      policyAllowedTools: ['Task'],
      disallowedTools: ['Task']
    })

    expect(policy.canUseTool('Task')).toEqual({
      kind: 'deny',
      toolName: 'Task',
      reason: 'tool-disabled'
    })
  })

  it('returns prompt decisions as approval requests that can later bridge to ToolApprovalRegistry', () => {    const policy = buildClaudeCodeToolPolicyFromSettings({
      ...baseSettings,
      allowedTools: ['Read'],
      disallowedTools: []
    })

    expect(
      policy.toApprovalRequest({
        kind: 'prompt',
        toolName: 'WebSearch'
      })
    ).toEqual({
      toolName: 'WebSearch',
      toolCallId: 'tool-call-websearch'
    } satisfies ClaudeCodeToolInvocationApprovalRequest)
  })

  it('normalizes tool call ids for approval requests', () => {
    const policy = buildClaudeCodeToolPolicyFromSettings(baseSettings)

    expect(
      policy.toApprovalRequest({
        kind: 'prompt',
        toolName: 'mcp__filesystem__readFile'
      })
    ).toEqual({
      toolName: 'mcp__filesystem__readFile',
      toolCallId: 'tool-call-mcp-filesystem-readfile'
    } satisfies ClaudeCodeToolInvocationApprovalRequest)
  })
})
