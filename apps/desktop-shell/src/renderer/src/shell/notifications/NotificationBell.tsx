import { useCallback, useEffect, useState } from 'react'
import { Bell } from 'lucide-react'

import { IconButton } from '@platform/ui/components/icon-button'

import type { PlatformText } from '../../i18n/platformText'

import { createNotificationCenterSource, type NotificationCenterSource } from './notificationCenterSource'

/** 角标只显示到两位，再多就是 `99+`——三位数会把铃铛挤变形。 */
export const UNREAD_BADGE_CAP = 99

export function formatUnreadBadge(unread: number): string | null {
  if (!Number.isFinite(unread) || unread <= 0) return null
  return unread > UNREAD_BADGE_CAP ? `${UNREAD_BADGE_CAP}+` : String(Math.floor(unread))
}

export const BELL_KEY = 'notifications.bell'
export const BELL_UNREAD_KEY = 'notifications.bellUnread'

type NotificationBellProps = {
  labels: PlatformText['notifications']
  onOpen: () => void
  source?: NotificationCenterSource
}

/**
 * 铃铛 + 未读角标。
 *
 * 两条口径写在这里、不靠评审：
 * - **0 不渲染角标**（空数字比没有更吵），超过 99 显示 `99+`；
 * - **`version` 必须用掉**：订阅 `onChanged`，抽屉关着时来了新通知，角标也要跟着变。
 *   只在挂载时读一次的话，用户会看着一个永远不动的数字。
 */
export function NotificationBell({ labels, onOpen, source }: NotificationBellProps): React.ReactElement {
  const [unread, setUnread] = useState(0)
  // 只作依赖：值变了就说明「不是同一次事件」，让重读真的发生。
  const [version, setVersion] = useState(0)

  useEffect(() => {
    const centre = source ?? createNotificationCenterSource()
    let alive = true
    const read = (): void => {
      void centre
        .unread()
        .then((state) => {
          if (alive) setUnread(state.unread)
        })
        // 读不到就保持上一次的值：把角标清零等于告诉用户「没有未读」，那是撒谎。
        .catch(() => undefined)
    }
    read()
    const unsubscribe = centre.onChanged((change) => {
      if (alive) setVersion(change.version)
    })
    return () => {
      alive = false
      unsubscribe()
    }
  }, [source])

  // 版本一变就重读一次：读数与订阅分开，是因为事件只说「变了」，真值仍要问一次。
  useEffect(() => {
    if (version === 0) return
    const centre = source ?? createNotificationCenterSource()
    let alive = true
    void centre
      .unread()
      .then((state) => {
        if (alive) setUnread(state.unread)
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [source, version])

  const badge = formatUnreadBadge(unread)

  return (
    <span className="notification-bell" data-notification-bell>
      <IconButton
        ariaLabelKey={badge === null ? BELL_KEY : BELL_UNREAD_KEY}
        ariaLabelParams={badge === null ? undefined : { count: String(unread) }}
        icon={Bell}
        onSelect={onOpen}
        size="md"
        variant="solid"
        resolveText={(key) => (key === BELL_UNREAD_KEY ? labels.bellUnread(String(unread)) : labels.bell)}
      />
      {badge === null ? null : (
        <span className="notification-bell-badge" data-unread-badge aria-hidden="true">
          {badge}
        </span>
      )}
    </span>
  )
}
