import type {
  AgentEntity,
  CreateAgentDto,
  UpdateAgentDto,
  UniqueModelId
} from '../schemas/agentSchemas'
import type { AgentChannelEntity } from '../schemas/channelSchemas'
import type { McpRuntimeStatus, McpServerEntity } from '../schemas/mcpServerSchemas'
import type {
  AgentSessionMessagesListQuery,
  AgentSessionEntity,
  AgentSessionMessageEntity,
  CreateAgentSessionDto,
  CreateAgentSessionMessageDto,
  ListAgentSessionsQuery,
  MessageData,
  UpdateAgentSessionDto
} from '../schemas/sessionSchemas'
import { getAgentMessagePromptText } from '../schemas/messageDataHelpers'
import {
  AGENT_SESSIONS_DEFAULT_LIMIT as DEFAULT_SESSION_PAGE_LIMIT,
  AGENT_SESSIONS_MAX_LIMIT as MAX_SESSION_PAGE_LIMIT,
  AGENT_SESSION_MESSAGES_DEFAULT_LIMIT as DEFAULT_MESSAGE_PAGE_LIMIT,
  AGENT_SESSION_MESSAGES_MAX_LIMIT as MAX_MESSAGE_PAGE_LIMIT
} from '../schemas/sessionSchemas'
import type { InstalledSkill } from '../schemas/skillSchemas'
import type { ScheduledTaskEntity, TaskRunLogEntity } from '../schemas/taskSchemas'
import { DEFAULT_SYSTEM_WORKSPACE_PATH, type AgentWorkspaceEntity } from '../schemas/workspaceSchemas'
import type { AgentSessionWorkspaceSource, CreateAgentWorkspaceDto, UpdateAgentWorkspaceDto } from '../schemas/workspaceSchemas'
import type { McpToolsByServerId } from '../tools/agentToolCatalog'
import { normalizeSessionAllowedTools } from '../tools/sessionAllowedTools'
import type { AgentProductToolPackageBinding } from '../productTools/productAgentToolSchemas'

export type { AgentProductToolPackageBinding }

export type AgentSessionPin = {
  id: string
  sessionId: string
  createdAt: string
}

export type AgentSkillBinding = {
  agentId: string
  skillId: string
  isEnabled: boolean
}

export type AgentChannelTaskSubscription = {
  channelId: string
  taskId: string
}

export type AgentStoreState = {
  agents: AgentEntity[]
  sessions: AgentSessionEntity[]
  workspaces: AgentWorkspaceEntity[]
  sessionPins: AgentSessionPin[]
  messagesBySessionId: Record<string, AgentSessionMessageEntity[]>
  mcpServers: McpServerEntity[]
  mcpToolsByServerId: McpToolsByServerId
  mcpRuntimeStatusByServerId: Record<string, McpRuntimeStatus>
  channels: AgentChannelEntity[]
  skills: InstalledSkill[]
  agentSkills: AgentSkillBinding[]
  agentProductToolPackages?: AgentProductToolPackageBinding[]
  tasks: ScheduledTaskEntity[]
  taskRunLogs: TaskRunLogEntity[]
  channelTaskSubscriptions: AgentChannelTaskSubscription[]
  activeAgentId: string | null
  activeSessionId: string | null
}

export type AgentStoreSeed = {
  agents?: AgentEntity[]
  sessions?: AgentSessionEntity[]
  workspaces?: AgentWorkspaceEntity[]
  sessionPins?: AgentSessionPin[]
  messagesBySessionId?: Record<string, AgentSessionMessageEntity[]>
  mcpServers?: McpServerEntity[]
  mcpToolsByServerId?: McpToolsByServerId
  mcpRuntimeStatusByServerId?: Record<string, McpRuntimeStatus>
  channels?: AgentChannelEntity[]
  skills?: InstalledSkill[]
  agentSkills?: AgentSkillBinding[]
  agentProductToolPackages?: AgentProductToolPackageBinding[]
  tasks?: ScheduledTaskEntity[]
  taskRunLogs?: TaskRunLogEntity[]
  channelTaskSubscriptions?: AgentChannelTaskSubscription[]
  activeAgentId?: string | null
  activeSessionId?: string | null
}

