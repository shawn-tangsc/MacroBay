import type { NotificationSettingsText } from './notificationSettingsText'

/**
 * 测试通知的回执：**复合句**，桌面那半句 + 通道那半句，最多两句（规范 §4）。
 *
 * 每一句都不许出现「已送达」「已显示」：桌面那条是 `handed-to-system`（交给了系统），
 * 通道那条即使拿到 `messageId` 也只是「已受理」——**通道接受了不等于读者看到了**。
 * 这是文案问题，也是诚实问题：说成「已显示」等于替系统背书。
 */
export type TestDeliveryAttempt = { channel: string; result: string; reason?: string }

export type TestPushOutcome =
  | { state: 'not-sent' }
  | { state: 'accepted'; messageId: string }
  | { state: 'unconfirmed' }
  | { state: 'failed'; reason: string }

export function describeTestReceipt(input: {
  delivery: readonly TestDeliveryAttempt[]
  push?: TestPushOutcome | { state: string; reason?: string; messageId?: string }
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

  if (input.push !== undefined) parts.push(describePush(input.push, text))

  // 一句都没有时不能沉默：至少说明「进了中心」，否则这行看着像坏了。
  return parts.length === 0 ? text.toastOff : parts.join(' ')
}

function describePush(push: { state: string; reason?: string; messageId?: string }, text: NotificationSettingsText): string {
  if (push.state === 'not-sent') return text.testPushNotSent
  // 短编号 = 记录 id 前 8 位；中心那条显示同一串，读者能对上。
  if (push.state === 'accepted') return text.testPushAccepted((push.messageId ?? '').slice(0, 8))
  if (push.state === 'failed') return text.testPushFailed(push.reason ?? text.reasonUnknown)
  return text.testPushUnconfirmed
}
