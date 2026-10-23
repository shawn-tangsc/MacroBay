import { Button, Tooltip } from 'antd'
import { MoreHorizontal } from 'lucide-react'

import type { AgentEntity } from '@platform/ai/agent-platform/schemas/agentSchemas'

import { getAgentAvatar } from '../agentUiTypes'
import { useAgentText } from '../agentTextProvider'

type AgentRosterProps = {
  agents: AgentEntity[]
  activeAgentId: string | null
  sessionCountByAgentId: Record<string, number>
  onSelectAgent: (agentId: string) => void
  onEditAgent: (agentId: string) => void
}

export default function AgentRoster({
  agents,
  activeAgentId,
  sessionCountByAgentId,
  onSelectAgent,
  onEditAgent
}: AgentRosterProps): React.ReactElement {
  const t = useAgentText()

  return (
    <section className="agent-roster">
      <div className="agent-roster-list">
        {agents.length === 0 ? <p className="agent-empty-copy">{t.sidePanel.emptyAgents}</p> : null}
        {agents.map((agent) => (
          <div key={agent.id} className={agent.id === activeAgentId ? 'agent-roster-item active' : 'agent-roster-item'}>
            <button
              type="button"
              className="agent-roster-main"
              onClick={() => onSelectAgent(agent.id)}>
              <span className="agent-roster-avatar">{getAgentAvatar(agent)}</span>
              <span className="agent-roster-copy">
                <strong>{agent.name}</strong>
                <small>{t.sidePanel.agentSessionCount(sessionCountByAgentId[agent.id] ?? 0)}</small>
              </span>
            </button>
            <Tooltip title={t.navbar.agentSettings}>
              <Button
                className="agent-roster-more"
                type="text"
                size="small"
                icon={<MoreHorizontal size={14} />}
                aria-label={t.navbar.agentSettings}
                onClick={() => onEditAgent(agent.id)}
              />
            </Tooltip>
          </div>
        ))}
      </div>
    </section>
  )
}