export type CursorPaginationResponse<T> = {
  items: T[]
  nextCursor?: string
}

export function createAgentStoreState(seed: AgentStoreSeed = {}): AgentStoreState {
  const sessionPins = [...(seed.sessionPins ?? [])]
  const sessions = sortSessions(seed.sessions ?? [], sessionPins)
  // ExplicitAgentSelectionPolicy：明确选择的 Agent 无会话时保持空白，不跳到其他 Agent。
  const selectedAgent = seed.agents?.find((agent) => agent.id === seed.activeAgentId)
  const activeSession =
    sessions.find((session) => session.id === seed.activeSessionId) ??
    (selectedAgent ? sessions.find((session) => session.agentId === selectedAgent.id) : sessions[0]) ??
    null
  const activeAgent =
    seed.agents?.find((agent) => agent.id === (activeSession?.agentId ?? seed.activeAgentId)) ??
    seed.agents?.[0] ??
    null

  return {
    agents: [...(seed.agents ?? [])],
    sessions,
    workspaces: [...(seed.workspaces ?? [])],
    sessionPins,
    messagesBySessionId: cloneMessageMap(seed.messagesBySessionId ?? {}),
    mcpServers: [...(seed.mcpServers ?? [])].sort(sortMcpServers),
    mcpToolsByServerId: cloneMcpToolsMap(seed.mcpToolsByServerId ?? {}),
    mcpRuntimeStatusByServerId: cloneMcpRuntimeStatusMap(seed.mcpRuntimeStatusByServerId ?? {}),
    channels: [...(seed.channels ?? [])],
    skills: [...(seed.skills ?? [])],
    agentSkills: [...(seed.agentSkills ?? [])],
    agentProductToolPackages: [...(seed.agentProductToolPackages ?? [])],
    tasks: [...(seed.tasks ?? [])],
    taskRunLogs: [...(seed.taskRunLogs ?? [])],
    channelTaskSubscriptions: [...(seed.channelTaskSubscriptions ?? [])],
    activeAgentId: activeSession?.agentId ?? activeAgent?.id ?? null,
    activeSessionId: activeSession?.id ?? null
  }
}

export function selectAgentSession(state: AgentStoreState, sessionId: string): AgentStoreState {
  const session = state.sessions.find((item) => item.id === sessionId)
  if (!session) return state

  return {
    ...state,
    activeAgentId: session.agentId,
    activeSessionId: session.id
  }
}

export function selectAgent(state: AgentStoreState, agentId: string): AgentStoreState {
  const agent = state.agents.find((item) => item.id === agentId)
  if (!agent) return state

  const session = state.sessions.find((item) => item.agentId === agent.id)
  return {
    ...state,
    activeAgentId: agent.id,
    activeSessionId: session?.id ?? null
  }
}

export function createAgent(state: AgentStoreState, payload: CreateAgentDto): AgentStoreState {
  const now = new Date().toISOString()
  const id = createId('agent')
  const agent: AgentEntity = {
    id,
    type: payload.type,
    name: payload.name,
    description: payload.description,
    instructions: payload.instructions,
    model: payload.model,
    modelName: modelNameFromUniqueModelId(payload.model),
    planModel: payload.planModel,
    smallModel: payload.smallModel,
    mcps: payload.mcps,
    disabledTools: payload.disabledTools,
    configuration: payload.configuration,
    orderKey: createOrderKey(now, state.agents.length),
    createdAt: now,
    updatedAt: now
  }

  return {
    ...state,
    agents: [...state.agents, agent],
    activeAgentId: agent.id
  }
}

export function updateAgent(state: AgentStoreState, agentId: string, patch: UpdateAgentDto): AgentStoreState {
  let changed = false
  const now = new Date().toISOString()
  const agents = state.agents.map((agent) => {
    if (agent.id !== agentId) return agent
    changed = true
    const nextModel = patch.model === undefined ? agent.model : patch.model
    return {
      ...agent,
      ...patch,
      model: nextModel ?? agent.model,
      modelName: patch.model ? modelNameFromUniqueModelId(patch.model) : agent.modelName,
      updatedAt: now
    }
  })

  return changed ? { ...state, agents } : state
}

