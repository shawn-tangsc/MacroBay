import { useState } from 'react'
import { Button, Popconfirm, Popover, Tooltip } from 'antd'
import { Check, History, Plus, Trash2 } from 'lucide-react'

import type { AgentSessionEntity } from '@platform/ai/agent-platform/schemas/sessionSchemas'

export type MarketAnalysisSessionMenuText = Readonly<{
  newChat: string
  history: string
  delete: string
  deleteConfirm: string
  cancel: string
  empty: string
}>

export function MarketAnalysisSessionMenu({
  sessions,
  currentSessionId,
  text,
  onNewConversation,
  onSelectConversation,
  onDeleteConversation
}: Readonly<{
  sessions: readonly AgentSessionEntity[]
  currentSessionId?: string
  text: MarketAnalysisSessionMenuText
  onNewConversation: () => void
  onSelectConversation: (sessionId: string) => void
  onDeleteConversation: (sessionId: string) => void
}>): React.ReactElement {
  const [open, setOpen] = useState(false)
  const selectConversation = (sessionId: string): void => {
    setOpen(false)
    onSelectConversation(sessionId)
  }
  const startNewConversation = (): void => {
    setOpen(false)
    onNewConversation()
  }
  const menu = (
    <div className="mi-agent-sessions">
      <div className="mi-agent-sessions__heading">{text.history}</div>
      {sessions.length === 0
        ? <p className="mi-agent-sessions__empty">{text.empty}</p>
        : sessions.map(session => (
          <div className={`mi-agent-sessions__row${session.id === currentSessionId ? ' is-current' : ''}`} key={session.id}>
            <button
              className="mi-agent-sessions__select"
              type="button"
              onClick={() => selectConversation(session.id)}>
              <span className="mi-agent-sessions__name">{session.name || text.history}</span>
              <span className="mi-agent-sessions__time">{formatSessionTime(session.updatedAt)}</span>
              {session.id === currentSessionId ? <Check aria-hidden="true" size={13} /> : null}
            </button>
            <Popconfirm
              title={text.deleteConfirm}
              okText={text.delete}
              cancelText={text.cancel}
              onConfirm={() => onDeleteConversation(session.id)}>
              <Button
                aria-label={text.delete}
                danger
                icon={<Trash2 aria-hidden="true" size={13} />}
                size="small"
                type="text"
              />
            </Popconfirm>
          </div>
        ))}
    </div>
  )

  return (
    <div className="mi-analysis-chat__session-actions">
      <Tooltip title={text.newChat}>
        <Button
          aria-label={text.newChat}
          data-agent-new-conversation
          icon={<Plus aria-hidden="true" size={15} />}
          onClick={startNewConversation}
          size="small"
          type="text"
        />
      </Tooltip>
      <Popover content={menu} open={open} onOpenChange={setOpen} placement="bottomRight" trigger="click">
        <Button aria-label={text.history} icon={<History aria-hidden="true" size={15} />} size="small" type="text">
          {text.history}
        </Button>
      </Popover>
    </div>
  )
}

function formatSessionTime(updatedAt: string): string {
  const date = new Date(updatedAt)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat(undefined, {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date)
}
