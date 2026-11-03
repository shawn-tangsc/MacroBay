import { useState } from 'react'

import type { AppLanguage } from '@platform/settings/schema/appSettings'
import { LoadingState } from '@platform/ui/components/loading'
import { StateView } from '@platform/ui/components/state'
import { useShellTimeZone } from '@platform/ui/shell/ShellTimeZoneContext'
import { Button } from 'antd'

import './notifications/notificationSettings.css'
import { buildChannelRowState, channelColumnReady } from './notifications/channelRow'
import { DeliveryRows } from './notifications/DeliveryRows'
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
}): React.ReactElement {
  const text = notificationSettingsText[props.language]
  const client = props.client ?? (window.platform?.notifications as NotificationSettingsClient)
  const { state, reload, setSubscription, setToast, setPushChannel } = useNotificationSettingsData(client)
  const [receipt, setReceipt] = useState<string | null>(null)
  /** 写操作没存上：勾选与开关都不许自己亮起来，就地告诉他「没存上」。 */
  const [writeFailed, setWriteFailed] = useState(false)
  // 失败时刻按**读者的设置时区**写：这是给人看的时间，不是记账。
  const timeZone = useShellTimeZone()

  const runWrite = async (write: Promise<{ ok: boolean }>): Promise<void> => {
    const result = await write
    setWriteFailed(!result.ok)
  }

  const channelRow =
    state.status === 'ready'
      ? buildChannelRowState({
        channels: state.data.channels,
        channelId: state.data.channelId,
        lastPushFailureAt: state.data.lastPushFailureAt,
        lastPushFailureReason: state.data.lastPushFailureReason
      })
      : ({ kind: 'not-wired' } as const)

  const channelReady = channelColumnReady(channelRow)
  // 列会消失、订阅不会：把「已经勾过通道、但现在这列看不到」的条数字出来，页脚替它说一句话。
  const pendingChannelCount =
    state.status === 'ready'
      ? state.data.catalog.filter((entry) => state.data.subscriptions[entry.id]?.channel === true).length
      : 0

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
          {/* 写失败只有一句、只在原地：不把勾选/开关自己点亮，也不给内部码。 */}
          {writeFailed ? (
            <p className="notification-settings-write-failed" role="alert" data-notification-write-failed>
              {text.writeFailed}
            </p>
          ) : null}
          <DeliveryRows
            text={text}
            toastEnabled={state.data.toastEnabled}
            onToastChange={(next) => void runWrite(setToast(next))}
            channel={channelRow}
            channelTimeZone={timeZone}
            onSelectChannel={(channelId) => void runWrite(setPushChannel(channelId))}
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
                  // 通道列只在「已接入 + 已选 + 目标已绑定」时出现；否则整列不画（规范 §2.2）。
                  channelReady
                })}
                text={text}
                onToggle={(id, level, next) => void runWrite(setSubscription(id, level, next))}
              />
            )}
            {/* 列消失 ≠ 订阅消失：不写这句，读者会以为勾丢了，回头再勾一遍。 */}
            {!channelReady && pendingChannelCount > 0 ? (
              <p className="notification-settings-footnote" role="note" data-channel-column-pending>
                {text.channelPendingEffective(pendingChannelCount)}
              </p>
            ) : null}
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
    const result = (await client.sendTest?.()) as { delivery?: readonly TestDeliveryAttempt[] } | undefined
    setReceipt(describeTestReceipt({ delivery: result?.delivery ?? [], toastEnabled, text }))
  } catch {
    // 抛出来连「交给系统了」都没拿到：只能说失败，并如实写「原因不明」。
    setReceipt(text.desktopFailed(text.reasonUnknown))
  }
}