export function deleteAgent(state: AgentStoreState, agentId: string): AgentStoreState {
  const agents = state.agents.filter((agent) => agent.id !== agentId)
  const sessions = state.sessions.map((session) => (session.agentId === agentId ? { ...session, agentId: null } : session))
  const activeAgentId = state.activeAgentId === agentId ? agents[0]?.id ?? null : state.activeAgentId
  const activeSession =
    sessions.find((session) => session.id === state.activeSessionId && session.agentId === activeAgentId) ??
    sessions.find((session) => session.agentId === activeAgentId) ??
    null

  return {
    ...state,
    agents,
    sessions,
    activeAgentId,
    activeSessionId: activeSession?.id ?? null
  }
}

export function createAgentSession(state: AgentStoreState, payload: CreateAgentSessionDto): AgentStoreState {
  const agent = state.agents.find((item) => item.id === payload.agentId)
  if (!agent) return state

  const now = new Date().toISOString()
  const workspaceResult = resolveWorkspace(state, payload.workspace)
  if (!workspaceResult) return state
  const { workspace, workspaces } = workspaceResult

  const session: AgentSessionEntity = {
    id: createId('session'),
    agentId: payload.agentId,
    name: payload.name,
    description: payload.description,
    workspaceId: workspace.id,
    workspace,
    orderKey: createFirstOrderKey(state.sessions),
    allowedTools: normalizeSessionAllowedTools(payload.allowedTools),
    createdAt: now,
    updatedAt: now
  }

  return {
    ...state,
    workspaces,
    sessions: sortSessions([session, ...state.sessions], state.sessionPins),
    activeAgentId: payload.agentId,
    activeSessionId: session.id
  }
}

export function updateAgentSession(
  state: AgentStoreState,
  sessionId: string,
  patch: UpdateAgentSessionDto
): AgentStoreState {
  let changed = false
  const now = new Date().toISOString()
  const sessions = state.sessions.map((session) => {
    if (session.id !== sessionId) return session
    changed = true
    return {
      ...session,
      ...patch,
      updatedAt: now
    }
  })

  if (!changed) return state

  const activeSession = sessions.find((session) => session.id === state.activeSessionId)
  return {
    ...state,
    sessions: sortSessions(sessions, state.sessionPins),
    activeAgentId: activeSession?.agentId ?? state.activeAgentId
  }
}

export function updateAgentSessionAgent(state: AgentStoreState, sessionId: string, agentId: string | null): AgentStoreState {
  if (agentId !== null && !state.agents.some((agent) => agent.id === agentId)) return state

  const next = updateAgentSession(state, sessionId, { agentId })
  if (next === state || state.activeSessionId !== sessionId) return next

  return {
    ...next,
    activeAgentId: agentId
  }
}

export function updateAgentSessionWorkspace(
  state: AgentStoreState,
  sessionId: string,
  source: AgentSessionWorkspaceSource
): AgentStoreState {
  const workspaceResult = resolveWorkspace(state, source)
  if (!workspaceResult) return state
  const { workspace, workspaces } = workspaceResult

  let changed = false
  const now = new Date().toISOString()
  const sessions = state.sessions.map((session) => {
    if (session.id !== sessionId) return session
    changed = true
    return {
      ...session,
      workspaceId: workspace.id,
      workspace,
      updatedAt: now
    }
  })

  return changed ? { ...state, workspaces, sessions: sortSessions(sessions, state.sessionPins) } : state
}

