import { useEffect, useState } from 'react'
import { Bell } from 'lucide-react'
import { Button, Switch, Tag } from 'antd'

import { notificationDeliveryWired } from '@platform/notifications/contracts/notificationContracts'
import type { NotificationSettings } from '@platform/settings/schema/appSettings'

import type { PlatformText } from '../../i18n/platformText'

type NotificationToggleKey = keyof Pick<
  NotificationSettings,
  'desktopEnabled' | 'toastEnabled' | 'popupEnabled'
>

const notificationToggleRows: Array<{
  key: NotificationToggleKey
  channel: 'toast' | 'desktop' | 'popup'
  titleKey: 'desktopEnabled' | 'toastEnabled' | 'popupEnabled'
  descriptionKey: 'desktopDescription' | 'toastDescription' | 'popupDescription'
}> = [
  { key: 'toastEnabled', channel: 'toast', titleKey: 'toastEnabled', descriptionKey: 'toastDescription' },
  { key: 'desktopEnabled', channel: 'desktop', titleKey: 'desktopEnabled', descriptionKey: 'desktopDescription' },
  { key: 'popupEnabled', channel: 'popup', titleKey: 'popupEnabled', descriptionKey: 'popupDescription' }
]

export function NotificationSettingsPane(props: {
  title: string
  notice?: string | null
  settings: NotificationSettings
  labels: PlatformText['notifications']
  onChange: (patch: Partial<NotificationSettings>) => void
}): React.ReactElement {
  const { labels, settings } = props
  // 可点状态 = 这条渠道背后有没有用户看得见的落点。**逐渠道判**，不要再拿一个布尔量代表四个：
  // 曾经 `notificationProducerWired: true` 把「应用内提示」「高优先级弹窗」一起点亮，而它们没有渲染者。
  // 桌面渠道的授权状态：**只读**。主进程没有「申请授权」这个能力，真申请只能从渲染层走 Web API，
  // 而那条路径还没有在真机上验过——所以这里如实报「放行 / 没放行 / 读不到」，不替系统背锅。
  const [desktopPermission, setDesktopPermission] = useState<'granted' | 'denied' | 'unknown' | null>(null)

  useEffect(() => {
    let alive = true
    void Promise.resolve(window.platform?.notifications?.readDesktopPermission?.())
      .then((state) => {
        if (alive) setDesktopPermission(state ?? 'unknown')
      })
      .catch(() => {
        if (alive) setDesktopPermission('unknown')
      })
    return () => {
      alive = false
    }
  }, [])

  const desktopPermissionText =
    desktopPermission === null
      ? null
      : desktopPermission === 'granted'
        ? labels.desktopPermissionGranted
        : desktopPermission === 'denied'
          ? labels.desktopPermissionDenied
          : labels.desktopPermissionUnknown

  const wired = notificationDeliveryWired
  // 每条没落点的渠道**被编译器要求**交出自己的原因；不写就编译不过，等于不能靠一句「未启用」糊过去。
  const unavailableReason: Record<'toast' | 'desktop' | 'popup', 'popupUnavailable' | null> = {
    toast: null,
    desktop: null,
    popup: 'popupUnavailable'
  }
  const availableChannels = notificationToggleRows.filter((row) => wired[row.channel]).length
  // 点完必须**当场看到结果**：之前没有任何反馈，用户点了以为按钮坏了。
  const [sendResult, setSendResult] = useState<string | null>(null)

  async function sendTest(): Promise<void> {
    try {
      await window.platform.notifications.sendTest()
      // 横幅关着就如实说它不会出现，并告诉用户去哪儿看——不能只说「已发送」。
      setSendResult(settings.toastEnabled ? labels.sendTestSent : labels.sendTestToastOff)
    } catch {
      setSendResult(labels.sendTestFailed)
    }
  }

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
        {notificationToggleRows.map((row) => {
          // 每条渠道各说各的原因：弹窗还没有形态（本版本没有），不能借用「系统没放行」那句——
          // 那是桌面渠道的原因，混用会把用户送去系统设置里白找一圈。
          const rowWired = wired[row.channel]
          const reasonKey = unavailableReason[row.channel]
          const reason = reasonKey === null ? null : labels[reasonKey]
          return (
            <label key={row.key} className="notification-channel-row">
              <span className="notification-channel-copy">
                <strong className="notification-channel-title">{labels[row.titleKey]}</strong>
                <span className="notification-channel-description">{labels[row.descriptionKey]}</span>
                {row.channel === 'desktop' && desktopPermissionText !== null ? (
                  <span className="notification-channel-state" data-desktop-permission={desktopPermission}>
                    {desktopPermissionText}
                  </span>
                ) : null}
              </span>
              <span className="notification-channel-controls">
                {rowWired || reason === null ? null : <Tag>{reason}</Tag>}
                <Switch
                  className="notification-channel-switch"
                  size="small"
                  disabled={!rowWired}
                  checked={settings[row.key]}
                  onChange={(checked) => props.onChange({ [row.key]: checked })}
                />
              </span>
            </label>
          )
        })}
      </div>

      {/* 手动说明 + 唯一的动作：发送一条测试通知。权限状态不在这里画——系统答不了「授没授权」。 */}
      <div className="notification-settings-test">
        <Button size="small" onClick={() => void sendTest()}>
          {labels.sendTest}
        </Button>
        <p className="notification-settings-footnote">{labels.sendTestHint}</p>
        {sendResult === null ? null : (
          <p className="notification-settings-result" role="status" data-send-test-result>
            {sendResult}
          </p>
        )}
      </div>

      {/* 控件不可操作时不给操作建议：开关全禁用着，还建议「至少保留一个渠道」等于建议一个没得选的选择。 */}
      {availableChannels > 0 ? <p className="notification-settings-footnote">{labels.scopeNote}</p> : null}
    </section>
  )
}
