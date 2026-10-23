import { describe, expect, it, vi } from 'vitest'

import type { ToolApprovalDecision } from '../../policy'
import { buildClaudeCodeToolPolicyFromSettings } from './ClaudeCodeToolPolicy'
import type { ClaudeCodeToolPolicy } from './ClaudeCodeToolPolicy'
import { createClaudeCodeToolHooks, type ClaudeCodeToolHooks } from './ClaudeCodeToolHooks'

const policy = buildClaudeCodeToolPolicyFromSettings({
  cwd: '/tmp/workspace',
  env: {},
  permissionMode: 'acceptEdits',
  allowedTools: ['Read'],
  disallowedTools: ['Bash'],
  mcpSources: [],
  mcpServers: [],
  skills: [],
  skillToolIds: []
})

describe('Claude Code tool hooks', () => {
  it('allows pre-approved tools without consulting runtime approval', async () => {
    const requestToolApproval = vi.fn()
    const hooks = createHooks(requestToolApproval)

    await expect(hooks.canUseTool('Read')).resolves.toEqual({
      behavior: 'allow'
    })

    expect(requestToolApproval).not.toHaveBeenCalled()
  })

  it('denies disabled tools from preToolUse even when canUseTool may be skipped', async () => {
    const requestToolApproval = vi.fn()
    const hooks = createHooks(requestToolApproval)

    await expect(
      hooks.preToolUse({
        toolName: 'Bash',
        input: { command: 'rm -rf .' }
      })
    ).resolves.toEqual({
      behavior: 'deny',
      message: 'Tool "Bash" is disabled for this agent.'
    })

    expect(requestToolApproval).not.toHaveBeenCalled()
  })

  it('requests approval for prompt tools from preToolUse and preserves explicit toolCallId', async () => {
    const requestToolApproval = vi.fn(
      async (): Promise<ToolApprovalDecision> => ({
        behavior: 'allow',
        updatedInput: { query: 'bitcoin' }
      })
    )
    const hooks = createHooks(requestToolApproval)

    await expect(
      hooks.preToolUse({
        toolName: 'WebSearch',
        toolCallId: 'tool-call-42',
        input: { query: 'btc' }
      })
    ).resolves.toEqual({
      behavior: 'allow',
      updatedInput: { query: 'bitcoin' }
    })

    expect(requestToolApproval).toHaveBeenCalledWith({
      sessionId: 'session-1',
      toolName: 'WebSearch',
      toolCallId: 'tool-call-42'
    })
  })

  it('uses the dedicated preToolUse policy path for input-aware approval decisions', async () => {
    const requestToolApproval = vi.fn(
      async (): Promise<ToolApprovalDecision> => ({
        behavior: 'allow',
        updatedInput: { command: 'mkdir logs --parents' }
      })
    )
    const hooks = createHooks(requestToolApproval, {
      ...policy,
      canUseTool: (toolName) => ({ kind: 'allow', toolName }),
      preToolUse: ({ toolName, input }) =>
        toolName === 'Bash' && (input as { command?: string } | undefined)?.command === 'mkdir logs'
          ? ({ kind: 'prompt', toolName })
          : ({ kind: 'allow', toolName })
    })

    await expect(
      hooks.preToolUse({
        toolName: 'Bash',
        toolCallId: 'tool-call-99',
        input: { command: 'mkdir logs' }
      })
    ).resolves.toEqual({
      behavior: 'allow',
      updatedInput: { command: 'mkdir logs --parents' }
    })

    expect(requestToolApproval).toHaveBeenCalledWith({
      sessionId: 'session-1',
      toolName: 'Bash',
      toolCallId: 'tool-call-99'
    })
  })
})

function createHooks(
  requestToolApproval: (input: { sessionId: string; toolCallId: string; toolName: string }) => Promise<ToolApprovalDecision>,
  toolPolicy: ClaudeCodeToolPolicy = policy
): ClaudeCodeToolHooks {
  return createClaudeCodeToolHooks({
    sessionId: 'session-1',
    toolPolicy,
    requestToolApproval
  })
}