export function upsertAgentWorkspace(state: AgentStoreState, payload: CreateAgentWorkspaceDto): AgentStoreState {
  const normalizedPath = payload.path.trim()
  if (!normalizedPath) return state

  const existing = state.workspaces.find((workspace) => workspace.path === normalizedPath)
  const now = new Date().toISOString()
  const name = payload.name?.trim() || workspaceNameFromPath(normalizedPath)

  if (existing) {
    return {
      ...state,
      workspaces: state.workspaces.map((workspace) =>
        workspace.id === existing.id
          ? {
              ...workspace,
              name,
              updatedAt: now
            }
          : workspace
      )
    }
  }

  const workspace: AgentWorkspaceEntity = {
    id: createId('workspace'),
    name,
    path: normalizedPath,
    type: 'user',
    orderKey: createOrderKey(now, state.workspaces.length),
    createdAt: now,
    updatedAt: now
  }

  return {
    ...state,
    workspaces: [...state.workspaces, workspace]
  }
}

export function updateAgentWorkspace(
  state: AgentStoreState,
  workspaceId: string,
  payload: UpdateAgentWorkspaceDto
): AgentStoreState {
  const workspace = state.workspaces.find((item) => item.id === workspaceId)
  if (!workspace) return state

  const name = payload.name.trim()
  if (!name) return state
  const updatedWorkspace: AgentWorkspaceEntity = {
    ...workspace,
    name,
    updatedAt: new Date().toISOString()
  }

  return {
    ...state,
    workspaces: state.workspaces.map((item) => (item.id === workspaceId ? updatedWorkspace : item)),
    sessions: state.sessions.map((session) =>
      session.workspaceId === workspaceId
        ? {
            ...session,
            workspace: updatedWorkspace,
            updatedAt: updatedWorkspace.updatedAt
          }
        : session
    )
  }
}

export function deleteAgentWorkspace(state: AgentStoreState, workspaceId: string): AgentStoreState {
  if (!state.workspaces.some((workspace) => workspace.id === workspaceId)) return state
  const sessionIds = state.sessions.filter((session) => session.workspaceId === workspaceId).map((session) => session.id)
  const withoutSessions = deleteAgentSessions(state, sessionIds)
  return {
    ...withoutSessions,
    workspaces: withoutSessions.workspaces.filter((workspace) => workspace.id !== workspaceId)
  }
}

export function deleteAgentSession(state: AgentStoreState, sessionId: string): AgentStoreState {
  return deleteAgentSessions(state, [sessionId])
}

export function deleteAgentSessionsByAgent(state: AgentStoreState, agentId: string): AgentStoreState {
  return deleteAgentSessions(
    state,
    state.sessions.filter((session) => session.agentId === agentId).map((session) => session.id)
  )
}

export function deleteAgentSessions(state: AgentStoreState, sessionIds: readonly string[]): AgentStoreState {
  const sessionIdSet = new Set(sessionIds)
  if (sessionIdSet.size === 0) return state

  const sessions = state.sessions.filter((session) => !sessionIdSet.has(session.id))
  const sessionPins = state.sessionPins.filter((pin) => !sessionIdSet.has(pin.sessionId))
  const messagesBySessionId = { ...state.messagesBySessionId }
  for (const sessionId of sessionIdSet) delete messagesBySessionId[sessionId]

  if (!state.activeSessionId || !sessionIdSet.has(state.activeSessionId)) {
    return {
      ...state,
      sessions,
      sessionPins,
      messagesBySessionId
    }
  }

  const nextActiveSession = sessions[0] ?? null
  return {
    ...state,
    sessions,
    sessionPins,
    messagesBySessionId,
    activeSessionId: nextActiveSession?.id ?? null,
    activeAgentId: nextActiveSession?.agentId ?? state.agents[0]?.id ?? null
  }
}

export function reorderAgentSessions(state: AgentStoreState, orderedSessionIds: readonly string[]): AgentStoreState {
  const orderById = new Map(orderedSessionIds.map((sessionId, index) => [sessionId, index]))
  const sessions = state.sessions.map((session) => {
    const index = orderById.get(session.id)
    return index === undefined
      ? session
      : {
          ...session,
          orderKey: String(index).padStart(4, '0'),
          updatedAt: new Date().toISOString()
        }
  })

  return {
    ...state,
    sessions: sortSessions(sessions, state.sessionPins)
  }
}

