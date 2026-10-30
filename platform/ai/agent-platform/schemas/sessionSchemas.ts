import type { UniqueModelId } from './agentSchemas'
import type { AgentSessionWorkspaceSource, AgentWorkspaceEntity } from './workspaceSchemas'

export const messageRoles = ['user', 'assistant', 'system'] as const
export type MessageRole = (typeof messageRoles)[number]

export const messageStatuses = ['pending', 'success', 'error', 'paused'] as const
export type MessageStatus = (typeof messageStatuses)[number]

export const AGENT_SESSION_MESSAGES_DEFAULT_LIMIT = 50
export const AGENT_SESSION_MESSAGES_MAX_LIMIT = 200
export const AGENT_SESSIONS_DEFAULT_LIMIT = 50
export const AGENT_SESSIONS_MAX_LIMIT = 200

export type TextMessagePart = {
  type: 'text'
  text: string
}

export type AgentMentionedModelDescriptor = {
  id: UniqueModelId
  label: string
  providerName: string
}

export type AgentMentionedModelsMessagePart = {
  type: 'agent-mentioned-models'
  modelIds: UniqueModelId[]
  models: AgentMentionedModelDescriptor[]
}

/**
 * Display-only context attached to a user message. The provider still receives the raw identity
 * in the prompt text; the transcript renders this part as a readable card instead.
 */
export type AgentContextMessagePart = {
  type: 'agent-context'
  kind: string
  label: string
  detail?: string
  /** Product-owned identity for renderers/actions; never displayed raw. */
  payload?: Record<string, unknown>
}

export type GenericMessagePart = {
  type: string
} & Record<string, unknown>

export type AgentMessagePart =
  | TextMessagePart
  | AgentMentionedModelsMessagePart
  | AgentContextMessagePart
  | GenericMessagePart

export type MessageData = {
  parts: AgentMessagePart[]
}

export type ModelSnapshot = {
  id: string
  name: string
  provider: string
}

export type MessageStats = {
  totalTokens?: number
  promptTokens?: number
  completionTokens?: number
  thoughtsTokens?: number
} & Record<string, unknown>

export type AgentSessionMessageEntity = {
  id: string
  sessionId: string
  role: MessageRole
  data: MessageData
  searchableText: string
  status: MessageStatus
  modelId: UniqueModelId | null
  modelSnapshot: ModelSnapshot | null
  stats: MessageStats | null
  runtimeResumeToken: string | null
  createdAt: string
  updatedAt: string
}

export type CreateAgentSessionMessageDto = {
  id?: string
  role: MessageRole
  data: MessageData
  status?: MessageStatus
  modelId?: UniqueModelId | null
  modelSnapshot?: ModelSnapshot | null
  stats?: MessageStats | null
}

export type CreateAgentSessionMessagesDto = {
  sessionId: string
  runtimeResumeToken?: string
  messages: CreateAgentSessionMessageDto[]
}

export type AgentSessionEntity = {
  id: string
  agentId: string | null
  name: string
  description?: string
  workspaceId: string
  workspace: AgentWorkspaceEntity
  traceId?: string
  orderKey: string
  /**
   * 会话级工具白名单：只放该会话额外自动放行的**只读** builtin 工具名（WebSearch / WebFetch /
   * Read / Glob / Grep / NotebookRead），由平台规范化，见 `normalizeSessionAllowedTools`。
   * 写 / 执行类 builtin（Bash / Write / Edit / NotebookEdit ...）即使出现在这里也会被丢弃。
   * 缺省 / 空数组 = 完全沿用 agent 的工具策略。
   * 读侧统一走 `normalizeSessionAllowedTools(session.allowedTools)`，旧快照无需迁移。
   */
  allowedTools?: string[]
  createdAt: string
  updatedAt: string
}

export type CreateAgentSessionDto = {
  agentId: string
  name: string
  description?: string
  workspace: AgentSessionWorkspaceSource
  /**
   * 可选：仅本次会话额外放行的**只读** builtin 工具名（WebSearch / WebFetch / Read / Glob / Grep）。
   * 只能加白；写 / 执行类 builtin、未知名字、MCP/Skill 运行时名字都会被丢弃，
   * agent 的 disabledTools（deny）仍然优先。
   */
  allowedTools?: string[]
}

export type UpdateAgentSessionDto = {
  name?: string
  description?: string
  agentId?: string | null
}

export type AgentSessionMessagesListQuery = {
  cursor?: string
  limit?: number
}

export type ListAgentSessionsQuery = {
  agentId?: string
  cursor?: string
  limit?: number
}

export type DeleteAgentSessionsResult = {
  deletedIds: string[]
}

export const AGENT_SESSION_DELETE_MAX_IDS = 200
