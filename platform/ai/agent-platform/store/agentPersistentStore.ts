import type { AgentChannelTaskSubscription, AgentSkillBinding, AgentStoreSeed, AgentStoreState } from './agentStore'
import { createAgentStoreState } from './agentStore'
import type { AgentProductToolPackageBinding } from '../productTools/productAgentToolSchemas'
import type { AgentEntity } from '../schemas/agentSchemas'
import type { AgentChannelEntity } from '../schemas/channelSchemas'
import { mcpRuntimeStates, type McpRuntimeStatus, type McpServerEntity } from '../schemas/mcpServerSchemas'
import type { AgentSessionEntity, AgentSessionMessageEntity } from '../schemas/sessionSchemas'
import type { InstalledSkill } from '../schemas/skillSchemas'
import type { ScheduledTaskEntity, TaskRunLogEntity } from '../schemas/taskSchemas'
import type { McpToolsByServerId } from '../tools/agentToolCatalog'
import type { AgentWorkspaceEntity } from '../schemas/workspaceSchemas'
import type { TaskMutationAuditEntity } from '../runtime/tasks/taskAutomationContracts'

const UNCONFIGURED_MODEL_PREFIX = 'unconfigured:'
const PLATFORM_DEFAULT_AGENT_ID = 'default-assistant'

export type AgentPersistentStorage = {
  read: () => Promise<unknown>
  write: (state: AgentStoreState) => Promise<void>
}

export type AgentPersistentWriteOptions = {
  skipSkillRowMirror?: boolean
  activeSelectionRowOnly?: boolean
  sessionPinRowsOnly?: boolean
  taskRowsOnly?: boolean
  taskRunLogRowsOnly?: boolean
  channelRowsOnly?: boolean
  /** @deprecated SQLite ignores direct subscription writes; use TaskAutomationCommandService. */
  channelTaskSubscriptionRowsOnly?: boolean
}

export type AgentPersistentStore = {
  getState: () => Promise<AgentStoreState>
  update: (
    updater: (state: AgentStoreState) => AgentStoreState,
    options?: AgentPersistentWriteOptions
  ) => Promise<AgentStoreState>
  replace: (state: AgentStoreState, options?: AgentPersistentWriteOptions) => Promise<AgentStoreState>
  recordTaskMutationAudit?: (audit: TaskMutationAuditEntity) => Promise<void>
  transactTaskAutomationMutation?: <T>(input: {
    mutate: (state: AgentStoreState) => { state: AgentStoreState; result: T; audit: TaskMutationAuditEntity }
    rejectedAudit: (state: AgentStoreState, error: unknown) => TaskMutationAuditEntity
  }) => Promise<T>
  transactTaskRunAdmission?: <T>(input: {
    mutate: (state: AgentStoreState) => {
      state: AgentStoreState
      result: T
      audit: TaskMutationAuditEntity
      runLog: TaskRunLogEntity
    }
    rejectedAudit: (state: AgentStoreState, error: unknown) => TaskMutationAuditEntity
  }) => Promise<T>
  transactTaskRunLogMutation?: <T>(input: {
    mutate: (state: AgentStoreState) => {
      state: AgentStoreState
      result: T
      runLog: TaskRunLogEntity | null
    }
  }) => Promise<T>
  transactChannelDeletionMutation?: <T>(input: {
    channelId: string
    mutate: (state: AgentStoreState) => { state: AgentStoreState; result: T; audits: TaskMutationAuditEntity[] }
  }) => Promise<T>
  upsertTaskRunLog?: (log: TaskRunLogEntity) => Promise<TaskRunLogEntity>
  patchTaskRunLog?: (runLogId: string, patch: Partial<TaskRunLogEntity>) => Promise<TaskRunLogEntity | null>
  recordRuntimeTaskRun?: (taskId: string, input: { startedAt: string; updatedAt: string }) => Promise<ScheduledTaskEntity | null>
  pauseTaskForFailureCircuit?: (taskId: string, updatedAt: string) => Promise<ScheduledTaskEntity | null>
}

export function createDefaultAgentPersistentState(seed: AgentStoreSeed = {}): AgentStoreState {
  return createAgentStoreState(seed)
}

