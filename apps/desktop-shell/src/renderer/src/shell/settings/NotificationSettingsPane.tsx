import { Bell } from 'lucide-react'
import { Button, Switch, Tag } from 'antd'

import { notificationProducerWired } from '@platform/notifications/contracts/notificationContracts'
import type { NotificationSettings } from '@platform/settings/schema/appSettings'

import type { PlatformText } from '../../i18n/platformText'

type NotificationToggleKey = keyof Pick<
  NotificationSettings,
  'desktopEnabled' | 'toastEnabled' | 'popupEnabled'
>

const notificationToggleRows: Array<{
  key: NotificationToggleKey
  titleKey: 'desktopEnabled' | 'toastEnabled' | 'popupEnabled'
  descriptionKey: 'desktopDescription' | 'toastDescription' | 'popupDescription'
}> = [
  { key: 'toastEnabled', titleKey: 'toastEnabled', descriptionKey: 'toastDescription' },
  { key: 'desktopEnabled', titleKey: 'desktopEnabled', descriptionKey: 'desktopDescription' },
  { key: 'popupEnabled', titleKey: 'popupEnabled', descriptionKey: 'popupDescription' }
]

export function NotificationSettingsPane(props: {
  title: string
  notice?: string | null
  settings: NotificationSettings
  labels: PlatformText['notifications']
  onChange: (patch: Partial<NotificationSettings>) => void
}): React.ReactElement {
  const { labels, settings } = props
  // No producer means these switches cannot change what the user receives: show that instead of a
  // toggle that silently does nothing (MI-11-R7).
  const available = notificationProducerWired

  return (
    <section className="settings-detail-pane preferences-pane notification-settings-pane">
      <div className="section-heading">
        <span>{props.title}</span>
        {props.notice ? <small>{props.notice}</small> : null}
      </div>

      <div className="notification-settings-intro">
        <div className="preference-heading">
          <Bell size={18} />
          <span>{labels.channelsHeading}</span>
        </div>
        <p>{labels.channelsDescription}</p>
        {available ? null : <p className="notification-settings-unavailable" role="note">{labels.unavailableNotice}</p>}
      </div>

      <div className="notification-channel-list">
        {notificationToggleRows.map((row) => (
          <label key={row.key} className="notification-channel-row">
            <span className="notification-channel-copy">
              <strong className="notification-channel-title">{labels[row.titleKey]}</strong>
              <span className="notification-channel-description">{labels[row.descriptionKey]}</span>
            </span>
            <span className="notification-channel-controls">
              {available ? null : <Tag>{labels.unavailableBadge}</Tag>}
              <Switch
                className="notification-channel-switch"
                size="small"
                disabled={!available}
                checked={settings[row.key]}
                onChange={(checked) => props.onChange({ [row.key]: checked })}
              />
            </span>
          </label>
        ))}
      </div>

      {/* 手动说明 + 唯一的动作：发送一条测试通知。权限状态不在这里画——系统答不了「授没授权」。 */}
      <div className="notification-settings-test">
        <Button size="small" onClick={() => void window.platform.notifications.sendTest()}>
          {labels.sendTest}
        </Button>
        <p className="notification-settings-footnote">{labels.sendTestHint}</p>
      </div>

      {/* 控件不可操作时不给操作建议：开关全禁用着，还建议「至少保留一个渠道」等于建议一个没得选的选择。 */}
      {available ? <p className="notification-settings-footnote">{labels.scopeNote}</p> : null}
    </section>
  )
}
