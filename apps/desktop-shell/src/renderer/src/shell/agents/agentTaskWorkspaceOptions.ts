import type { AgentSessionWorkspaceSource, AgentWorkspaceEntity } from '@platform/ai/agent-platform/schemas/workspaceSchemas'

import type { AgentText } from './agentText'

export type AgentTaskWorkspaceOption = {
  value: string
  label: string
  workspace: AgentSessionWorkspaceSource
}

export function buildTaskWorkspaceOptions(
  workspaces: readonly AgentWorkspaceEntity[],
  labels: Pick<AgentText['taskCenter'], 'systemWorkspace'>
): AgentTaskWorkspaceOption[] {
  return [
    { value: '__system__', label: labels.systemWorkspace, workspace: { type: 'system' } },
    ...workspaces
      .filter((workspace) => workspace.type === 'user')
      .map((workspace) => ({
        value: workspace.id,
        label: workspace.name || workspace.path || workspace.id,
        workspace: { type: 'user', workspaceId: workspace.id } as AgentSessionWorkspaceSource
      }))
  ]
}