export function normalizeAgentStoreState(value: unknown): AgentStoreState {
  if (!value || typeof value !== 'object') return createDefaultAgentPersistentState()

  const candidate = value as Partial<AgentStoreState>
  return createAgentStoreState({
    agents: asArray<AgentEntity>(candidate.agents),
    sessions: asArray<AgentSessionEntity>(candidate.sessions),
    workspaces: asArray<AgentWorkspaceEntity>(candidate.workspaces),
    sessionPins: asArray(candidate.sessionPins),
    messagesBySessionId: asMessageMap(candidate.messagesBySessionId),
    mcpServers: asArray<McpServerEntity>(candidate.mcpServers),
    mcpToolsByServerId: asMcpToolsMap(candidate.mcpToolsByServerId),
    mcpRuntimeStatusByServerId: asMcpRuntimeStatusMap(candidate.mcpRuntimeStatusByServerId),
    channels: asArray<AgentChannelEntity>(candidate.channels),
    skills: asArray<InstalledSkill>(candidate.skills),
    agentSkills: asArray<AgentSkillBinding>(candidate.agentSkills),
    agentProductToolPackages: asArray<AgentProductToolPackageBinding>(candidate.agentProductToolPackages),
    tasks: asArray<ScheduledTaskEntity>(candidate.tasks),
    taskRunLogs: asArray<TaskRunLogEntity>(candidate.taskRunLogs),
    channelTaskSubscriptions: asArray<AgentChannelTaskSubscription>(candidate.channelTaskSubscriptions),
    activeAgentId: typeof candidate.activeAgentId === 'string' ? candidate.activeAgentId : null,
    activeSessionId: typeof candidate.activeSessionId === 'string' ? candidate.activeSessionId : null
  })
}

export function mergeAgentStoreSeeds(state: AgentStoreState, seed: AgentStoreSeed): AgentStoreState {
  const seedAgentsById = new Map((seed.agents ?? []).map((agent) => [agent.id, agent]))
  const merged = createAgentStoreState({
    agents: mergeSeedAgents(state.agents, seed.agents ?? [], seedAgentsById),
    sessions: mergeById(state.sessions, seed.sessions ?? []),
    workspaces: mergeById(state.workspaces, seed.workspaces ?? []),
    sessionPins: mergeByUniqueKey(state.sessionPins, seed.sessionPins ?? [], (pin) => pin.sessionId),
    messagesBySessionId: mergeMessageMaps(state.messagesBySessionId, seed.messagesBySessionId ?? {}),
    mcpServers: mergeById(state.mcpServers, seed.mcpServers ?? []),
    mcpToolsByServerId: mergeMcpToolsMaps(state.mcpToolsByServerId, seed.mcpToolsByServerId ?? {}),
    mcpRuntimeStatusByServerId: mergeMcpRuntimeStatusMaps(
      state.mcpRuntimeStatusByServerId,
      seed.mcpRuntimeStatusByServerId ?? {}
    ),
    channels: mergeById(state.channels, seed.channels ?? []),
    skills: mergeById(state.skills, seed.skills ?? []),
    agentSkills: mergeByUniqueKey(state.agentSkills, seed.agentSkills ?? [], (binding) => `${binding.agentId}:${binding.skillId}`),
    agentProductToolPackages: mergeByUniqueKey(
      state.agentProductToolPackages ?? [],
      seed.agentProductToolPackages ?? [],
      (binding) => `${binding.agentId}:${binding.productId}`
    ),
    tasks: mergeById(state.tasks, seed.tasks ?? []),
    taskRunLogs: mergeById(state.taskRunLogs, seed.taskRunLogs ?? []),
    channelTaskSubscriptions: mergeByUniqueKey(
      state.channelTaskSubscriptions,
      seed.channelTaskSubscriptions ?? [],
      (subscription) => `${subscription.channelId}:${subscription.taskId}`
    ),
    activeAgentId: state.activeAgentId ?? seed.activeAgentId ?? null,
    activeSessionId: state.activeSessionId ?? (state.activeAgentId ? null : seed.activeSessionId ?? null)
  })

  return merged
}

function mergeSeedAgents(
  current: readonly AgentEntity[],
  seed: readonly AgentEntity[],
  seedAgentsById: ReadonlyMap<string, AgentEntity>
): AgentEntity[] {
  const existingIds = new Set(current.map((item) => item.id))
  return [
    ...current.map((agent) => upgradeUnconfiguredSeedAgentModel(agent, seedAgentsById.get(agent.id))),
    ...seed.filter((item) => !existingIds.has(item.id))
  ]
}

function upgradeUnconfiguredSeedAgentModel(agent: AgentEntity, seedAgent: AgentEntity | undefined): AgentEntity {
  if (!seedAgent) return agent
  if (!shouldAdoptSeedAgentModel(agent, seedAgent)) return agent
  if (!seedAgent.model) return agent
  if (isUnconfiguredModelId(seedAgent.model)) return agent

  return {
    ...agent,
    model: seedAgent.model,
    modelName: seedAgent.modelName
  }
}

function shouldAdoptSeedAgentModel(agent: AgentEntity, seedAgent: AgentEntity): boolean {
  if (isUnconfiguredModelId(agent.model)) return true
  if (agent.id !== PLATFORM_DEFAULT_AGENT_ID) return false
  if (!agent.model || !seedAgent.model) return false
  if (agent.model === seedAgent.model) return false
  return agent.name === seedAgent.name
}

function isUnconfiguredModelId(modelId: string | null | undefined): boolean {
  return Boolean(modelId?.startsWith(UNCONFIGURED_MODEL_PREFIX))
}