export function toggleSessionPin(state: AgentStoreState, sessionId: string): AgentStoreState {
  if (!state.sessions.some((session) => session.id === sessionId)) return state

  const existing = state.sessionPins.find((pin) => pin.sessionId === sessionId)
  const sessionPins = existing
    ? state.sessionPins.filter((pin) => pin.sessionId !== sessionId)
    : [{ id: createId('pin'), sessionId, createdAt: new Date().toISOString() }, ...state.sessionPins]

  return {
    ...state,
    sessionPins,
    sessions: sortSessions(state.sessions, sessionPins)
  }
}

export function listAgentSessions(
  state: AgentStoreState,
  query: ListAgentSessionsQuery = {}
): CursorPaginationResponse<AgentSessionEntity> {
  const limit = normalizePageLimit(query.limit, DEFAULT_SESSION_PAGE_LIMIT, MAX_SESSION_PAGE_LIMIT)
  const cursor = query.cursor ? decodeSessionCursor(query.cursor) : null
  const sessionPins = state.sessionPins
  const sortedSessions = [...state.sessions]
    .filter((session) => !query.agentId || session.agentId === query.agentId)
    .sort((a, b) => compareSessionListOrder(a, b, sessionPins))
  const pageSource = cursor ? sortedSessions.filter((session) => isSessionAfterCursor(session, cursor, sessionPins)) : sortedSessions
  const pageItems = pageSource.slice(0, limit)
  const hasNext = pageSource.length > limit
  const tail = pageItems.at(-1)

  return {
    items: pageItems,
    nextCursor: hasNext && tail ? encodeSessionCursor(tail, sessionPins) : undefined
  }
}

export function addAgentSessionMessage(
  state: AgentStoreState,
  sessionId: string,
  payload: CreateAgentSessionMessageDto
): AgentStoreState {
  if (!state.sessions.some((session) => session.id === sessionId)) return state

  const now = new Date().toISOString()
  const message: AgentSessionMessageEntity = {
    id: payload.id ?? createId('message'),
    sessionId,
    role: payload.role,
    data: payload.data,
    searchableText: messageDataToSearchableText(payload.data),
    status: payload.status ?? 'success',
    modelId: payload.modelId ?? null,
    modelSnapshot: payload.modelSnapshot ?? null,
    stats: payload.stats ?? null,
    runtimeResumeToken: null,
    createdAt: now,
    updatedAt: now
  }

  return {
    ...state,
    messagesBySessionId: {
      ...state.messagesBySessionId,
      [sessionId]: [...(state.messagesBySessionId[sessionId] ?? []), message]
    },
    sessions: state.sessions.map((session) => (session.id === sessionId ? { ...session, updatedAt: now } : session))
  }
}

export function replaceAgentSessionMessage(
  state: AgentStoreState,
  sessionId: string,
  messageId: string,
  patch: Partial<AgentSessionMessageEntity>
): AgentStoreState {
  const messages = state.messagesBySessionId[sessionId]
  if (!messages) return state

  let changed = false
  const nextMessages = messages.map((message) => {
    if (message.id !== messageId) return message
    changed = true
    const nextData = patch.data ?? message.data
    return {
      ...message,
      ...patch,
      data: nextData,
      searchableText: patch.searchableText ?? messageDataToSearchableText(nextData),
      updatedAt: new Date().toISOString()
    }
  })

  if (!changed) return state
  return {
    ...state,
    messagesBySessionId: {
      ...state.messagesBySessionId,
      [sessionId]: nextMessages
    }
  }
}

export function deleteAgentSessionMessage(
  state: AgentStoreState,
  sessionId: string,
  messageId: string
): AgentStoreState {
  const messages = state.messagesBySessionId[sessionId]
  if (!messages) return state

  const nextMessages = messages.filter((message) => message.id !== messageId)
  if (nextMessages.length === messages.length) return state

  return {
    ...state,
    messagesBySessionId: {
      ...state.messagesBySessionId,
      [sessionId]: nextMessages
    }
  }
}

export function clearAgentSessionMessages(state: AgentStoreState, sessionId: string): AgentStoreState {
  if (!state.sessions.some((session) => session.id === sessionId)) return state

  return {
    ...state,
    messagesBySessionId: {
      ...state.messagesBySessionId,
      [sessionId]: []
    }
  }
}

