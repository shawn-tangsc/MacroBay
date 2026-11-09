import { MoreHorizontal } from 'lucide-react'

import type { AgentEntity } from '@platform/ai/agent-platform/schemas/agentSchemas'

import { IconButton } from '@platform/ui/components/icon-button'

import { getAgentAvatar } from '../agentUiTypes'
import { useAgentText } from '../agentTextProvider'
import { resolveAgentTextKey, type AgentTooltipKey } from '../agentTooltipText'

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
  const tooltipKeys = { agentSettings: 'navbar.agentSettings' } as const satisfies Record<string, AgentTooltipKey>

  return (
    <section className="agent-roster">
      <div className="agent-roster-list">
        {agents.length === 0 ? <p className="agent-empty-copy">{t.sidePanel.emptyAgents}</p> : null}
        {agents.map((agent) => (
          <div key={agent.id} className={agent.id === activeAgentId ? 'agent-roster-item active' : 'agent-roster-item'}>
            <button
              type="button"
              className="agent-roster-main"
              // 行容器本身是非交互 `div`，主动作与「设置」各是独立按钮——正是判据要的形状。
              // 这里只补选中态：读屏能听出当前是哪个智能体（此前只有底色）。
              aria-current={agent.id === activeAgentId ? 'true' : undefined}
              onClick={() => onSelectAgent(agent.id)}>
              <span className="agent-roster-avatar">{getAgentAvatar(agent)}</span>
              <span className="agent-roster-copy">
                <strong>{agent.name}</strong>
                <small>{t.sidePanel.agentSessionCount(sessionCountByAgentId[agent.id] ?? 0)}</small>
              </span>
            </button>
            <IconButton
              ariaLabelKey="navbar.agentSettings"
              className="agent-roster-more"
              icon={MoreHorizontal}
              onSelect={() => onEditAgent(agent.id)}
              resolveText={(key) => resolveAgentTextKey(t, key)}
              size="md"
              tooltipKey={tooltipKeys.agentSettings}
            />
          </div>
        ))}
      </div>
    </section>
  )
}
