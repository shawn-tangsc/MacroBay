export const agentWorkspaceTypes = ['user', 'system'] as const
export type AgentWorkspaceType = (typeof agentWorkspaceTypes)[number]

export const AGENT_WORKSPACE_TYPE = {
  USER: 'user',
  SYSTEM: 'system'
} as const satisfies Record<string, AgentWorkspaceType>

export const DEFAULT_SYSTEM_WORKSPACE_PATH = '/tmp/agent-system-workspace'

export type AgentSessionWorkspaceSource =
  | {
      type: 'user'
      workspaceId: string
    }
  | {
      type: 'system'
    }

export type AgentWorkspaceEntity = {
  id: string
  name: string
  path: string
  type: AgentWorkspaceType
  orderKey: string
  createdAt: string
  updatedAt: string
}

export type CreateAgentWorkspaceDto = {
  path: string
  name?: string
}

export type UpdateAgentWorkspaceDto = {
  name: string
}