export function createAgentPersistentStore(storage?: AgentPersistentStorage, seed: AgentStoreSeed = {}): AgentPersistentStore {
  let state: AgentStoreState | null = null
  let mutationQueue = Promise.resolve()

  async function load(): Promise<AgentStoreState> {
    if (state) return state
    if (!storage) {
      state = createDefaultAgentPersistentState(seed)
      return state
    }

    const persisted = normalizeAgentStoreState(await storage.read())
    state = mergeAgentStoreSeeds(persisted, seed)
    return state
  }

  async function save(nextState: AgentStoreState): Promise<AgentStoreState> {
    const normalized = normalizeAgentStoreState(nextState)
    await storage?.write(normalized)
    state = normalized
    return normalized
  }

  function enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = mutationQueue.then(operation, operation)
    mutationQueue = result.then(() => undefined, () => undefined)
    return result
  }

  return {
    getState: load,
    update: (updater) => enqueue(async () => save(updater(await load()))),
    replace: (nextState) => enqueue(() => save(nextState)),
    transactTaskRunLogMutation: (input) => enqueue(async () => {
      const current = await load()
      const mutation = input.mutate(current)
      await save(mutation.state)
      return mutation.result
    })
  }
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? ([...value] as T[]) : []
}

function asMessageMap(value: unknown): Record<string, AgentSessionMessageEntity[]> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}

  const messagesBySessionId: Record<string, AgentSessionMessageEntity[]> = {}
  for (const [sessionId, messages] of Object.entries(value as Record<string, unknown>)) {
    if (Array.isArray(messages)) messagesBySessionId[sessionId] = [...messages] as AgentSessionMessageEntity[]
  }
  return messagesBySessionId
}

function asMcpToolsMap(value: unknown): McpToolsByServerId {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}

  const mcpToolsByServerId: McpToolsByServerId = {}
  for (const [serverId, tools] of Object.entries(value as Record<string, unknown>)) {
    if (Array.isArray(tools)) {
      mcpToolsByServerId[serverId] = tools.filter(isMcpToolLike).map((tool) => ({ ...tool }))
    }
  }
  return mcpToolsByServerId
}

function asMcpRuntimeStatusMap(value: unknown): Record<string, McpRuntimeStatus> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}

  const statuses: Record<string, McpRuntimeStatus> = {}
  for (const [serverId, status] of Object.entries(value as Record<string, unknown>)) {
    if (isMcpRuntimeStatusLike(status)) statuses[serverId] = { ...status }
  }
  return statuses
}

function mergeById<T extends { id: string }>(current: readonly T[], seed: readonly T[]): T[] {
  const existingIds = new Set(current.map((item) => item.id))
  return [...current, ...seed.filter((item) => !existingIds.has(item.id))]
}

function mergeByUniqueKey<T>(current: readonly T[], seed: readonly T[], keyOf: (item: T) => string): T[] {
  const existingKeys = new Set(current.map(keyOf))
  return [...current, ...seed.filter((item) => !existingKeys.has(keyOf(item)))]
}

function mergeMessageMaps(
  current: Record<string, AgentSessionMessageEntity[]>,
  seed: Record<string, AgentSessionMessageEntity[]>
): Record<string, AgentSessionMessageEntity[]> {
  const next: Record<string, AgentSessionMessageEntity[]> = Object.fromEntries(
    Object.entries(current).map(([sessionId, messages]) => [sessionId, [...messages]])
  )
  for (const [sessionId, messages] of Object.entries(seed)) {
    if (!next[sessionId]) next[sessionId] = [...messages]
  }
  return next
}

function mergeMcpToolsMaps(current: McpToolsByServerId, seed: McpToolsByServerId): McpToolsByServerId {
  const next: McpToolsByServerId = Object.fromEntries(
    Object.entries(current).map(([serverId, tools]) => [serverId, [...tools]])
  )
  for (const [serverId, tools] of Object.entries(seed)) {
    if (!next[serverId]) next[serverId] = [...tools]
  }
  return next
}

function mergeMcpRuntimeStatusMaps(
  current: Record<string, McpRuntimeStatus>,
  seed: Record<string, McpRuntimeStatus>
): Record<string, McpRuntimeStatus> {
  const next: Record<string, McpRuntimeStatus> = Object.fromEntries(
    Object.entries(current).map(([serverId, status]) => [serverId, { ...status }])
  )
  for (const [serverId, status] of Object.entries(seed)) {
    if (!next[serverId]) next[serverId] = { ...status }
  }
  return next
}

function isMcpToolLike(value: unknown): value is McpToolsByServerId[string][number] {
  return Boolean(value && typeof value === 'object' && typeof (value as { name?: unknown }).name === 'string')
}

function isMcpRuntimeStatusLike(value: unknown): value is McpRuntimeStatus {
  if (!value || typeof value !== 'object') return false
  const status = value as Partial<McpRuntimeStatus>
  return (
    typeof status.state === 'string' &&
    (mcpRuntimeStates as readonly string[]).includes(status.state) &&
    typeof status.lastCheckedAt === 'number' &&
    Number.isFinite(status.lastCheckedAt)
  )
}
