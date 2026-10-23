import { describe, expect, it, vi } from 'vitest'

import type { ToolApprovalDecision } from '../../policy'
import { buildClaudeCodeToolPolicyFromSettings } from './ClaudeCodeToolPolicy'
import {
  resolveClaudeCodeToolApprovalDecision,
  type ClaudeCodeResolvedToolApproval
} from './ClaudeCodeToolApprovalBridge'

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

describe('Claude Code tool approval bridge', () => {
  it('allows pre-approved tools without consulting the runtime approval requester', async () => {
    const requestToolApproval = vi.fn()

    await expect(
      resolveClaudeCodeToolApprovalDecision({
        sessionId: 'session-1',
        toolName: 'Read',
        toolPolicy: policy,
        requestToolApproval
      })
    ).resolves.toEqual({
      behavior: 'allow'
    } satisfies ClaudeCodeResolvedToolApproval)

    expect(requestToolApproval).not.toHaveBeenCalled()
  })

  it('denies disallowed tools before any approval request is emitted', async () => {
    const requestToolApproval = vi.fn()

    await expect(
      resolveClaudeCodeToolApprovalDecision({
        sessionId: 'session-1',
        toolName: 'Bash',
        toolPolicy: policy,
        requestToolApproval
      })
    ).resolves.toEqual({
      behavior: 'deny',
      message: 'Tool "Bash" is disabled for this agent.'
    } satisfies ClaudeCodeResolvedToolApproval)

    expect(requestToolApproval).not.toHaveBeenCalled()
  })

  it('requests approval for prompt tools and reuses the tool policy approval request mapping', async () => {
    const requestToolApproval = vi.fn(
      async (): Promise<ToolApprovalDecision> => ({
        behavior: 'allow',
        updatedInput: { query: 'bitcoin' }
      })
    )

    await expect(
      resolveClaudeCodeToolApprovalDecision({
        sessionId: 'session-1',
        toolName: 'WebSearch',
        toolPolicy: policy,
        requestToolApproval
      })
    ).resolves.toEqual({
      behavior: 'allow',
      updatedInput: { query: 'bitcoin' }
    } satisfies ClaudeCodeResolvedToolApproval)

    expect(requestToolApproval).toHaveBeenCalledWith({
      sessionId: 'session-1',
      toolName: 'WebSearch',
      toolCallId: 'tool-call-websearch'
    })
  })

  it('passes through deny responses from the runtime approval requester', async () => {
    const requestToolApproval = vi.fn(
      async (): Promise<ToolApprovalDecision> => ({
        behavior: 'deny',
        message: 'User denied'
      })
    )

    await expect(
      resolveClaudeCodeToolApprovalDecision({
        sessionId: 'session-1',
        toolName: 'WebSearch',
        toolPolicy: policy,
        requestToolApproval
      })
    ).resolves.toEqual({
      behavior: 'deny',
      message: 'User denied'
    } satisfies ClaudeCodeResolvedToolApproval)
  })
})
