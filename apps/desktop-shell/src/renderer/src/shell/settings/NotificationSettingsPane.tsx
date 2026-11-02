import { useEffect, useState } from 'react'
import { Bell } from 'lucide-react'
import { Button, Switch } from 'antd'

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

/**
 * 只有**有落点**的渠道才出现在这一屏。
 *
 * 两类事实不能同一种形态：「能力没有」（弹窗）→ 整行不渲染；「能力有但被挡住」（桌面被系统挡）
 * → 渲染 + 禁用 + 同一行的原因。禁用一个不存在的能力，等于告诉用户「这里本来有」——
 * 这正是今晚两颗没有处理函数的顶栏图标被删掉的同一条判据。
 */
const visibleRows = notificationToggleRows.filter((row) => notificationDeliveryWired[row.channel])

/** 原因文字的 id：开关用 `aria-describedby` 指过来，读屏读到控件时能听到「为什么」。 */
/**
 * 把这次测试的投递结果说成一句话。顺序按用户关心的先后：横幅出来没有 → 桌面那条的下场。
 *
 * `toast` 的 `sent` 才算「横幅已出现」；`skipped` 通常是开关关着（正常降级，不是错误）。
 * `desktop` 的 `handed-to-system` 不等于用户看到了，所以文案不说「已显示」，只说「交给系统了」。
 */
export function describeTestDelivery(
  delivery: readonly { channel: string; result: string; reason?: string }[],
  toastEnabled: boolean,
  labels: PlatformText['notifications']
): string {
  const toast = delivery.find((attempt) => attempt.channel === 'toast')
  const desktop = delivery.find((attempt) => attempt.channel === 'desktop')
  const parts: string[] = []
  if (toast?.result === 'sent') parts.push(labels.sendTestSent)
  else if (!toastEnabled || toast?.result === 'skipped') parts.push(labels.sendTestToastOff)
  if (desktop?.result === 'failed') parts.push(labels.sendTestDesktopFailed(desktop.reason ?? ''))
  else if (desktop?.result === 'handed-to-system') parts.push(labels.sendTestDesktopQueued)
  // 一个都没匹配上时不能沉默：至少说「进了中心」，别让结果行空着。
  return parts.length === 0 ? labels.sendTestToastOff : parts.join(' ')
}

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
  const wired = notificationDeliveryWired
  const availableChannels = visibleRows.length
  // 点完必须**当场看到结果**：之前没有任何反馈，用户点了以为按钮坏了。
  const [sendResult, setSendResult] = useState<string | null>(null)

  async function sendTest(): Promise<void> {
    try {
      // 主进程把每次投递的结果一起返回：横幅出没出、桌面那条交给系统了还是失败。
      // 用户点这个按钮的目的就是判断「系统放没放行」，只回一句「已发送」等于没测。
      const result = (await window.platform.notifications.sendTest()) as {
        delivery?: readonly { channel: string; result: string; reason?: string }[]
      }
      setSendResult(describeTestDelivery(result?.delivery ?? [], settings.toastEnabled, labels))
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
        {visibleRows.map((row) => {
          // 每条渠道各说各的原因：弹窗还没有形态（本版本没有），不能借用「系统没放行」那句——
          // 那是桌面渠道的原因，混用会把用户送去系统设置里白找一圈。
          const rowWired = wired[row.channel]
          return (
            <label key={row.key} className="notification-channel-row">
              <span className="notification-channel-copy">
                <strong className="notification-channel-title">{labels[row.titleKey]}</strong>
                <span className="notification-channel-description">{labels[row.descriptionKey]}</span>
                {row.channel === 'desktop' ? (
                  <span className="notification-channel-state" data-desktop-gate-hint role="note">
                    {labels.desktopSystemGateHint}
                  </span>
                ) : null}
              </span>
              <span className="notification-channel-controls">
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