export function reconcileStalePendingMessages(
  state: AgentStoreState,
  stoppedText = '上次运行已中断。'
): AgentStoreState {
  let changed = false
  const now = new Date().toISOString()
  const messagesBySessionId = Object.fromEntries(
    Object.entries(state.messagesBySessionId).map(([sessionId, messages]) => [
      sessionId,
      messages.map((message) => {
        if (message.status !== 'pending') return message
        changed = true
        const nextData = message.searchableText.trim() ? message.data : textData(stoppedText)
        return {
          ...message,
          status: 'paused' as const,
          data: nextData,
          searchableText: messageDataToSearchableText(nextData),
          updatedAt: now
        }
      })
    ])
  )

  return changed ? { ...state, messagesBySessionId } : state
}

export function mergeAgentRuntimeSessionState(
  current: AgentStoreState,
  runtimeSnapshot: AgentStoreState,
  sessionId: string
): AgentStoreState {
  const runtimeMessages = runtimeSnapshot.messagesBySessionId[sessionId]
  if (!runtimeMessages) return current

  const runtimeSession = runtimeSnapshot.sessions.find((session) => session.id === sessionId)
  const sessions = runtimeSession
    ? current.sessions.map((session) =>
        session.id === sessionId
          ? {
              ...session,
              updatedAt: runtimeSession.updatedAt
            }
          : session
      )
    : current.sessions

  return {
    ...current,
    sessions,
    messagesBySessionId: {
      ...current.messagesBySessionId,
      [sessionId]: [...runtimeMessages]
    }
  }
}

export function getActiveAgent(state: AgentStoreState): AgentEntity | null {
  return state.agents.find((agent) => agent.id === state.activeAgentId) ?? null
}

export function getActiveSession(state: AgentStoreState): AgentSessionEntity | null {
  return state.sessions.find((session) => session.id === state.activeSessionId) ?? null
}

export function getSessionMessages(state: AgentStoreState, sessionId: string | null | undefined): AgentSessionMessageEntity[] {
  if (!sessionId) return []
  return state.messagesBySessionId[sessionId] ?? []
}

export function listAgentSessionMessages(
  state: AgentStoreState,
  sessionId: string | null | undefined,
  query: AgentSessionMessagesListQuery = {}
): CursorPaginationResponse<AgentSessionMessageEntity> {
  if (!sessionId || !state.sessions.some((session) => session.id === sessionId)) return { items: [] }

  const limit = normalizeMessagePageLimit(query.limit)
  const cursor = query.cursor ? decodeMessageCursor(query.cursor) : null
  const sortedMessages = [...(state.messagesBySessionId[sessionId] ?? [])].sort(sortMessagesNewestFirst)
  const pageSource = cursor ? sortedMessages.filter((message) => isMessageOlderThanCursor(message, cursor)) : sortedMessages
  const pageItems = pageSource.slice(0, limit)
  const hasNext = pageSource.length > limit
  const tail = pageItems.at(-1)

  return {
    items: pageItems,
    nextCursor: hasNext && tail ? encodeMessageCursor(tail) : undefined
  }
}

function resolveWorkspace(
  state: AgentStoreState,
  source: CreateAgentSessionDto['workspace']
): { workspace: AgentWorkspaceEntity; workspaces: AgentWorkspaceEntity[] } | null {
  if (source.type === 'user') {
    const workspace = state.workspaces.find((item) => item.id === source.workspaceId)
    return workspace ? { workspace, workspaces: state.workspaces } : null
  }

  const existingSystemWorkspace = state.workspaces.find((workspace) => workspace.type === 'system')
  if (existingSystemWorkspace) {
    const normalizedSystemWorkspace =
      existingSystemWorkspace.path.trim().length > 0
        ? existingSystemWorkspace
        : {
            ...existingSystemWorkspace,
            path: DEFAULT_SYSTEM_WORKSPACE_PATH,
            updatedAt: new Date().toISOString()
          }
    if (normalizedSystemWorkspace === existingSystemWorkspace) {
      return { workspace: existingSystemWorkspace, workspaces: state.workspaces }
    }
    return {
      workspace: normalizedSystemWorkspace,
      workspaces: state.workspaces.map((workspace) =>
        workspace.id === normalizedSystemWorkspace.id ? normalizedSystemWorkspace : workspace
      )
    }
  }

  const now = new Date().toISOString()
  const workspace: AgentWorkspaceEntity = {
    id: createId('workspace'),
    name: 'System Workspace',
    path: DEFAULT_SYSTEM_WORKSPACE_PATH,
    type: 'system',
    orderKey: createOrderKey(now, state.workspaces.length),
    createdAt: now,
    updatedAt: now
  }

  return { workspace, workspaces: [...state.workspaces, workspace] }
}

