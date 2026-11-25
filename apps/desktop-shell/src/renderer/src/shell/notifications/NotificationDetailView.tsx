import { ArrowLeft } from 'lucide-react'
import { useEffect, useRef, type ReactElement } from 'react'

import type { NotificationCenterItem } from '@platform/notifications/contracts/notificationCenterContracts'
import type { NotificationDeeplink } from '@platform/notifications/contracts/notificationContracts'
import { IconButton } from '@platform/ui/components/icon-button'
import { useShellTimeFormat } from '@platform/ui/time/useShellTimeFormat'

import type { PlatformText } from '../../i18n/platformText'

import { DeliveryRow } from './DeliveryRow'
import { NotificationActionButton, hasActionTarget } from './notificationActionButton'
import { PosterDeliveryRow } from './PosterDeliveryRow'
import { textRowModel } from './textRowModel'

import './notificationDetail.css'

/** 返回键的读屏名：键在壳的文案表（`notifications.detail.back`）。 */
const BACK_KEY = 'notifications.detail.back'

/**
 * 通知详情（#46）：通知中心抽屉里的**第二层视图**，与列表共用一个抽屉。
 *
 * 为什么不是新开 Modal（界面设计 2026-11-25 ①）：抽屉自己已经有焦点陷阱；再压一层会出现
 * 「Esc 关谁」和双遮罩。所以这里是同一只抽屉换内容：标题换成这一条通知的标题（由宿主设），
 * 这一层只画正文、「送达」组（文字 + 海报）和这条记录自己的动作。
 *
 * 返回键放在正文顶部左侧：平台 `Drawer` 的头只有 `title` / `titleExtra` / `actions` / `close`
 * 四个位，没有「标题前的槽」，所以返回键进不了头的左端。Esc 的回退与焦点回位归宿主
 * （`NotificationCenterDrawer`），这一层只管画与回调。
 */
export function NotificationDetailView(props: Readonly<{
  item: NotificationCenterItem
  labels: PlatformText['notifications']
  onBack: () => void
  onOpenDeeplink: (deeplink: NotificationDeeplink) => void
  onOpenExternal: (url: string) => Promise<unknown>
  onOpenExternalFailed: () => void
  onRead: (id: string) => Promise<void>
}>): ReactElement {
  const formatTime = useShellTimeFormat()
  const backRef = useRef<HTMLButtonElement | HTMLAnchorElement | null>(null)

  /*
    进详情先把焦点放到返回键：列表那一行连同它的「详情」按钮已经被换掉，不主动落点，焦点会掉回
    `body`，读屏读者不知道这一屏换了。回列表那一半由宿主做（焦点送回入口），两程对称。
  */
  useEffect(() => {
    backRef.current?.focus()
  }, [])

  const text = textRowModel(props.item.delivery.push, props.labels.detail.poster)
  const showDelivery = text !== null || props.item.poster !== undefined

  return (
    <div className="notification-detail" data-notification-detail>
      <div className="notification-detail__leads">
        <IconButton
          ref={backRef}
          ariaLabelKey={BACK_KEY}
          icon={ArrowLeft}
          onSelect={props.onBack}
          resolveText={(key) => (key === BACK_KEY ? props.labels.detail.back : key)}
          size="md"
          variant="plain"
        />
      </div>
      <p className="notification-detail__meta">{formatTime(props.item.createdAt)}</p>
      {props.item.body === '' ? null : <p className="notification-detail__body">{props.item.body}</p>}

      {showDelivery ? (
        <section className="notification-detail__delivery">
          <p className="notification-detail__group">{props.labels.detail.group}</p>
          <dl className="notification-detail__rows">
            {text === null ? null : (
              <DeliveryRow
                label={props.labels.detail.text}
                state={text.state}
                {...(text.counts === undefined ? {} : { counts: text.counts })}
                hints={[]}
                detail={props.labels.detail}
              />
            )}
            <PosterDeliveryRow poster={props.item.poster} labels={props.labels} />
          </dl>
        </section>
      ) : null}

      {hasActionTarget(props.item) ? (
        <div className="notification-detail__actions">
          <NotificationActionButton
            item={props.item}
            onOpenDeeplink={props.onOpenDeeplink}
            onOpenExternal={props.onOpenExternal}
            onOpenExternalFailed={props.onOpenExternalFailed}
            onRead={props.onRead}
          />
        </div>
      ) : null}
    </div>
  )
}
