import { useState } from 'react'
import { Button, Popconfirm, Popover } from 'antd'
import { Check, History, Plus, Trash2 } from 'lucide-react'

import type { AgentSessionEntity } from '@platform/ai/agent-platform/schemas/sessionSchemas'
import { displaySessionName } from '@platform/ai/agent-platform/schemas/sessionDisplayName'
import { IconButton } from '@platform/ui/components/icon-button'
import { STATE_VIEW_ACTION_KEYS, StateView } from '@platform/ui/components/state'
import { Tooltip } from '@platform/ui/components/tooltip'

import { useProductTextKey } from '../../shared/i18n/productTextKey'

export type MarketAnalysisSessionMenuText = Readonly<{
  newChat: string
  history: string
  delete: string
  deleteConfirm: string
  cancel: string
  /** 会话名读不出来（为空，或存的就是它自己的 id）时的中性名字；**任何路径不回落 id**。 */
  untitledSession: string
}>

export function MarketAnalysisSessionMenu({
  sessions,
  historyState = 'ready',
  currentSessionId,
  text,
  onNewConversation,
  onSelectConversation,
  onDeleteConversation
}: Readonly<{
  sessions: readonly AgentSessionEntity[]
  /**
   * 会话历史的读取状态。未结算/读失败时**不画空态**——「还没读到」和「确实没有」是两件事，
   * 前者的正确说法是「加载中」，而它已经在同一屏的标题旁写着。缺省按已结算处理（老调用点不变）。
   */
  historyState?: 'loading' | 'ready' | 'failed'
  currentSessionId?: string
  text: MarketAnalysisSessionMenuText
  onNewConversation: () => void
  onSelectConversation: (sessionId: string) => void
  onDeleteConversation: (sessionId: string) => void
}>): React.ReactElement {
  const [open, setOpen] = useState(false)
  const resolveProductText = useProductTextKey()
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
      {historyState !== 'ready'
        // 未结算或读失败：什么都不画，绝不断言「你从没有过会话」。
        ? null
        : sessions.length === 0
        ? <StateView
          action={{ labelKey: STATE_VIEW_ACTION_KEYS.create, onSelect: startNewConversation }}
          productReason={{ key: 'pages.intelligence.portal.analysisWorkspace.noSessions', resolve: resolveProductText }}
          reasonCode="never-created"
          size="md"
          state="empty" />
        : sessions.map(session => (
          <div className={`mi-agent-sessions__row${session.id === currentSessionId ? ' is-current' : ''}`} key={session.id}>
            <button
              aria-current={session.id === currentSessionId ? 'true' : undefined}
              className="mi-agent-sessions__select"
              type="button"
              onClick={() => selectConversation(session.id)}>
              {/* 老自动会话把运行 id 当名字存了下来；名字读不出来时给中性文案，绝不印编号。
                  选中态另给 `aria-current`：勾是 aria-hidden，读屏靠它知道哪一行是当前会话。 */}
              <span className="mi-agent-sessions__name">{displaySessionName(session) ?? text.untitledSession}</span>
              <span className="mi-agent-sessions__time">{formatSessionTime(session.updatedAt)}</span>
              {session.id === currentSessionId ? <Check aria-hidden="true" size={13} /> : null}
            </button>
            <Popconfirm
              title={text.deleteConfirm}
              okText={text.delete}
              cancelText={text.cancel}
              onConfirm={() => onDeleteConversation(session.id)}>
              {/* Stays an antd button: it is the trigger of a confirmation popover, and the
                  shared icon button cannot receive the click that popover injects. Swapping it
                  would delete without asking. */}
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
      <Tooltip labelKey="pages.intelligence.portal.analysisWorkspace.newChatAction" resolveText={resolveProductText}>
        <IconButton
          ariaLabelKey="pages.intelligence.portal.analysisWorkspace.newChatAction"
          icon={Plus}
          onSelect={startNewConversation}
          resolveText={resolveProductText}
          size="md"
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
