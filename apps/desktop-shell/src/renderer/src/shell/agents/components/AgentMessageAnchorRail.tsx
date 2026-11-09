import { ChevronDown } from 'lucide-react'

import { IconButton } from '@platform/ui/components/icon-button'

import type { AgentMessageAnchorItem } from '../agentMessageNavigation'

/** 底部「回到底部」的读屏名：句子由调用方给，键只回答「这是哪个按钮」。 */
const BOTTOM_KEY = 'agent.messages.navigateBottom'

type AgentMessageAnchorRailProps = {
  items: readonly AgentMessageAnchorItem[]
  activeMessageId: string | null
  onSelectMessage: (messageId: string) => void
  onBottom: () => void
  bottomActive: boolean
  ariaLabel: string
  /** 「回到底部」的句子。原来这个按钮**没有读屏名**，键盘和读屏都拿不到它是什么。 */
  bottomLabel: string
}

export default function AgentMessageAnchorRail({
  items,
  activeMessageId,
  onSelectMessage,
  onBottom,
  bottomActive,
  ariaLabel,
  bottomLabel
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
              // 整行一个结果：跳到这条消息。行内没有独立按钮；`aria-current` 让读屏知道当前在哪一条。
              aria-current={active ? 'true' : undefined}
              onClick={() => onSelectMessage(item.id)}>
              <span className={`agent-message-anchor-dot ${item.role} ${item.status}`} />
              <span className="agent-message-anchor-copy">
                <strong>{item.title}</strong>
                <small>{item.preview}</small>
              </span>
            </button>
          )
        })}
        <IconButton
          ariaLabelKey={BOTTOM_KEY}
          icon={ChevronDown}
          size="sm"
          onSelect={onBottom}
          resolveText={(key) => (key === BOTTOM_KEY ? bottomLabel : '')}
        />
      </div>
    </aside>
  )
}
