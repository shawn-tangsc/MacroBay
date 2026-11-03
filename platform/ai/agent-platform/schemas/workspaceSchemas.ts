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

/** 频道设置页能选的工作区：只给读者要的三样（名字用于下拉，id 用于落库）。 */
export type AgentWorkspaceChoice = {
  id: string
  name: string
  path: string
}

/**
 * 「按路径取一个工作区，没有就先登记一条」的结果。
 *
 * 为什么不让渲染层自己拼：频道的 `workspace` 存的是工作区**编号**，不存路径；
 * 路径 → 编号的唯一实现必须在主进程（`AgentWorkspaceService.findOrCreateByPathResult`）。
 */
export type AgentWorkspaceEnsureResult =
  | { ok: true; workspace: AgentWorkspaceChoice }
  | { ok: false; code: 'workspace-path-invalid' | 'workspace-unavailable' }
