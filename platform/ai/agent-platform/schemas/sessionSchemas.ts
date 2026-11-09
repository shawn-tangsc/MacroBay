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
  /**
   * 写这条 `pending` 的主进程**启动批次**（boot id，主进程启动时生成一次）。
   *
   * 崩溃恢复只收「不是本批次」的 pending：同一份 userData 同时只有一个进程（单实例锁），
   * 所以「不是本批次」就等于「上一个已经死掉的进程」。**不用时间判**——boot 期间刚起的那次
   * 运行，开始时刻也早于收敛那一刻，按时间判会把它一起收掉；改系统时间同样会误收。
   *
   * 老行为 `undefined`：字段是在崩溃收尾之后才加的，读侧按「上一个进程」处理。
   */
  ownerBootId?: string
  createdAt: string
  updatedAt: string
}

export type CreateAgentSessionMessageDto = {
  id?: string
  role: MessageRole
  /** 写这条 pending 的主进程启动批次；只有 pending 有意义，缺省由仓储补本批次。 */
  ownerBootId?: string
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

/**
 * Where a session came from.
 *
 * `reader` — the reader started it (every pre-0047 session, and the default for anything new).
 * `automation` — a product created it on its own (for example one session per automatic analysis),
 * which is why the default list must not mix them into the reader's own list.
 */
export type AgentSessionOrigin = 'reader' | 'automation'

/**
 * 这条**自动会话**是否已被同身份（`agentId + originRef`）的更新会话取代。平台语义，与产品无关。
 *
 * 契约（三句都要守）：
 * 1. `origin` 决定进不进**读者列表**；`originState` 只决定进不进**自动会话块**——两者不许互相替代。
 * 2. 读者列表判据固定 `origin !== 'automation'`，不许拿 `originState` 反过滤；自动会话块只读这个
 *    字段，不许去看 `originRef` 的后缀字符串。
 * 3. **只有 `superseded` 会隐藏**；缺省、未知值、将来新加的值一律按可见处理（白名单式只认
 *    `current` 会在加第三个值时把读者自己的会话一起藏掉）。
 */
export type AgentSessionOriginState = 'current' | 'superseded'

export function normalizeSessionOriginState(value: unknown): AgentSessionOriginState {
  return value === 'superseded' ? 'superseded' : 'current'
}

/**
 * The one normalisation: anything that is not the explicit automation value is a reader session.
 *
 * The direction is deliberate — an automation session leaking into the default list is a nuisance,
 * while a reader's own session being hidden is a lie about their own history.
 */
export function normalizeSessionOrigin(value: unknown): AgentSessionOrigin {
  return value === 'automation' ? 'automation' : 'reader'
}

/** A free-form group the caller names (the platform does not know product vocabularies). */
export function normalizeSessionOriginGroup(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

/**
 * 自动会话的**幂等键**：创建它的那一次运行（本处是分析的 run id）。
 *
 * 与 `originGroup` 分开是两个含义：分组键说「这些会话属于同一类」（侧栏按它折叠），
 * 幂等键说「这一次是哪一个」。合成一个字段，每次运行就会变成侧栏里的一个独立分组。
 * 只接受非空字符串，空串按「没给」处理——不允许用空串当键，那会让所有自动会话撞在一起。
 */
export function normalizeSessionOriginRef(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
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
  /**
   * 来源：读者发起 / 自动。列带 `not null default 'reader'`，所以库里的老行一律是 `reader`；
   * 读侧仍走 `normalizeSessionOrigin`，脏数据不会被当成自动会话藏起来。
   */
  origin?: AgentSessionOrigin
  /** 自动会话的分组名（调用方给，平台只按它分组）。 */
  originGroup?: string
  /** 自动会话的幂等键：创建它的那一次运行。**身份，不是描述**。 */
  originRef?: string
  /** 自动会话的可见性：只有 `superseded` 会在自动会话块里隐藏；缺省即可见。 */
  originState?: AgentSessionOriginState
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
  /** 缺省 `reader`；未知值归一成 `reader`（见 `normalizeSessionOrigin`）。 */
  origin?: AgentSessionOrigin
  /** 自动会话的分组名；平台不做词表，只按原样存。 */
  originGroup?: string
  /** 自动会话的幂等键：创建它的那一次运行；平台不做词表，只按原样存。 */
  originRef?: string
  /** 只有被同身份的新会话取代时才传 `superseded`；缺省即可见。 */
  originState?: AgentSessionOriginState
}

export type UpdateAgentSessionDto = {
  name?: string
  description?: string
  agentId?: string | null
  /**
   * 只用于把**已有会话归位到它真正的来源**（历史数据的身份修正）：内容、名字、消息一条不动。
   * 缺省 = 不改；三个字段按平台既有的规范化函数读入，和创建时同一套口径。
   */
  origin?: AgentSessionOrigin
  originGroup?: string
  originRef?: string
  /** 只用于把已有会话标成「已被同身份新会话取代」；缺省不动。 */
  originState?: AgentSessionOriginState
}

export type AgentSessionMessagesListQuery = {
  cursor?: string
  limit?: number
}

export type ListAgentSessionsQuery = {
  agentId?: string
  cursor?: string
  limit?: number
  /** 只看读者发起的（默认列表），或只看自动会话（「自动」分组）。缺省 = 不筛。 */
  origin?: AgentSessionOrigin
}

export type DeleteAgentSessionsResult = {
  deletedIds: string[]
}

export const AGENT_SESSION_DELETE_MAX_IDS = 200
