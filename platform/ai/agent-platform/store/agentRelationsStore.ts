import { isSoulModeEnabled, normalizePermissionMode } from '../schemas/agentSchemas'
import type { AgentChannelEntity } from '../schemas/channelSchemas'
import type { McpRuntimeStatus, McpServerEntity } from '../schemas/mcpServerSchemas'
import type { InstalledSkill } from '../schemas/skillSchemas'
import type { CreateTaskDto, ScheduledTaskEntity, TaskRunLogEntity, UpdateTaskDto } from '../schemas/taskSchemas'
import { type McpToolInput, upsertMcpToolsForServer } from '../tools/agentToolCatalog'
import type { AgentChannelTaskSubscription, AgentSkillBinding, AgentStoreState } from './agentStore'

export function upsertAgentChannel(state: AgentStoreState, channel: AgentChannelEntity): AgentStoreState {
  const existingIndex = state.channels.findIndex((item) => item.id === channel.id)
  const channels =
    existingIndex >= 0
      ? state.channels.map((item, index) => (index === existingIndex ? { ...channel, updatedAt: nowIso() } : item))
      : [{ ...channel, createdAt: channel.createdAt || nowIso(), updatedAt: channel.updatedAt || nowIso() }, ...state.channels]

  return {
    ...state,
    channels
  }
}

export function deleteAgentChannel(state: AgentStoreState, channelId: string): AgentStoreState {
  return {
    ...state,
    channels: state.channels.filter((channel) => channel.id !== channelId),
    channelTaskSubscriptions: state.channelTaskSubscriptions.filter((subscription) => subscription.channelId !== channelId),
    tasks: state.tasks.map((task) => ({
      ...task,
      channelIds: task.channelIds?.filter((id) => id !== channelId) ?? []
    }))
  }
}

export function upsertMcpServer(state: AgentStoreState, server: McpServerEntity): AgentStoreState {
  const existingIndex = state.mcpServers.findIndex((item) => item.id === server.id)
  const nextServer = {
    ...server,
    createdAt: server.createdAt || nowIso(),
    updatedAt: nowIso()
  }
  const mcpServers =
    existingIndex >= 0
      ? state.mcpServers.map((item, index) => (index === existingIndex ? nextServer : item))
      : [nextServer, ...state.mcpServers]

  return {
    ...state,
    mcpServers: sortMcpServers(mcpServers)
  }
}

export function deleteMcpServer(state: AgentStoreState, serverId: string): AgentStoreState {
  const mcpToolsByServerId = { ...state.mcpToolsByServerId }
  delete mcpToolsByServerId[serverId]
  const mcpRuntimeStatusByServerId = { ...state.mcpRuntimeStatusByServerId }
  delete mcpRuntimeStatusByServerId[serverId]

  return {
    ...state,
    mcpServers: state.mcpServers.filter((server) => server.id !== serverId),
    mcpToolsByServerId,
    mcpRuntimeStatusByServerId,
    agents: state.agents.map((agent) => ({
      ...agent,
      mcps: agent.mcps?.filter((mcpId) => mcpId !== serverId)
    }))
  }
}

export function setMcpRuntimeStatus(
  state: AgentStoreState,
  serverId: string,
  status: McpRuntimeStatus
): AgentStoreState {
  if (!state.mcpServers.some((server) => server.id === serverId)) return state
  return {
    ...state,
    mcpRuntimeStatusByServerId: {
      ...state.mcpRuntimeStatusByServerId,
      [serverId]: { ...status }
    }
  }
}

export function setMcpServerTools(
  state: AgentStoreState,
  serverId: string,
  tools: readonly McpToolInput[]
): AgentStoreState {
  if (!state.mcpServers.some((server) => server.id === serverId)) return state
  return {
    ...state,
    mcpToolsByServerId: upsertMcpToolsForServer(state.mcpToolsByServerId, serverId, tools)
  }
}

export function reorderMcpServers(state: AgentStoreState, orderedIds: readonly string[]): AgentStoreState {
  const orderById = new Map(orderedIds.map((id, index) => [id, index]))
  return {
    ...state,
    mcpServers: sortMcpServers(
      state.mcpServers.map((server) => {
        const index = orderById.get(server.id)
        return index === undefined ? server : { ...server, sortOrder: index, updatedAt: nowIso() }
      })
    )
  }
}

export function upsertInstalledSkill(state: AgentStoreState, skill: InstalledSkill): AgentStoreState {
  const existingIndex = state.skills.findIndex((item) => item.id === skill.id)
  return {
    ...state,
    skills:
      existingIndex >= 0
        ? state.skills.map((item, index) => (index === existingIndex ? { ...skill, updatedAt: nowIso() } : item))
        : [{ ...skill, createdAt: skill.createdAt || nowIso(), updatedAt: skill.updatedAt || nowIso() }, ...state.skills]
  }
}

export function deleteInstalledSkill(state: AgentStoreState, skillId: string): AgentStoreState {
  return {
    ...state,
    skills: state.skills.filter((skill) => skill.id !== skillId),
    agentSkills: state.agentSkills.filter((binding) => binding.skillId !== skillId)
  }
}

export function setAgentSkillEnabled(
  state: AgentStoreState,
  agentId: string,
  skillId: string,
  isEnabled: boolean
): AgentStoreState {
  if (!state.agents.some((agent) => agent.id === agentId)) return state
  if (!state.skills.some((skill) => skill.id === skillId)) return state

  const binding: AgentSkillBinding = { agentId, skillId, isEnabled }
  const existingIndex = state.agentSkills.findIndex((item) => item.agentId === agentId && item.skillId === skillId)
  return {
    ...state,
    agentSkills:
      existingIndex >= 0
        ? state.agentSkills.map((item, index) => (index === existingIndex ? binding : item))
        : [...state.agentSkills, binding]
  }
}