function sortSessions(sessions: readonly AgentSessionEntity[], pins: readonly AgentSessionPin[]): AgentSessionEntity[] {
  const pinIndex = new Map(pins.map((pin, index) => [pin.sessionId, index]))
  return [...sessions].sort((a, b) => {
    const aPin = pinIndex.get(a.id)
    const bPin = pinIndex.get(b.id)
    if (aPin !== undefined || bPin !== undefined) {
      if (aPin === undefined) return 1
      if (bPin === undefined) return -1
      return aPin - bPin
    }
    const order = (a.orderKey ?? '').localeCompare(b.orderKey ?? '')
    return order === 0 ? a.id.localeCompare(b.id) : order
  })
}

function sortMcpServers(a: McpServerEntity, b: McpServerEntity): number {
  const order = (a.sortOrder ?? 0) - (b.sortOrder ?? 0)
  return order === 0 ? a.name.localeCompare(b.name) : order
}

function cloneMessageMap(
  messagesBySessionId: Record<string, AgentSessionMessageEntity[]>
): Record<string, AgentSessionMessageEntity[]> {
  return Object.fromEntries(Object.entries(messagesBySessionId).map(([sessionId, messages]) => [sessionId, [...messages]]))
}

function cloneMcpToolsMap(mcpToolsByServerId: McpToolsByServerId): McpToolsByServerId {
  return Object.fromEntries(Object.entries(mcpToolsByServerId).map(([serverId, tools]) => [serverId, [...tools]]))
}

function cloneMcpRuntimeStatusMap(
  mcpRuntimeStatusByServerId: Record<string, McpRuntimeStatus>
): Record<string, McpRuntimeStatus> {
  return Object.fromEntries(
    Object.entries(mcpRuntimeStatusByServerId).map(([serverId, status]) => [serverId, { ...status }])
  )
}

function messageDataToSearchableText(data: MessageData): string {
  return getAgentMessagePromptText(data)
}

function textData(text: string): MessageData {
  return { parts: [{ type: 'text', text }] }
}

function normalizeMessagePageLimit(limit: number | undefined): number {
  return normalizePageLimit(limit, DEFAULT_MESSAGE_PAGE_LIMIT, MAX_MESSAGE_PAGE_LIMIT)
}

function normalizePageLimit(limit: number | undefined, defaultLimit: number, maxLimit: number): number {
  if (!Number.isFinite(limit) || limit === undefined) return defaultLimit
  return Math.min(Math.max(Math.trunc(limit), 1), maxLimit)
}

function sortSessionsByOrderKey(a: AgentSessionEntity, b: AgentSessionEntity): number {
  const order = (a.orderKey ?? '').localeCompare(b.orderKey ?? '')
  return order === 0 ? a.id.localeCompare(b.id) : order
}

function compareSessionListOrder(
  a: AgentSessionEntity,
  b: AgentSessionEntity,
  pins: readonly AgentSessionPin[]
): number {
  const pinIndex = new Map(pins.map((pin, index) => [pin.sessionId, index]))
  const aPin = pinIndex.get(a.id)
  const bPin = pinIndex.get(b.id)
  if (aPin !== undefined || bPin !== undefined) {
    if (aPin === undefined) return 1
    if (bPin === undefined) return -1
    return aPin - bPin
  }
  return sortSessionsByOrderKey(a, b)
}

