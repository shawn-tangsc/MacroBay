import { Switch } from 'antd'

import { ChannelDeliveryRow } from './ChannelDeliveryRow'
import type { ChannelRowState } from './channelRow'
import type { NotificationSettingsText } from './notificationSettingsText'

/**
 * 四个本机落点 + 一条出站通道，一行一件事（规范 §2）。
 *
 * 通道那一行曾经被整块摘掉，理由写的是「发到手机的能力还没被批准」——CLI 真机证据一落库、
 * 通道可以启用以后，这句话就不成立了：不画这一行，读者在界面里**根本选不到**已经可用的通道。
 * 现在按 §2.1 的四个处境画，形态在 `channelRow.ts` 里算。
 *
 * 这一块的硬规矩：**一件事只有一个控件**。曾经这里是「行开关 + 逐条勾选」两套，
 * 于是取消订阅后行开关还亮着、清单里那个勾也还亮着，读者无法判断哪个算数。
 * 通道行同理：它没有开关，开关是清单里的「通道」列。
 */
export function DeliveryRows(props: {
  text: NotificationSettingsText
  toastEnabled: boolean
  onToastChange: (next: boolean) => void
  channel: ChannelRowState
  channelTimeZone: string
  onSelectChannel: (channelId: string) => void
}): React.ReactElement {
  const { text } = props

  return (
    <div className="notification-rows">
      {/* 通知中心：无控件，右侧一个标签。标签不是禁用开关——禁用开关会让人以为以后能开。 */}
      <div className="notification-row" data-row="center">
        <span className="notification-row-copy">
          <strong>{text.centerRow}</strong>
          <span className="notification-row-desc">{text.centerDesc}</span>
        </span>
        <span className="notification-row-control">
          <span className="notification-subs-fixed">{text.centerFixed}</span>
        </span>
      </div>

      {/* 应用内提示：全站一个开关，不是总闸。 */}
      <div className="notification-row" data-row="toast">
        <span className="notification-row-copy">
          <strong>{text.toastRow}</strong>
          <span className="notification-row-desc">{text.toastDesc}</span>
        </span>
        <span className="notification-row-control">
          <Switch size="small" checked={props.toastEnabled} onChange={(next) => props.onToastChange(next)} />
        </span>
      </div>

      {/* 桌面通知：没有开关。开关是清单里的桌面列，这一行只说系统放没放行。 */}
      <div className="notification-row" data-row="desktop">
        <span className="notification-row-copy">
          <strong>{text.desktopRow}</strong>
          <span className="notification-row-desc">{text.desktopDesc}</span>
          {/*
            * 不画「已放行 / 没放行 / 读不到」三档：Electron 没有读这个开关的 API，三档里前两档永远
            * 不会出现，画出来的就只是一句恒定的「读不到」。改成一句白话：读不到、去哪儿开、怎么自验。
            */}
          <span className="notification-row-hint" role="note" data-desktop-cannot-read>
            {text.desktopCannotRead}
          </span>
        </span>
      </div>

      {/* 高优先级弹窗：整行禁用 + 常驻原因。原因说「位置先留着」，不说「以后会做」。 */}
      <div className="notification-row notification-row--disabled" data-row="popup" aria-disabled="true">
        <span className="notification-row-copy">
          <strong>{text.popupRow}</strong>
          <span className="notification-row-desc" role="note">
            {text.popupDisabled}
          </span>
        </span>
      </div>

      {/* 发送到通道：选择器 + 目标（只读）+ 状态行 + 一个动作，**没有开关**。 */}
      <ChannelDeliveryRow
        text={text}
        state={props.channel}
        timeZone={props.channelTimeZone}
        onSelectChannel={props.onSelectChannel}
      />

    </div>
  )
}
