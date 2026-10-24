import type {
  AgentSessionEntity,
  AgentSessionMessagesListQuery,
  AgentSessionMessageEntity,
  CreateAgentSessionDto,
  DeleteAgentSessionsResult,
  ListAgentSessionsQuery,
  UpdateAgentSessionDto
} from '@platform/ai/agent-platform/schemas/sessionSchemas'
import type {
  AgentEntity,
  AgentPermissionMode,
  CreateAgentDto,
  UpdateAgentDto
} from '@platform/ai/agent-platform/schemas/agentSchemas'
import type { AgentSessionWorkspaceSource } from '@platform/ai/agent-platform/schemas/workspaceSchemas'
import type { AgentStoreState } from '@platform/ai/agent-platform/store/agentStore'
import type { AgentSaveIntent } from '@platform/ai/agent-platform/agents/agentConfigDescriptor'
import type { AgentChannelRuntimeSnapshot } from '@platform/ai/agent-platform/channels/channelRuntimeSnapshot'
import type { AgentSessionRuntimeSnapshot } from '@platform/ai/agent-platform/runtime/runtimeTypes'

export async function selectSessionViaApi(platform: Window['platform'], sessionId: string): Promise<AgentStoreState> {
  return (await platform.agents.selectSession(sessionId)) as AgentStoreState
}

export async function getAgentRuntimeSnapshotViaApi(platform: Window['platform']): Promise<AgentSessionRuntimeSnapshot> {
  return (await platform.agents.getRuntimeSnapshot()) as AgentSessionRuntimeSnapshot
}

export async function getAgentChannelRuntimeSnapshotViaApi(
  platform: Window['platform']
): Promise<AgentChannelRuntimeSnapshot> {
  return (await platform.agents.getChannelRuntimeSnapshot({ includeDiagnostics: true })) as AgentChannelRuntimeSnapshot
}

export async function restartAgentChannelRuntimeViaApi(
  platform: Window['platform'],
  channelId: string
): Promise<AgentChannelRuntimeSnapshot> {
  return (await platform.agents.restartChannelRuntime(channelId)) as AgentChannelRuntimeSnapshot
}

export async function selectAgentViaApi(platform: Window['platform'], agentId: string): Promise<AgentStoreState> {
  return (await platform.agents.selectAgent(agentId)) as AgentStoreState
}

export async function createAgentViaApi(platform: Window['platform'], input: CreateAgentDto): Promise<AgentEntity> {
  return (await platform.agents.createAgent(input)) as AgentEntity
}

export async function createSessionViaApi(
  platform: Window['platform'],
  input: CreateAgentSessionDto
): Promise<AgentSessionEntity> {
  return (await platform.agents.createSession(input)) as AgentSessionEntity
}

export async function listSessionMessagesViaApi(
  platform: Window['platform'],
  sessionId: string,
  query: AgentSessionMessagesListQuery = {}
): Promise<{ items: AgentSessionMessageEntity[]; nextCursor?: string }> {
  return (await platform.agents.listSessionMessages(sessionId, query)) as {
    items: AgentSessionMessageEntity[]
    nextCursor?: string
  }
}

export async function updateSessionViaApi(
  platform: Window['platform'],
  sessionId: string,
  patch: UpdateAgentSessionDto
): Promise<AgentSessionEntity> {
  return (await platform.agents.updateSession(sessionId, patch)) as AgentSessionEntity
}

export async function setAgentViaApi(
  platform: Window['platform'],
  agentId: string,
  patch: UpdateAgentDto
): Promise<AgentEntity> {
  return (await platform.agents.updateAgent(agentId, patch)) as AgentEntity
}

export async function deleteAgentViaApi(platform: Window['platform'], agentId: string): Promise<AgentStoreState> {
  return (await platform.agents.deleteAgent(agentId)) as AgentStoreState
}

export async function reorderAgentsViaApi(
  platform: Window['platform'],
  orderedAgentIds: string[]
): Promise<AgentStoreState> {
  return (await platform.agents.reorderAgents(orderedAgentIds)) as AgentStoreState
}

export async function deleteSessionsViaApi(
  platform: Window['platform'],
  sessionIds: string[]
): Promise<DeleteAgentSessionsResult> {
  return (await platform.agents.deleteSessions(sessionIds)) as DeleteAgentSessionsResult
}

export async function reorderSessionsViaApi(
  platform: Window['platform'],
  orderedSessionIds: string[]
): Promise<AgentStoreState> {
  return (await platform.agents.reorderSessions(orderedSessionIds)) as AgentStoreState
}

