import type { AgentPermissionMode } from '../schemas/agentSchemas'
import type { ToolApproval, ToolOrigin } from '../schemas/toolSchemas'
import { buildMcpToolName } from './mcpToolName'
import { buildMcpToolWildcard } from './mcpSourcePolicy'

export interface ClaudeToolDescriptor {
  id: string
  name: string
  description?: string
  origin: ToolOrigin
  sourceId?: string
  sourceName?: string
  sourceToolName?: string
  sourceApproval?: ToolApproval
}

export interface ClaudeToolDecision {
  id: string
  approval: ToolApproval
}

export interface ClaudeToolInvocation {
  toolName: string
  input?: unknown
}

export interface ClaudeToolPolicy {
  permissionMode?: AgentPermissionMode
  disabledTools?: readonly string[]
}

type ApprovalInput = {
  descriptor: ClaudeToolDescriptor
  policy: ClaudeToolPolicy
  invocation?: ClaudeToolInvocation
}

type ApprovalRule = (input: ApprovalInput) => ToolApproval | null

/** Tools that can never modify the workspace, so they never need a prompt. */
const READ_ONLY_BUILTINS = new Set(['Read', 'Glob', 'Grep', 'NotebookRead', 'Task', 'TodoWrite'])

/** Tools that edit files and become automatic in `acceptEdits` mode. */
const EDIT_BUILTINS = new Set(['Edit', 'MultiEdit', 'NotebookEdit', 'Write'])

/** Shell commands that only create, move, or copy files. */
const SHELL_WRITE_COMMANDS = new Set(['mkdir', 'touch', 'mv', 'cp'])

const SOURCE_REQUIRES_APPROVAL: ApprovalRule = ({ descriptor }) =>
  descriptor.sourceApproval === 'prompt' ? 'prompt' : null

const BYPASS_MODE_ALLOWS_EVERYTHING: ApprovalRule = ({ policy }) =>
  policy.permissionMode === 'bypassPermissions' ? 'auto' : null

const EDIT_MODE_ALLOWS_EDITS: ApprovalRule = ({ descriptor, policy }) =>
  policy.permissionMode === 'acceptEdits' && EDIT_BUILTINS.has(descriptor.id) ? 'auto' : null

const READ_ONLY_TOOLS_ARE_AUTO: ApprovalRule = ({ descriptor }) =>
  READ_ONLY_BUILTINS.has(descriptor.id) ? 'auto' : null

const EDIT_MODE_ALLOWS_SHELL_WRITES: ApprovalRule = ({ descriptor, policy, invocation }) =>
  policy.permissionMode === 'acceptEdits' &&
  invocation != null &&
  isShellWriteInvocation(descriptor, invocation)
    ? 'auto'
    : null

const TOOL_RULES: readonly ApprovalRule[] = [
  SOURCE_REQUIRES_APPROVAL,
  BYPASS_MODE_ALLOWS_EVERYTHING,
  EDIT_MODE_ALLOWS_EDITS,
  READ_ONLY_TOOLS_ARE_AUTO
]

const INVOCATION_RULES: readonly ApprovalRule[] = [
  SOURCE_REQUIRES_APPROVAL,
  BYPASS_MODE_ALLOWS_EVERYTHING,
  EDIT_MODE_ALLOWS_EDITS,
  EDIT_MODE_ALLOWS_SHELL_WRITES,
  READ_ONLY_TOOLS_ARE_AUTO
]

export function normalizeBuiltinToolName(name: string): string {
  return name.startsWith('builtin_') ? name.slice('builtin_'.length) : name
}

export function buildMcpToolWireName(serverName: string, toolName: string): string {
  return buildMcpToolName(serverName, toolName)
}

export function buildMcpToolWireWildcard(serverName: string): string {
  return buildMcpToolWildcard(serverName)
}

export function matchesToolRule(rule: string, descriptor: ClaudeToolDescriptor): boolean {
  if (rule === descriptor.id) {
    return true
  }

  if (descriptor.origin === 'builtin') {
    return normalizeBuiltinToolName(rule) === normalizeBuiltinToolName(descriptor.id)
  }

  if (descriptor.origin !== 'mcp' || !descriptor.sourceName) {
    return false
  }

  if (rule === buildMcpToolWireWildcard(descriptor.sourceName)) {
    return true
  }

  if (!descriptor.sourceToolName) {
    return false
  }

  const rawName = `mcp__${descriptor.sourceName}__${descriptor.sourceToolName}`
  return rule === rawName || rule === `mcp__${descriptor.sourceName}__*`
}

export function isToolDisabled(descriptor: ClaudeToolDescriptor, policy: ClaudeToolPolicy): boolean {
  return policy.disabledTools?.some((rule) => matchesToolRule(rule, descriptor)) ?? false
}

export function resolveToolApproval(
  descriptor: ClaudeToolDescriptor,
  policy: ClaudeToolPolicy
): ClaudeToolDecision {
  return { id: descriptor.id, approval: decide(TOOL_RULES, { descriptor, policy }) }
}

export function resolveInvocationApproval(
  descriptor: ClaudeToolDescriptor,
  policy: ClaudeToolPolicy,
  invocation: ClaudeToolInvocation
): ClaudeToolDecision {
  return { id: descriptor.id, approval: decide(INVOCATION_RULES, { descriptor, policy, invocation }) }
}

function decide(rules: readonly ApprovalRule[], input: ApprovalInput): ToolApproval {
  for (const rule of rules) {
    const approval = rule(input)
    if (approval !== null) {
      return approval
    }
  }
  return 'prompt'
}

function isShellWriteInvocation(descriptor: ClaudeToolDescriptor, invocation: ClaudeToolInvocation): boolean {
  if (normalizeBuiltinToolName(descriptor.id) !== 'Bash') {
    return false
  }
  const command = readShellCommand(invocation.input).split(/\s+/, 1)[0]
  return SHELL_WRITE_COMMANDS.has(command)
}

function readShellCommand(input: unknown): string {
  const command = (input as { command?: unknown } | null | undefined)?.command
  return typeof command === 'string' ? command.trim() : ''
}
