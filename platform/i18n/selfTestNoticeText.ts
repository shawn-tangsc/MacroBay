import type { TestNoticeChannelReceipt, TestNoticeReceipt } from '../notifications/contracts/notificationSelfTest'
import { notificationCopyText, resolveNotificationCopyText, type NotificationCopyLanguage } from './notificationCopy'

/**
 * 自检回执 → 读者可见的句子（多通道方案 §5-5，平台侧）。
 *
 * 一次点击在**每条可用通道**上各发一条测试消息，所以回执必须能说清「发到几条、每条什么结果」；
 * 只给一句「已发到 X」在 N 条通道上就是半句事实。
 *
 * 三条纪律：
 * - **句子在这里拼，界面不拼数**：界面拿到的就是成品句（与通知记录同一条口径）；
 * - **没发到就不许说发到**：只有 `sent-accepted` 计入总括；有一条没到，总括换成「没发出去」；
 * - **`pushUnavailable` 只给「一条可用通道都没有」**：那句是「没接通通道」，不是「发失败了」。
 *   别的处境（被拒/折叠/合并/免打扰）走 `notification.selfTest.notSent`。
 *
 * 冷却中 / 没收到回执这两句等产品定稿后再换词——这里只引用键，不写死句子。
 */
export type SelfTestNoticeText = {
  /** 一句总括：全部发到 → 「已发到 N 条通道（测试）」；不全是 → 「测试消息没发出去」。 */
  summary: string
  /** 每条通道一句；顺序与主进程回报的顺序一致。 */
  lines: readonly string[]
}

export function selfTestNoticeText(receipt: TestNoticeReceipt, language: NotificationCopyLanguage): SelfTestNoticeText {
  const copy = (key: Parameters<typeof notificationCopyText>[1], params?: Record<string, string>): string => {
    const template = notificationCopyText(language, key)
    return params === undefined ? template : resolveNotificationCopyText(language, template, params)
  }

  if (receipt.state === 'unavailable') {
    // 「一条可用通道都没有」是唯一该说 `pushUnavailable` 的处境（多通道方案 §5-4）。
    const summary = receipt.reasonCode === 'push-unavailable'
      ? copy('notification.deliveryReason.pushUnavailable')
      : copy('notification.selfTest.notSent')
    return { summary, lines: [] }
  }

  const channels: readonly TestNoticeChannelReceipt[] = receipt.channels ?? [{
    channelId: receipt.channelId,
    channelName: receipt.channelName,
    state: 'sent-accepted'
  }]
  const sent = channels.filter((channel) => channel.state === 'sent-accepted')
  const lines = channels.map((channel) => {
    const name = channel.channelName ?? channel.channelId
    switch (channel.state) {
      case 'sent-accepted': return copy('notification.selfTest.channelSent', { channel: name })
      case 'queued': return copy('notification.selfTest.channelWaiting', { channel: name })
      case 'sent-unconfirmed': return copy('notification.selfTest.channelUnconfirmed', { channel: name })
      case 'failed': return copy('notification.selfTest.channelFailed', { channel: name })
    }
  })
  // 全部发到才说「已发到 N 条」；有一条没到就只说没发出去（逐条原因在 lines 里）。
  const summary = sent.length === channels.length && channels.length > 1
    ? copy('notification.selfTest.summary', { count: String(channels.length) })
    : channels.length === 1
      ? copy('notification.selfTest.channelSent', { channel: channels[0]!.channelName ?? channels[0]!.channelId })
      : copy('notification.selfTest.notSent')
  return { summary, lines }
}
