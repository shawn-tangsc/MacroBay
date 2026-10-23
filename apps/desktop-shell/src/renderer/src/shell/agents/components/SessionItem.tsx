import { useEffect, useRef, useState } from 'react'
import { Button, Dropdown, Input, Tooltip } from 'antd'
import type { MenuProps } from 'antd'
import { Edit3, MoreHorizontal, Pin, PinOff, Trash2, X } from 'lucide-react'

import type { AgentSessionEntity } from '@platform/ai/agent-platform/schemas/sessionSchemas'
import type { AgentStoreState } from '@platform/ai/agent-platform/store/agentStore'
import type { AgentSessionPanelPosition } from '@platform/settings/schema/appSettings'

import { deleteSession, renameSession, toggleSessionPinned } from '../agentStateActions'
import type { AgentSessionChannelRuntimeBadge } from '../agentChannelRuntimeViewModel'
import { deleteSessionsViaApi, switchSessionPinStateViaApi, updateSessionViaApi } from '../agentSessionDataApi'
import { getSessionDeleteClickIntent } from '../agentSessionDeleteInteraction'
import type { AgentSessionRuntimeStatus } from '../agentSessionViewModel'
import { getAgentChannelTypeIconUrl } from '../agentChannelVisuals'
import { useAgentText } from '../agentTextProvider'

type SessionItemProps = {
  session: AgentSessionEntity
  active: boolean
  pinned: boolean
  runtimeStatus: AgentSessionRuntimeStatus
  channelType?: string
  channelRuntime?: AgentSessionChannelRuntimeBadge
  sessionPanelPosition: AgentSessionPanelPosition
  dragging?: boolean
  dragOver?: boolean
  draggable?: boolean
  onDragStart?: (event: React.DragEvent<HTMLDivElement>) => void
  onDragOver?: (event: React.DragEvent<HTMLDivElement>) => void
  onDrop?: (event: React.DragEvent<HTMLDivElement>) => void
  onDragEnd?: () => void
  onUpdateSessionPanelPosition: (position: AgentSessionPanelPosition) => void
  onPress: () => void
  onStateChange: (updater: (state: AgentStoreState) => AgentStoreState) => void
}

