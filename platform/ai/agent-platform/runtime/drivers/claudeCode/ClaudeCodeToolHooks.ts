import type { ToolApprovalDecision } from '../../policy'
import type { ToolApprovalRequestInput } from '../../runtimeTypes'
import {
  resolveClaudeCodePreToolUseApprovalDecision,
  resolveClaudeCodeToolApprovalDecision
} from './ClaudeCodeToolApprovalBridge'
import type { ClaudeCodeToolPolicy } from './ClaudeCodeToolPolicy'

export type ClaudeCodeToolHookInput = {
  toolName: string
  toolCallId?: string
  input?: unknown
}

export type ClaudeCodeToolHooks = {
  canUseTool: (toolName: string) => Promise<ToolApprovalDecision>
  preToolUse: (input: ClaudeCodeToolHookInput) => Promise<ToolApprovalDecision>
}

export type ClaudeCodeToolHooksInput = {
  sessionId: string
  toolPolicy: ClaudeCodeToolPolicy
  requestToolApproval: (input: ToolApprovalRequestInput) => Promise<ToolApprovalDecision>
  onDecision?: (input: ClaudeCodeToolHookInput, decision: ToolApprovalDecision) => void
}

export function createClaudeCodeToolHooks(hooksInput: ClaudeCodeToolHooksInput): ClaudeCodeToolHooks {
  const resolveDecision = async (toolName: string, toolCallId?: string) => {
    const decision = await resolveClaudeCodeToolApprovalDecision({
      sessionId: hooksInput.sessionId,
      toolName,
      toolCallId,
      toolPolicy: hooksInput.toolPolicy,
      requestToolApproval: hooksInput.requestToolApproval
    })
    hooksInput.onDecision?.({ toolName, toolCallId }, decision)
    return decision
  }

  return {
    canUseTool: async (toolName) => resolveDecision(toolName),
    preToolUse: async ({ toolName, toolCallId, input: toolInput }) => {
      const decision = await resolveClaudeCodePreToolUseApprovalDecision({
        sessionId: hooksInput.sessionId,
        toolName,
        toolCallId,
        toolInput,
        toolPolicy: hooksInput.toolPolicy,
        requestToolApproval: hooksInput.requestToolApproval
      })
      hooksInput.onDecision?.({ toolName, toolCallId, input: toolInput }, decision)
      return decision
    }
  }
}
