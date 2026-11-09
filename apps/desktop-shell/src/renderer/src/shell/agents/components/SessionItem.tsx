import { useEffect, useRef, useState } from 'react'
import { Button, Dropdown, Input, Tooltip as AntTooltip } from 'antd'
import type { MenuProps } from 'antd'
import { Edit3, MoreHorizontal, Pin, PinOff, Trash2, X } from 'lucide-react'

import type { AgentSessionEntity } from '@platform/ai/agent-platform/schemas/sessionSchemas'
import { displaySessionName } from '@platform/ai/agent-platform/schemas/sessionDisplayName'
import type { AgentStoreState } from '@platform/ai/agent-platform/store/agentStore'
import type { AgentSessionPanelPosition } from '@platform/settings/schema/appSettings'

import { deleteSession, renameSession, toggleSessionPinned } from '../agentStateActions'
import type { AgentSessionChannelRuntimeBadge } from '../agentChannelRuntimeViewModel'
import { deleteSessionsViaApi, switchSessionPinStateViaApi, updateSessionViaApi } from '../agentSessionDataApi'
import { getSessionDeleteClickIntent } from '../agentSessionDeleteInteraction'
import type { AgentSessionRuntimeStatus } from '../agentSessionViewModel'
import { getAgentChannelTypeIconUrl } from '../agentChannelVisuals'
import { IconButton } from '@platform/ui/components/icon-button'
import { useConfirm } from '@platform/ui/components/confirm'
import { Tooltip } from '@platform/ui/components/tooltip'

import { useAgentText } from '../agentTextProvider'
import { resolveAgentTextKey, resolveAgentTooltipText, type AgentTooltipKey } from '../agentTooltipText'

type SessionItemProps = {
  session: AgentSessionEntity
  active: boolean
  pinned: boolean
  runtimeStatus: AgentSessionRuntimeStatus
  channelType?: string
  channelRuntime?: AgentSessionChannelRuntimeBadge
  sessionPanelPosition: AgentSessionPanelPosition
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
  onUpdateSessionPanelPosition,
  onPress,
  onStateChange
}: SessionItemProps): React.ReactElement {
  const t = useAgentText()
  // 库里可能把身份当名字存下来（老的自动会话就是运行 id）。展示与确认文案都用这个名字；
  // 读者仍能通过「重命名」改掉它——输入框里放的是库里真正存的值，不是这里的兜底文案。
  const displayName = displaySessionName(session) ?? t.sidePanel.unnamedSession
  const confirm = useConfirm()
  const tooltipKeys = {
    deleteShortcut: 'sessionItem.deleteShortcut',
    more: 'sessionItem.more'
  } as const satisfies Record<string, AgentTooltipKey>
  const resolveText = (key: AgentTooltipKey): string => resolveAgentTooltipText(t, key)
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
        confirm({
          title: t.sessionItem.delete,
          description: t.sessionItem.confirmDeleteSession(displayName),
          confirmLabel: t.sessionItem.delete,
          cancelLabel: t.common.cancel,
          tone: 'danger',
          onConfirm: () => {
            void deleteSessionsViaApi(window.platform, [session.id]).catch(() => {
              onStateChange((current) => deleteSession(current, session.id))
            })
          }
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

  // 参数放宽到 HTMLElement：`IconButton.onSelect` 按 `MouseEvent<HTMLElement>` 收（浮层要能注入处理器），
  // 写窄的处理器不能当宽的用。这里只用 stopPropagation 与修饰键，不需要更窄的类型。
  function requestInlineDelete(event: React.MouseEvent<HTMLElement>): void {
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
        className={['agent-session-item', active ? 'active' : ''].filter(Boolean).join(' ')}
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
                <strong>{displayName}</strong>
              </span>
              <span className="agent-session-actions">
                <IconButton
                  ariaLabelKey="sessionItem.delete"
                  className={confirmingDelete ? 'agent-session-delete confirming' : 'agent-session-delete'}
                  icon={confirmingDelete ? Trash2 : X}
                  onSelect={requestInlineDelete}
                  resolveText={(key) => resolveAgentTextKey(t, key)}
                  size="sm"
                  tooltipKey={tooltipKeys.deleteShortcut}
                />
                <Dropdown menu={{ items: menuItems }} trigger={['click']}>
                  <Tooltip labelKey={tooltipKeys.more} resolveText={resolveText}>
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
    <AntTooltip title={t.sessionItem.status[status]}>
      <span className={`agent-session-status ${status}`} aria-label={t.sessionItem.status[status]} />
    </AntTooltip>
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
    <AntTooltip title={<ChannelRuntimeTooltip badge={channelRuntime} />}>
      {icon}
    </AntTooltip>
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
