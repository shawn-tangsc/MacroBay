import type { AgentEntity } from '@platform/ai/agent-platform/schemas/agentSchemas'
import type { AgentPermissionMode } from '@platform/ai/agent-platform/schemas/agentSchemas'
import type { AgentSessionEntity } from '@platform/ai/agent-platform/schemas/sessionSchemas'
import type { AgentStoreState } from '@platform/ai/agent-platform/store/agentStore'

import type { AgentText } from './agentText'
import { agentText } from './agentText'

export type AgentWorkspaceProps = {
  state: AgentStoreState
  onStateChange: (updater: (state: AgentStoreState) => AgentStoreState) => void
}

export type AgentEditorMode =
  | {
      type: 'closed'
    }
  | {
      type: 'edit'
      agentId: string
    }
  | {
      type: 'create'
    }

export function getAgentAvatar(agent: AgentEntity | null | undefined): string {
  const avatar = agent?.configuration?.avatar
  return typeof avatar === 'string' && avatar.trim() ? avatar : '🤖'
}

export function getAgentPermissionModeLabel(
  agent: AgentEntity | null | undefined,
  labels: Record<AgentPermissionMode, string> = agentText['zh-CN'].permissionMode
): string {
  switch (agent?.configuration?.permission_mode) {
    case 'plan':
      return labels.plan
    case 'acceptEdits':
      return labels.acceptEdits
    case 'bypassPermissions':
      return labels.bypassPermissions
    default:
      return labels.default
  }
}

export function getSessionDescription(
  session: AgentSessionEntity | null | undefined,
  text: Pick<AgentText['common'], 'noDescription'> = agentText['zh-CN'].common
): string {
  return session?.description || text.noDescription
}
