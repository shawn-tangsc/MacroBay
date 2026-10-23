import type { ReactNode } from 'react'

import type { MessageRole } from '@platform/ai/agent-platform/schemas/sessionSchemas'

export type AgentChatBubbleProps = {
  role: MessageRole
  children: ReactNode
  /** Small status line under the content (`处理中`, `错误`, ...). Omit for successful messages. */
  statusLabel?: string | null
  className?: string
}

/**
 * One message bubble. The role decides the side and tint — deliberately no role label, matching
 * the intelligence agent panel's design.
 */
export function AgentChatBubble({ role, children, statusLabel, className }: AgentChatBubbleProps): React.ReactElement {
  return (
    <article
      className={['agent-chat-bubble', className].filter(Boolean).join(' ')}
      data-role={role}>
      {children}
      {statusLabel ? <small className="agent-chat-bubble__status">{statusLabel}</small> : null}
    </article>
  )
}
