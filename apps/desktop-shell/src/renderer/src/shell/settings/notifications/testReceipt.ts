import type { NotificationSettingsText } from './notificationSettingsText'

/**
 * 测试通知的回执：桌面那半句（规范 §4）。
 *
 * 通道那半句已摘掉：`sendTest` 拿不到 `messageId`，也拿不到 push 的失败原因，
 * 渲染好了却没有数据源喂，就是「看起来能收到回执」。
 *
 * 每一句都不许出现「已送达」「已显示」：桌面那条是 `handed-to-system`（交给了系统），
 * 记住这条：桌面 `handed-to-system` 只是「交给了系统」，不等于读者看到了。
 * 这是文案问题，也是诚实问题：说成「已显示」等于替系统背书。
 */
export type TestDeliveryAttempt = { channel: string; result: string; reason?: string }

export function describeTestReceipt(input: {
  delivery: readonly TestDeliveryAttempt[]
  toastEnabled: boolean
  text: NotificationSettingsText
}): string {
  const { text, delivery } = input
  const parts: string[] = []

  const toast = delivery.find((attempt) => attempt.channel === 'toast')
  if (toast?.result === 'sent') parts.push(text.toastSent)
  else if (toast?.result === 'skipped' || !input.toastEnabled) parts.push(text.toastOff)

  const desktop = delivery.find((attempt) => attempt.channel === 'desktop')
  if (desktop?.result === 'failed') parts.push(text.desktopFailed(desktop.reason ?? text.reasonUnknown))
  else if (desktop?.result === 'handed-to-system') parts.push(text.desktopQueued)

  // 一句都没有时不能沉默：至少说明「进了中心」，否则这行看着像坏了。
  return parts.length === 0 ? text.toastOff : parts.join(' ')
}
