import type { ToolApprovalDecision } from '../../policy'
import type { ToolApprovalRequestInput } from '../../runtimeTypes'
import type { ClaudeCodeToolApprovalDecision, ClaudeCodeToolPolicy } from './ClaudeCodeToolPolicy'

export type ClaudeCodeResolvedToolApproval =
  | {
      behavior: 'allow'
      updatedInput?: unknown
    }
  | {
      behavior: 'deny'
      message: string
    }

export type ClaudeCodeToolApprovalBridgeInput = {
  sessionId: string
  toolName: string
  toolCallId?: string
  toolPolicy: ClaudeCodeToolPolicy
  requestToolApproval: (input: ToolApprovalRequestInput) => Promise<ToolApprovalDecision>
}

export async function resolveClaudeCodeToolApprovalDecision(
  input: ClaudeCodeToolApprovalBridgeInput
): Promise<ClaudeCodeResolvedToolApproval> {
  return resolveClaudeCodeToolApprovalDecisionFromPolicy(
    input.toolPolicy.canUseTool(input.toolName),
    input
  )
}

export async function resolveClaudeCodePreToolUseApprovalDecision(
  input: ClaudeCodeToolApprovalBridgeInput & {
    toolInput?: unknown
  }
): Promise<ClaudeCodeResolvedToolApproval> {
  return resolveClaudeCodeToolApprovalDecisionFromPolicy(
    input.toolPolicy.preToolUse({
      toolName: input.toolName,
      input: input.toolInput
    }),
    input
  )
}

async function resolveClaudeCodeToolApprovalDecisionFromPolicy(
  decision: ClaudeCodeToolApprovalDecision,
  input: ClaudeCodeToolApprovalBridgeInput
): Promise<ClaudeCodeResolvedToolApproval> {
  if (decision.kind === 'allow') {
    return {
      behavior: 'allow'
    }
  }

  if (decision.kind === 'deny') {
    return {
      behavior: 'deny',
      message: `Tool "${input.toolName}" is disabled for this agent.`
    }
  }

  return input.requestToolApproval({
    sessionId: input.sessionId,
    ...input.toolPolicy.toApprovalRequest(decision, input.toolCallId)
  })
}
