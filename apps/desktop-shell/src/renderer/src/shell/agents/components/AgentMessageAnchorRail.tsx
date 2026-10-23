import { ChevronDown } from 'lucide-react'

import type { AgentMessageAnchorItem } from '../agentMessageNavigation'

type AgentMessageAnchorRailProps = {
  items: readonly AgentMessageAnchorItem[]
  activeMessageId: string | null
  onSelectMessage: (messageId: string) => void
  onBottom: () => void
  bottomActive: boolean
  ariaLabel: string
}

export default function AgentMessageAnchorRail({
  items,
  activeMessageId,
  onSelectMessage,
  onBottom,
  bottomActive,
  ariaLabel
}: AgentMessageAnchorRailProps): React.ReactElement | null {
  if (items.length === 0) return null

  return (
    <aside className="agent-message-anchor-rail" aria-label={ariaLabel}>
      <div className="agent-message-anchor-list">
        {items.map((item) => {
          const active = item.id === activeMessageId
          return (
            <button
              key={item.id}
              type="button"
              className={active ? 'agent-message-anchor-item active' : 'agent-message-anchor-item'}
              onClick={() => onSelectMessage(item.id)}>
              <span className={`agent-message-anchor-dot ${item.role} ${item.status}`} />
              <span className="agent-message-anchor-copy">
                <strong>{item.title}</strong>
                <small>{item.preview}</small>
              </span>
            </button>
          )
        })}
        <button
          type="button"
          className={bottomActive ? 'agent-message-anchor-bottom active' : 'agent-message-anchor-bottom'}
          onClick={onBottom}>
          <ChevronDown size={14} />
        </button>
      </div>
    </aside>
  )
}