function sessionCursorSortKey(session: AgentSessionEntity, pins: readonly AgentSessionPin[]): string {
  const pinIndex = pins.findIndex((pin) => pin.sessionId === session.id)
  if (pinIndex >= 0) return `pin:${String(pinIndex).padStart(6, '0')}`
  return session.orderKey ?? ''
}

function isSessionAfterCursor(
  session: AgentSessionEntity,
  cursor: { kind: 'pin'; pinIndex: number; id: string } | { kind: 'session'; orderKey: string; id: string },
  pins: readonly AgentSessionPin[]
): boolean {
  const pinIndex = pins.findIndex((pin) => pin.sessionId === session.id)
  if (cursor.kind === 'pin') {
    if (pinIndex >= 0) {
      return pinIndex > cursor.pinIndex || (pinIndex === cursor.pinIndex && session.id > cursor.id)
    }
    return true
  }

  if (pinIndex >= 0) {
    return false
  }
  const order = (session.orderKey ?? '').localeCompare(cursor.orderKey)
  return order > 0 || (order === 0 && session.id > cursor.id)
}

function encodeSessionCursor(session: AgentSessionEntity, pins: readonly AgentSessionPin[]): string {
  return `${sessionCursorSortKey(session, pins)}:${session.id}`
}

function decodeSessionCursor(raw: string):
  | { kind: 'pin'; pinIndex: number; id: string }
  | { kind: 'session'; orderKey: string; id: string }
  | null {
  const separatorIndex = raw.lastIndexOf(':')
  if (separatorIndex < 0 || separatorIndex === raw.length - 1) return null

  const key = raw.slice(0, separatorIndex)
  const id = raw.slice(separatorIndex + 1)
  if (!key || !id) return null
  if (key.startsWith('pin:')) {
    const pinIndex = Number(key.slice('pin:'.length))
    return Number.isFinite(pinIndex) ? { kind: 'pin', pinIndex, id } : null
  }
  return { kind: 'session', orderKey: key, id }
}

function sortMessagesNewestFirst(a: AgentSessionMessageEntity, b: AgentSessionMessageEntity): number {
  const createdAtOrder = messageCreatedAtMs(b) - messageCreatedAtMs(a)
  return createdAtOrder === 0 ? b.id.localeCompare(a.id) : createdAtOrder
}

function isMessageOlderThanCursor(
  message: AgentSessionMessageEntity,
  cursor: { createdAt: number; id: string }
): boolean {
  const createdAt = messageCreatedAtMs(message)
  return createdAt < cursor.createdAt || (createdAt === cursor.createdAt && message.id < cursor.id)
}

function encodeMessageCursor(message: AgentSessionMessageEntity): string {
  return `${messageCreatedAtMs(message)}:${message.id}`
}

function decodeMessageCursor(raw: string): { createdAt: number; id: string } | null {
  const separatorIndex = raw.indexOf(':')
  if (separatorIndex <= 0 || separatorIndex === raw.length - 1) return null

  const createdAt = Number(raw.slice(0, separatorIndex))
  const id = raw.slice(separatorIndex + 1)
  if (!Number.isFinite(createdAt) || !id) return null
  return { createdAt, id }
}

function messageCreatedAtMs(message: AgentSessionMessageEntity): number {
  const createdAt = Date.parse(message.createdAt)
  return Number.isFinite(createdAt) ? createdAt : 0
}

function modelNameFromUniqueModelId(modelId: UniqueModelId): string {
  const [, modelName] = modelId.split(':')
  return modelName || modelId
}

function createOrderKey(timestamp: string, index: number): string {
  return `${timestamp}-${String(index).padStart(4, '0')}`
}

function createFirstOrderKey(sessions: readonly AgentSessionEntity[]): string {
  const smallest = sessions[0]?.orderKey
  return smallest ? `0-${Date.now().toString(36)}-${smallest}` : '0'
}

function workspaceNameFromPath(path: string): string {
  const segments = path.split(/[\\/]/).filter(Boolean)
  return segments.at(-1) ?? path
}

function createId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}
