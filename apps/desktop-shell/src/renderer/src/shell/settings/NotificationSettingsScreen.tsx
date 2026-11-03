import { useState } from 'react'

import type { AppLanguage } from '@platform/settings/schema/appSettings'
import { LoadingState } from '@platform/ui/components/loading'
import { StateView } from '@platform/ui/components/state'
import { useShellTimeZone } from '@platform/ui/shell/ShellTimeZoneContext'
import { formatShellCompactInstant } from '@platform/ui/time/shellTimeFormat'
import { Button } from 'antd'

import './notifications/notificationSettings.css'
import { DeliveryRows, channelRowState } from './notifications/DeliveryRows'
import { notificationSettingsText, type NotificationSettingsText } from './notifications/notificationSettingsText'
import { SubscriptionMatrixView } from './notifications/SubscriptionMatrixView'
import { buildSubscriptionRows } from './notifications/subscriptionMatrix'
import { describeTestReceipt, type TestDeliveryAttempt } from './notifications/testReceipt'
import { useNotificationSettingsData, type NotificationSettingsClient } from './notifications/useNotificationSettingsData'

/**
 * 设置 → 通知（规范 v2.7）。
 *
 * 这一屏的组织方式：**四份事实一处读**（`useNotificationSettingsData`），行与清单各自只画自己的形态。
 * 判断落在 `subscriptionMatrix.ts` 与 `DeliveryRows.tsx` 的纯函数里，所以「未批准不是禁用复选框」
 * 这类容易画错的规矩能写进用例，而不是靠评审时眼睛扫。
 */
export function NotificationSettingsScreen(props: {
  title: string
  notice?: string | null
  language: AppLanguage
  client?: NotificationSettingsClient
  /** 页面窗里没有设置页导航，此时不传——**不画一个点了没反应的动作**。 */
  onOpenChannelPage?: () => void
  onOpenSystemSettings?: () => void
}): React.ReactElement {
  const text = notificationSettingsText[props.language]
  const timeZone = useShellTimeZone()
  const client = props.client ?? (window.platform?.notifications as NotificationSettingsClient)
  const { state, reload, setSubscription, setToast, setChannel, permission } = useNotificationSettingsData(client)
  const [receipt, setReceipt] = useState<string | null>(null)

  return (
    <section className="settings-detail-pane preferences-pane notification-settings-pane">
      <div className="section-heading">
        <span>{props.title}</span>
        {props.notice ? <small>{props.notice}</small> : null}
      </div>

      {state.status === 'loading' ? <LoadingState label={text.loading} /> : null}

      {state.status === 'error' ? (
        // 「读不到」与「没有」是两件事：这里给重试，绝不说清单为空。
        <StateView
          state="error"
          reasonCode="unreadable"
          action={{ labelKey: 'ui.state.action.retry', onSelect: reload }}
          resolveText={(key) => (key === 'ui.state.action.retry' ? text.retry : key)}
        />
      ) : null}

      {state.status === 'ready' ? (
        <>
          <DeliveryRows
            text={text}
            toastEnabled={state.data.toastEnabled}
            onToastChange={(next) => void setToast(next)}
            desktopPermission={permission}
            onOpenSystemSettings={props.onOpenSystemSettings}
            channels={state.data.channels}
            channelId={state.data.channelId}
            onSelectChannel={(id) => void setChannel(id)}
            onOpenChannelPage={props.onOpenChannelPage}
            channel={channelRowState({
              channelId: state.data.channelId,
              channels: state.data.channels,
              lastPushFailureAt: state.data.lastPushFailureAt,
              lastPushFailureReason: null,
              formatInstant: (iso) => formatShellCompactInstant(iso, { timeZone })
            })}
          />

          <div className="notification-settings-test">
            <Button size="small" onClick={() => void sendTest(client, state.data.toastEnabled, text, setReceipt)}>
              {text.sendTest}
            </Button>
            <p className="notification-settings-footnote">{text.sendTestHint}</p>
            {receipt === null ? null : (
              // aria-live：四种回执各播报一次，重复点击只更新同一处，不堆消息。
              <p className="notification-settings-result" role="status" aria-live="polite" data-send-test-result>
                {receipt}
              </p>
            )}
          </div>

          <div className="notification-subs-section">
            <h3 className="notification-subs-title">{text.subsHeading}</h3>
            {state.data.catalog.length === 0 ? (
              // 清单区自己的空态：上面四行照常显示，所以这里不是整屏空态。
              <p className="preference-hint" data-subs-empty>
                {text.subsEmpty} {text.subsEmptyReason}
              </p>
            ) : (
              <SubscriptionMatrixView
                rows={buildSubscriptionRows({
                  entries: state.data.catalog,
                  subscriptions: state.data.subscriptions,
                  channelAvailable: state.data.channels.length > 0
                })}
                text={text}
                language={props.language}
                channelAvailable={state.data.channels.length > 0}
                onToggle={(id, level, next) => void setSubscription(id, level, next)}
              />
            )}
            <p className="notification-settings-footnote">{text.subsScope}</p>
          </div>
        </>
      ) : null}
    </section>
  )
}

async function sendTest(
  client: NotificationSettingsClient,
  toastEnabled: boolean,
  text: NotificationSettingsText,
  setReceipt: (value: string) => void
): Promise<void> {
  try {
    const result = (await client.sendTest?.()) as
      | { delivery?: readonly TestDeliveryAttempt[]; push?: { state: string; reason?: string; messageId?: string } }
      | undefined
    setReceipt(describeTestReceipt({ delivery: result?.delivery ?? [], push: result?.push, toastEnabled, text }))
  } catch {
    // 抛出来连「交给系统了」都没拿到：只能说失败，并如实写「原因不明」。
    setReceipt(text.desktopFailed(text.reasonUnknown))
  }
}
