import type { AgentEffort, AgentPermissionMode, UniqueModelId } from '@platform/ai/agent-platform/schemas/agentSchemas'
import type { AgentSaveIntent } from '@platform/ai/agent-platform/agents/agentConfigDescriptor'
import type { AgentSessionWorkspaceSource } from '@platform/ai/agent-platform/schemas/workspaceSchemas'
import {
  clearAgentSessionMessages,
  createAgent,
  createAgentSession,
  deleteAgent,
  deleteAgentSession,
  deleteAgentSessionMessage,
  deleteAgentSessions,
  reorderAgentSessions,
  selectAgent as selectAgentInStore,
  selectAgentSession,
  toggleSessionPin,
  updateAgent,
  updateAgentSession,
  updateAgentSessionAgent,
  updateAgentSessionWorkspace,
  upsertAgentWorkspace,
  type AgentStoreState
} from '@platform/ai/agent-platform/store/agentStore'

import { getCreateSessionFallbackAgentId } from './agentSessionViewModel'

export function createDefaultAgentSession(
  state: AgentStoreState,
  name: string,
  explicitAgentId?: string | null
): AgentStoreState {
  const agentId =
    explicitAgentId ??
    getCreateSessionFallbackAgentId(state.sessions, state.activeSessionId, state.activeAgentId ?? state.agents[0]?.id ?? null)
  if (!agentId) return state
  return createAgentSession(state, {
    agentId,
    name,
    workspace: { type: 'system' }
  })
}

export function selectSession(state: AgentStoreState, sessionId: string): AgentStoreState {
  return selectAgentSession(state, sessionId)
}

export function selectAgentById(state: AgentStoreState, agentId: string): AgentStoreState {
  return selectAgentInStore(state, agentId)
}

export function renameSession(state: AgentStoreState, sessionId: string, name: string): AgentStoreState {
  const nextName = name.trim()
  if (!nextName) return state
  return updateAgentSession(state, sessionId, { name: nextName })
}

export function deleteSession(state: AgentStoreState, sessionId: string): AgentStoreState {
  return deleteAgentSession(state, sessionId)
}

export function deleteSessions(state: AgentStoreState, sessionIds: readonly string[]): AgentStoreState {
  return deleteAgentSessions(state, sessionIds)
}

export function reorderSessions(state: AgentStoreState, orderedSessionIds: readonly string[]): AgentStoreState {
  return reorderAgentSessions(state, orderedSessionIds)
}

export function toggleSessionPinned(state: AgentStoreState, sessionId: string): AgentStoreState {
  return toggleSessionPin(state, sessionId)
}

export function bindSessionAgent(state: AgentStoreState, sessionId: string, agentId: string | null): AgentStoreState {
  return updateAgentSessionAgent(state, sessionId, agentId)
}

export function setSessionWorkspace(
  state: AgentStoreState,
  sessionId: string,
  workspace: AgentSessionWorkspaceSource
): AgentStoreState {
  return updateAgentSessionWorkspace(state, sessionId, workspace)
}

export function addWorkspaceAndSetSession(state: AgentStoreState, sessionId: string, path: string): AgentStoreState {
  const withWorkspace = upsertAgentWorkspace(state, { path })
  const workspace = withWorkspace.workspaces.find((item) => item.path === path.trim())
  if (!workspace) return withWorkspace
  return updateAgentSessionWorkspace(withWorkspace, sessionId, { type: 'user', workspaceId: workspace.id })
}

export function setAgentModel(state: AgentStoreState, agentId: string, model: UniqueModelId): AgentStoreState {
  return updateAgent(state, agentId, { model })
}

export function setAgentEffort(state: AgentStoreState, agentId: string, effort: AgentEffort): AgentStoreState {
  const agent = state.agents.find((item) => item.id === agentId)
  if (!agent) return state
  return updateAgent(state, agentId, { configuration: { ...agent.configuration, effort } })
}

export function saveAgentConfig(
  state: AgentStoreState,
  intent: AgentSaveIntent,
  editingAgentId: string | null
): AgentStoreState {
  if (intent.kind === 'create') {
    const withAgent = createAgent(state, intent.payload)
    const createdAgentId = withAgent.activeAgentId
    if (!createdAgentId) return withAgent
    return createAgentSession(withAgent, {
      agentId: createdAgentId,
      name: intent.payload.name,
      workspace: { type: 'system' }
    })
  }
  if (!editingAgentId) return state
  return updateAgent(state, editingAgentId, intent.payload)
}

export function deleteAgentConfig(state: AgentStoreState, agentId: string): AgentStoreState {
  return deleteAgent(state, agentId)
}

export function setAgentPermissionMode(
  state: AgentStoreState,
  agentId: string,
  permissionMode: AgentPermissionMode
): AgentStoreState {
  const agent = state.agents.find((item) => item.id === agentId)
  if (!agent) return state
  return updateAgent(state, agentId, {
    configuration: {
      ...agent.configuration,
      permission_mode: permissionMode
    }
  })
}

export function setAgentSoulMode(state: AgentStoreState, agentId: string, enabled: boolean): AgentStoreState {
  const agent = state.agents.find((item) => item.id === agentId)
  if (!agent) return state
  const currentMode = agent.configuration?.permission_mode ?? 'default'
  return updateAgent(state, agentId, {
    configuration: {
      ...agent.configuration,
      soul_enabled: enabled,
      permission_mode: enabled ? 'bypassPermissions' : currentMode === 'bypassPermissions' ? 'default' : currentMode
    }
  })
}

export function setAgentHeartbeatEnabled(state: AgentStoreState, agentId: string, enabled: boolean): AgentStoreState {
  const agent = state.agents.find((item) => item.id === agentId)
  if (!agent) return state
  return updateAgent(state, agentId, {
    configuration: {
      ...agent.configuration,
      heartbeat_enabled: enabled
    }
  })
}

export function setAgentToolEnabled(
  state: AgentStoreState,
  agentId: string,
  toolId: string,
  enabled: boolean
): AgentStoreState {
  const agent = state.agents.find((item) => item.id === agentId)
  if (!agent) return state
  const disabledTools = new Set(agent.disabledTools ?? [])
  if (enabled) disabledTools.delete(toolId)
  else disabledTools.add(toolId)
  return updateAgent(state, agentId, { disabledTools: [...disabledTools] })
}

export function clearSessionMessages(state: AgentStoreState, sessionId: string): AgentStoreState {
  return clearAgentSessionMessages(state, sessionId)
}

export function deleteSessionMessage(state: AgentStoreState, sessionId: string, messageId: string): AgentStoreState {
  return deleteAgentSessionMessage(state, sessionId, messageId)
}
