import type { AgentEntity } from '../../schemas/agentSchemas'
import type { AgentSessionEntity } from '../../schemas/sessionSchemas'
import type { AgentSessionWorkspaceSource, AgentWorkspaceEntity } from '../../schemas/workspaceSchemas'

export const HEARTBEAT_TASK_NAME = 'heartbeat'
export const HEARTBEAT_PROMPT_SENTINEL = '__heartbeat__'
export const HEARTBEAT_CIRCUIT_BREAKER_FAILURES = 3

export function isHeartbeatEnabled(agent: AgentEntity): boolean {
  return agent.configuration?.heartbeat_enabled !== false
}

export function getHeartbeatIntervalMs(agent: AgentEntity): number | null {
  const raw = agent.configuration?.heartbeat_interval
  const minutes = typeof raw === 'number' && Number.isFinite(raw) && raw > 0 ? raw : 30
  if (minutes <= 0) return null
  return minutes * 60_000
}

export function getHeartbeatTaskId(agentId: string, workspaceId: string): string {
  return `heartbeat:${agentId}:${workspaceId}`
}

export function selectHeartbeatSession(
  sessions: readonly AgentSessionEntity[],
  workspacesById: ReadonlyMap<string, AgentWorkspaceEntity>,
  agentId: string
): AgentSessionEntity | null {
  const candidates = sessions
    .filter((session) => session.agentId === agentId)
    .filter((session) => workspacesById.get(session.workspaceId)?.type === 'user')
    .sort((a, b) => {
      const updatedDelta = Date.parse(b.updatedAt) - Date.parse(a.updatedAt)
      if (updatedDelta !== 0) return updatedDelta
      const createdDelta = Date.parse(b.createdAt) - Date.parse(a.createdAt)
      if (createdDelta !== 0) return createdDelta
      return a.id.localeCompare(b.id)
    })
  return candidates[0] ?? null
}

export function buildHeartbeatPrompt(content: string): string {
  return [
    '[Heartbeat]',
    'This is a periodic heartbeat. The instructions below are from your heartbeat.md file.',
    'Process each item, take action where possible, and use the notify tool to alert the user of important results.',
    '',
    '---',
    content.trim()
  ].join('\n')
}

export function isUserWorkspaceSource(
  workspace: AgentSessionWorkspaceSource
): workspace is Extract<AgentSessionWorkspaceSource, { type: 'user' }> {
  return workspace.type === 'user'
}