export async function setSessionAgentViaApi(
  platform: Window['platform'],
  sessionId: string,
  agentId: string | null
): Promise<AgentSessionEntity> {
  return (await platform.agents.setSessionAgent(sessionId, agentId)) as AgentSessionEntity
}

export async function setSessionWorkspaceViaApi(
  platform: Window['platform'],
  sessionId: string,
  source: AgentSessionWorkspaceSource
): Promise<AgentSessionEntity> {
  return (await platform.agents.setSessionWorkspace(sessionId, source)) as AgentSessionEntity
}

export async function setSessionWorkspaceByPathViaApi(
  platform: Window['platform'],
  sessionId: string,
  path: string
): Promise<AgentSessionEntity> {
  return (await platform.agents.setSessionWorkspaceByPath(sessionId, path)) as AgentSessionEntity
}

export async function setAgentModelViaApi(
  platform: Window['platform'],
  agentId: string,
  model: string
): Promise<AgentEntity> {
  return setAgentViaApi(platform, agentId, { model })
}

export async function setAgentToolEnabledViaApi(
  platform: Window['platform'],
  agent: Pick<AgentEntity, 'id' | 'disabledTools'>,
  toolId: string,
  enabled: boolean
): Promise<AgentEntity> {
  const disabledTools = new Set(agent.disabledTools ?? [])
  if (enabled) disabledTools.delete(toolId)
  else disabledTools.add(toolId)
  return setAgentViaApi(platform, agent.id, { disabledTools: [...disabledTools] })
}

export async function setAgentPermissionModeViaApi(
  platform: Window['platform'],
  agent: AgentEntity,
  permissionMode: AgentPermissionMode
): Promise<AgentEntity> {
  return setAgentViaApi(platform, agent.id, {
    configuration: {
      ...agent.configuration,
      permission_mode: permissionMode
    }
  })
}

export async function setAgentSoulModeViaApi(
  platform: Window['platform'],
  agent: AgentEntity,
  enabled: boolean
): Promise<AgentEntity> {
  const currentMode = agent.configuration?.permission_mode ?? 'default'
  return setAgentViaApi(platform, agent.id, {
    configuration: {
      ...agent.configuration,
      soul_enabled: enabled,
      permission_mode: enabled ? 'bypassPermissions' : currentMode === 'bypassPermissions' ? 'default' : currentMode
    }
  })
}

export async function setAgentHeartbeatEnabledViaApi(
  platform: Window['platform'],
  agent: AgentEntity,
  enabled: boolean
): Promise<AgentEntity> {
  return setAgentViaApi(platform, agent.id, {
    configuration: {
      ...agent.configuration,
      heartbeat_enabled: enabled
    }
  })
}

export async function switchSessionPinStateViaApi(platform: Window['platform'], sessionId: string): Promise<AgentStoreState> {
  return (await platform.agents.switchSessionPinState(sessionId)) as AgentStoreState
}

export async function clearSessionMessagesViaApi(platform: Window['platform'], sessionId: string): Promise<AgentStoreState> {
  return (await platform.agents.clearSessionMessages(sessionId)) as AgentStoreState
}

export async function executeRuntimeCommandViaApi(
  platform: Window['platform'],
  input: { command: '/context' | '/cost' | '/todos'; agentId: string; sessionId: string }
): Promise<{ state: AgentStoreState }> {
  return (await platform.agents.executeRuntimeCommand(input)) as { state: AgentStoreState }
}

export async function deleteSessionMessageViaApi(
  platform: Window['platform'],
  sessionId: string,
  messageId: string
): Promise<AgentStoreState> {
  return (await platform.agents.deleteSessionMessage(sessionId, messageId)) as AgentStoreState
}

export async function cancelSessionViaApi(platform: Window['platform'], sessionId: string): Promise<boolean> {
  return (await platform.agents.cancelSession(sessionId)) as boolean
}

export async function saveAgentConfigViaApi(
  platform: Window['platform'],
  intent: AgentSaveIntent,
  editingAgentId: string | null
): Promise<AgentStoreState> {
  if (intent.kind === 'create') {
    const created = await createAgentViaApi(platform, intent.payload)
    await createSessionViaApi(platform, {
      agentId: created.id,
      name: intent.payload.name,
      workspace: { type: 'system' }
    })
    return (await platform.agents.getState()) as AgentStoreState
  }

  if (!editingAgentId) {
    throw new Error('editingAgentId is required when saving an existing agent.')
  }

  await setAgentViaApi(platform, editingAgentId, intent.payload)
  return (await platform.agents.getState()) as AgentStoreState
}
