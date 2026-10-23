import { Bell } from 'lucide-react'
import { Switch } from 'antd'

import type { NotificationSettings } from '@platform/settings/schema/appSettings'

import type { PlatformText } from '../../i18n/platformText'

type NotificationToggleKey = keyof Pick<
  NotificationSettings,
  'centerEnabled' | 'desktopEnabled' | 'toastEnabled' | 'popupEnabled'
>

const notificationToggleRows: Array<{
  key: NotificationToggleKey
  titleKey: 'centerEnabled' | 'desktopEnabled' | 'toastEnabled' | 'popupEnabled'
  descriptionKey: 'centerDescription' | 'desktopDescription' | 'toastDescription' | 'popupDescription'
}> = [
  { key: 'centerEnabled', titleKey: 'centerEnabled', descriptionKey: 'centerDescription' },
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
      </div>

      <div className="notification-channel-list">
        {notificationToggleRows.map((row) => (
          <label key={row.key} className="notification-channel-row">
            <span className="notification-channel-copy">
              <strong className="notification-channel-title">{labels[row.titleKey]}</strong>
              <span className="notification-channel-description">{labels[row.descriptionKey]}</span>
            </span>
            <Switch
              className="notification-channel-switch"
              size="small"
              checked={settings[row.key]}
              onChange={(checked) => props.onChange({ [row.key]: checked })}
            />
          </label>
        ))}
      </div>

      <p className="notification-settings-footnote">{labels.scopeNote}</p>
    </section>
  )
}
