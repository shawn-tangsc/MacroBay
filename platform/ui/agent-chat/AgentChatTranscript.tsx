import { useEffect, useRef, type ReactNode } from 'react'

import type { AgentSessionMessageEntity, MessageStatus } from '@platform/ai/agent-platform/schemas/sessionSchemas'

import ChatMarkdownText from '../markdown/ChatMarkdownText'
import { AgentChatBubble } from './AgentChatBubble'
import { sortAgentSessionMessages } from './agentMessageGroups'

export type AgentChatTranscriptProps = {
  messages: readonly AgentSessionMessageEntity[]
  ariaLabel: string
  emptyLabel?: string
  statusLabels?: Partial<Record<MessageStatus, string>>
  /** Product-specific rendering (tool blocks, attachments); defaults to markdown text. */
  renderMessage?: (message: AgentSessionMessageEntity) => ReactNode
  className?: string
}

/**
 * Scrollable conversation log. It scrolls to the newest message whenever the count changes, so
 * both the full agent page and the compact intelligence panel get the same behaviour.
 */
export function AgentChatTranscript({
  messages,
  ariaLabel,
  emptyLabel,
  statusLabels,
  renderMessage,
  className
}: AgentChatTranscriptProps): React.ReactElement {
  const container = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const node = container.current
    if (node) node.scrollTop = node.scrollHeight
  }, [messages.length])

  return (
    <div
      ref={container}
      className={['agent-chat-transcript', className].filter(Boolean).join(' ')}
      role="log"
      aria-live="polite"
      aria-label={ariaLabel}>
      {messages.length === 0 && emptyLabel ? (
        <p className="agent-chat-transcript__empty">{emptyLabel}</p>
      ) : null}
      {sortAgentSessionMessages(messages).map((message) =>
        renderMessage ? (
          <MessageSlot key={message.id}>{renderMessage(message)}</MessageSlot>
        ) : (
          <AgentChatBubble
            key={message.id}
            role={message.role}
            statusLabel={message.status === 'success' ? null : statusLabels?.[message.status]}>
            <ChatMarkdownText text={message.searchableText} />
          </AgentChatBubble>
        )
      )}
    </div>
  )
}

function MessageSlot({ children }: { children: ReactNode }): React.ReactElement {
  return <>{children}</>
}