export function createScheduledAgentTask(
  state: AgentStoreState,
  agentId: string,
  dto: CreateTaskDto
): AgentStoreState {
  const agent = state.agents.find((item) => item.id === agentId)
  if (!agent) return state
  if (!isAgentAutonomous(agent.configuration)) {
    throw new Error('Scheduled tasks require Soul Mode or Bypass Permissions mode.')
  }

  const createdAt = nowIso()
  const task: ScheduledTaskEntity = {
    id: createId('task'),
    agentId,
    name: dto.name,
    prompt: dto.prompt,
    trigger: dto.trigger,
    catchUpPolicy: dto.catchUpPolicy ?? { kind: 'skip-missed' },
    workspace: dto.workspace,
    timeoutMinutes: dto.timeoutMinutes ?? 2,
    channelIds: dto.channelIds ?? [],
    enabled: true,
    status: 'active',
    revision: 1,
    pauseReason: null,
    failureResetAt: null,
    provenance: { createdBy: 'user' },
    createdAt,
    updatedAt: createdAt
  }

  return {
    ...state,
    tasks: [task, ...state.tasks],
    channelTaskSubscriptions: replaceSubscriptionsForTask(state.channelTaskSubscriptions, task.id, task.channelIds ?? [])
  }
}

export function updateScheduledAgentTask(
  state: AgentStoreState,
  taskId: string,
  patch: UpdateTaskDto
): AgentStoreState {
  const task = state.tasks.find((item) => item.id === taskId)
  if (!task) return state
  if (task.status === 'completed') {
    throw new Error('Completed one-time scheduled tasks cannot be updated. Create a new task instead.')
  }

  const channelIds = patch.channelIds ?? task.channelIds ?? []
  const timeoutMinutes = patch.timeoutMinutes ?? task.timeoutMinutes
  const now = nowIso()
  const currentRevision = task.revision ?? 1
  return {
    ...state,
    tasks: state.tasks.map((item) =>
      item.id === taskId
        ? applyScheduledTaskPatch(item, patch, {
            now,
            timeoutMinutes,
            channelIds,
            nextRevision: currentRevision + 1
          })
        : item
    ),
    channelTaskSubscriptions:
      patch.channelIds === undefined
        ? state.channelTaskSubscriptions
        : replaceSubscriptionsForTask(state.channelTaskSubscriptions, taskId, channelIds)
  }
}

function applyScheduledTaskPatch(
  task: ScheduledTaskEntity,
  patch: UpdateTaskDto,
  input: {
    now: string
    timeoutMinutes: number
    channelIds: string[]
    nextRevision: number
  }
): ScheduledTaskEntity {
  const base: ScheduledTaskEntity = {
    ...task,
    ...patch,
    timeoutMinutes: input.timeoutMinutes,
    channelIds: input.channelIds,
    revision: input.nextRevision,
    updatedAt: input.now
  }

  if (patch.enabled === false) {
    return {
      ...base,
      enabled: false,
      status: 'paused',
      pauseReason: 'user'
    }
  }

  if (patch.enabled === true && task.status === 'paused') {
    return {
      ...base,
      enabled: true,
      status: 'active',
      pauseReason: null,
      failureResetAt: input.now
    }
  }

  return base
}

export function deleteScheduledAgentTask(state: AgentStoreState, taskId: string): AgentStoreState {
  return {
    ...state,
    tasks: state.tasks.filter((task) => task.id !== taskId),
    channelTaskSubscriptions: state.channelTaskSubscriptions.filter((subscription) => subscription.taskId !== taskId)
  }
}

export function replaceTaskChannelSubscriptions(
  state: AgentStoreState,
  taskId: string,
  channelIds: string[]
): AgentStoreState {
  return {
    ...state,
    tasks: state.tasks.map((task) => (task.id === taskId ? { ...task, channelIds, updatedAt: nowIso() } : task)),
    channelTaskSubscriptions: replaceSubscriptionsForTask(state.channelTaskSubscriptions, taskId, channelIds)
  }
}

export function addTaskRunLog(state: AgentStoreState, log: TaskRunLogEntity): AgentStoreState {
  return {
    ...state,
    taskRunLogs: [log, ...state.taskRunLogs]
  }
}

function sortMcpServers(servers: readonly McpServerEntity[]): McpServerEntity[] {
  return [...servers].sort((a, b) => {
    const order = (a.sortOrder ?? 0) - (b.sortOrder ?? 0)
    return order === 0 ? a.name.localeCompare(b.name) : order
  })
}

function isAgentAutonomous(configuration: AgentStoreState['agents'][number]['configuration']): boolean {
  return isSoulModeEnabled(configuration) || normalizePermissionMode(configuration?.permission_mode) === 'bypassPermissions'
}

function replaceSubscriptionsForTask(
  current: readonly AgentChannelTaskSubscription[],
  taskId: string,
  channelIds: readonly string[]
): AgentChannelTaskSubscription[] {
  return [
    ...current.filter((subscription) => subscription.taskId !== taskId),
    ...channelIds.map((channelId) => ({ channelId, taskId }))
  ]
}

function nowIso(): string {
  return new Date().toISOString()
}

function createId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}
