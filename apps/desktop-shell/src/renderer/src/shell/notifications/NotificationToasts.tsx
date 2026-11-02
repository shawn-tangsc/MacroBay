import { useCallback, useEffect, useState } from 'react'
import { X } from 'lucide-react'

import { IconButton } from '@platform/ui/components/icon-button'
import type { NotificationCopyLanguage } from '@platform/i18n/notificationCopy'
import type { SafeNotificationRecord } from '@platform/notifications/contracts/notificationContracts'

import type { PlatformText } from '../../i18n/platformText'

import { resolveNotificationText } from './notificationText'

import './notificationToasts.css'

/** 停留时长：够读完一句抬头，又不至于挡着人干活。 */
export const TOAST_VISIBLE_MS = 6000
/** 同时最多几条：再多就把顶栏下面那一片变成一堵墙。 */
export const TOAST_MAX_STACK = 3

export const TOAST_CLOSE_KEY = 'notifications.toastClose'

export type DeliveredNotification = { channel: 'toast' | 'popup'; record: SafeNotificationRecord }

type Subscribe = (callback: (delivery: DeliveredNotification) => void) => () => void

type NotificationToastItem = { id: string; title: string; body: string }

/**
 * 右上角的横幅：**点了「发送测试通知」之后必须立刻出现的东西**。
 *
 * 这之前整条链只差这一环：运行时早就把 `toast` / `popup` 两个通道算出来了，但没有任何钩子接，
 * 于是每条都被写成 `skipped: toast-unavailable`——开关勾着、屏幕上什么都没有，和假开关一样。
 *
 * 口径：
 * - 只画 `toast`；`popup` 是另一档打断，形态由界面设计定，不在这一笔里冒充；
 * - 文案在这里按**当前语言**解析（记录里只有键与参数），切语言时历史记录跟着变；
 * - 自动消失 6 秒，也可手动关；点条体打开通知中心——横幅消失后那条记录仍在铃铛里。
 */
export function NotificationToasts(props: {
  labels: PlatformText['notifications']
  language: NotificationCopyLanguage
  onOpen: () => void
  subscribe?: Subscribe
}): React.ReactElement {
  const [items, setItems] = useState<readonly NotificationToastItem[]>([])

  useEffect(() => {
    // 桥缺失（渲染层单测 / 旧 preload）时退化成空订阅：横幅不该因此把外壳拖崩。
    const subscribe: Subscribe =
      props.subscribe ??
      ((callback) => {
        const bridge = (window.platform as { notifications?: { onDelivered?: Subscribe } } | undefined)?.notifications
        return bridge?.onDelivered?.(callback) ?? (() => undefined)
      })

    return subscribe((delivery) => {
      if (delivery.channel !== 'toast') return
      const text = resolveNotificationText(delivery.record, props.language)
      setItems((current) => {
        const next = { id: delivery.record.id, title: text.title, body: text.body }
        const deduped = current.filter((item) => item.id !== next.id)
        // 超出上限先丢最旧的一条：后到的更接近用户此刻关心的事。
        return [...deduped, next].slice(-TOAST_MAX_STACK)
      })
    })
  }, [props.language, props.subscribe])

  const dismiss = useCallback((id: string) => {
    setItems((current) => current.filter((item) => item.id !== id))
  }, [])

  return (
    <div className="notification-toasts" role="status" aria-live="polite" data-notification-toasts>
      {items.map((item) => (
        <ToastRow
          item={item}
          key={item.id}
          labels={props.labels}
          onClose={() => dismiss(item.id)}
          onOpen={props.onOpen}
        />
      ))}
    </div>
  )
}

function ToastRow(props: {
  item: NotificationToastItem
  labels: PlatformText['notifications']
  onClose: () => void
  onOpen: () => void
}): React.ReactElement {
  useAutoDismiss(props.onClose)

  return (
    <div className="notification-toast" data-notification-toast={props.item.id}>
      <button type="button" className="notification-toast-body" onClick={props.onOpen}>
        <strong className="notification-toast-title">{props.item.title}</strong>
        {props.item.body ? <span className="notification-toast-text">{props.item.body}</span> : null}
      </button>
      <IconButton
        ariaLabelKey={TOAST_CLOSE_KEY}
        icon={X}
        onSelect={props.onClose}
        resolveText={(key) => (key === TOAST_CLOSE_KEY ? props.labels.toastClose : '')}
        size="sm"
      />
    </div>
  )
}

/** 把自动消失挂在一行上；`onClose` 变了就重排计时，不会越挂越多次。 */
function useAutoDismiss(onClose: () => void): void {
  useEffect(() => {
    const timeout = setTimeout(onClose, TOAST_VISIBLE_MS)
    return () => clearTimeout(timeout)
  }, [onClose])
}