export default function SessionItem({
  session,
  active,
  pinned,
  runtimeStatus,
  channelType,
  channelRuntime,
  sessionPanelPosition,
  dragging = false,
  dragOver = false,
  draggable = false,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  onUpdateSessionPanelPosition,
  onPress,
  onStateChange
}: SessionItemProps): React.ReactElement {
  const t = useAgentText()
  const [editing, setEditing] = useState(false)
  const [draftName, setDraftName] = useState(session.name)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const confirmDeleteTimerRef = useRef<number | null>(null)
  const channelIconUrl = getAgentChannelTypeIconUrl(channelRuntime?.channelType ?? channelType)
  const menuItems: MenuProps['items'] = [
    {
      key: 'rename',
      label: t.sessionItem.rename,
      icon: <Edit3 size={14} />,
      onClick: () => {
        setDraftName(session.name)
        setEditing(true)
      }
    },
    {
      key: 'pin',
      label: pinned ? t.sessionItem.unpin : t.sessionItem.pin,
      icon: pinned ? <PinOff size={14} /> : <Pin size={14} />,
      onClick: () => {
        void switchSessionPinStateViaApi(window.platform, session.id).catch(() => {
          onStateChange((current) => toggleSessionPinned(current, session.id))
        })
      }
    },
    {
      key: 'panel-position',
      label: t.sessionItem.panelPosition,
      icon: <MoreHorizontal size={14} />,
      children: [
        {
          key: 'panel-position-left',
          label: t.sessionItem.panelPositionLeft,
          onClick: () => onUpdateSessionPanelPosition('left'),
          disabled: sessionPanelPosition === 'left'
        },
        {
          key: 'panel-position-right',
          label: t.sessionItem.panelPositionRight,
          onClick: () => onUpdateSessionPanelPosition('right'),
          disabled: sessionPanelPosition === 'right'
        }
      ]
    },
    {
      key: 'delete',
      label: t.sessionItem.delete,
      icon: <Trash2 size={14} />,
      danger: true,
      onClick: () => {
        if (!window.confirm(t.sessionItem.confirmDeleteSession(session.name))) return
        void deleteSessionsViaApi(window.platform, [session.id]).catch(() => {
          onStateChange((current) => deleteSession(current, session.id))
        })
      }
    }
  ]

  function commitRename(): void {
    const nextName = draftName.trim()
    if (nextName && nextName !== session.name) {
      void updateSessionViaApi(window.platform, session.id, { name: nextName }).catch(() => {
        onStateChange((current) => renameSession(current, session.id, nextName))
      })
    }
    setEditing(false)
  }

  function deleteCurrentSession(): void {
    void deleteSessionsViaApi(window.platform, [session.id]).catch(() => {
      onStateChange((current) => deleteSession(current, session.id))
    })
  }

  function requestInlineDelete(event: React.MouseEvent<HTMLButtonElement>): void {
    event.stopPropagation()
    const intent = getSessionDeleteClickIntent({
      confirming: confirmingDelete,
      modifierPressed: event.metaKey || event.ctrlKey
    })

    if (intent === 'delete') {
      deleteCurrentSession()
      return
    }

    setConfirmingDelete(true)
    if (confirmDeleteTimerRef.current) window.clearTimeout(confirmDeleteTimerRef.current)
    confirmDeleteTimerRef.current = window.setTimeout(() => setConfirmingDelete(false), 3000)
  }

  function pressSessionRow(): void {
    if (!editing) onPress()
  }

  function handleSessionRowKeyDown(event: React.KeyboardEvent<HTMLDivElement>): void {
    if (editing) return
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    onPress()
  }

  useEffect(() => {
    return () => {
      if (confirmDeleteTimerRef.current) window.clearTimeout(confirmDeleteTimerRef.current)
    }
  }, [])

  return (
    <Dropdown menu={{ items: menuItems }} trigger={['contextMenu']}>
      <div
        role="button"
        tabIndex={0}
        className={[
          'agent-session-item',
          active ? 'active' : '',
          dragging ? 'dragging' : '',
          dragOver ? 'drag-over' : ''
        ]
          .filter(Boolean)
          .join(' ')}
        draggable={draggable && !editing}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDrop={onDrop}
        onDragEnd={onDragEnd}
        onClick={pressSessionRow}
        onKeyDown={handleSessionRowKeyDown}
        onDoubleClick={() => {
          setDraftName(session.name)
          setEditing(true)
        }}>
        {editing ? (
          <Input
            size="small"
            value={draftName}
            autoFocus
            onClick={(event) => event.stopPropagation()}
            onChange={(event) => setDraftName(event.target.value)}
            onBlur={commitRename}
            onPressEnter={commitRename}
            onKeyDown={(event) => {
              if (event.key === 'Escape') setEditing(false)
            }}
          />
        ) : (
          <>
            <SessionStatusIndicator active={active} status={runtimeStatus} />
            <span className="agent-session-topline">
              <span className="agent-session-name">
                {channelIconUrl ? (
                  <SessionChannelIcon
                    iconUrl={channelIconUrl}
                    channelRuntime={channelRuntime}
                  />
                ) : null}
                {pinned ? <Pin size={11} /> : null}
                <strong>{session.name}</strong>
              </span>
              <span className="agent-session-actions">
                <Tooltip title={t.sessionItem.deleteShortcut}>
                  <Button
                    className={confirmingDelete ? 'agent-session-delete confirming' : 'agent-session-delete'}
                    type="text"
                    size="small"
                    icon={confirmingDelete ? <Trash2 size={14} /> : <X size={14} />}
                    onClick={requestInlineDelete}
                    aria-label={t.sessionItem.delete}
                  />
                </Tooltip>
                <Dropdown menu={{ items: menuItems }} trigger={['click']}>
                  <Tooltip title={t.sessionItem.more}>
                    <Button
                      className="agent-session-more"
                      type="text"
                      size="small"
                      icon={<MoreHorizontal size={14} />}
                      onClick={(event) => event.stopPropagation()}
                      aria-label={t.sessionItem.moreAria}
                    />
                  </Tooltip>
                </Dropdown>
              </span>
            </span>
          </>
        )}
      </div>
    </Dropdown>
  )
}

function SessionStatusIndicator({
  active,
  status
}: {
  active: boolean
  status: AgentSessionRuntimeStatus
}): React.ReactElement | null {
  const t = useAgentText()
  if (status === 'idle' || active) return null

  return (
    <Tooltip title={t.sessionItem.status[status]}>
      <span className={`agent-session-status ${status}`} aria-label={t.sessionItem.status[status]} />
    </Tooltip>
  )
}

function SessionChannelIcon({
  iconUrl,
  channelRuntime
}: {
  iconUrl: string
  channelRuntime?: AgentSessionChannelRuntimeBadge
}): React.ReactElement {
  const icon = (
    <span className="agent-session-channel" aria-label={channelRuntime?.label}>
      <img className="agent-session-channel-icon" src={iconUrl} alt="" aria-hidden="true" />
      {channelRuntime ? (
        <span className={`agent-session-channel-runtime ${channelRuntime.tone}`} aria-hidden="true" />
      ) : null}
    </span>
  )

  if (!channelRuntime) {
    return icon
  }

  return (
    <Tooltip title={<ChannelRuntimeTooltip badge={channelRuntime} />}>
      {icon}
    </Tooltip>
  )
}

function ChannelRuntimeTooltip({
  badge
}: {
  badge: AgentSessionChannelRuntimeBadge
}): React.ReactElement {
  return (
    <span className="agent-session-channel-tooltip">
      {badge.tooltipLines.map((line, index) => (
        <span key={`${badge.channelId}-${index}`} className="agent-session-channel-tooltip-line">
          {line}
        </span>
      ))}
    </span>
  )
}
