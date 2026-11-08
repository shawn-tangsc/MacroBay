import { INTELLIGENCE_IPC_METHODS } from '../../../contracts/intelligenceIpcMethods'
import {
  INTELLIGENCE_TEST_KINDS,
  type IntelligenceTestKind,
  type IntelligenceTestReceipt
} from '../../../contracts/intelligenceNotificationTest'

/**
 * 三枚「发一条…」按钮的渲染层入口：**只传 kind**。
 *
 * 候选数据、成品句、去重键都由主进程按 kind 现取现拼——渲染层传不了内容，也就不会出现
 * 「屏幕上这条」与「实际发出去那条」不是同一条。回执三档原样交回，页面不替它合成一个布尔：
 * 「没数据」和「发不出去」是两件不同的事，读者要做的事也不一样。
 */
const PRODUCT_ID = 'market-intelligence'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * 回执解析：认不出形状就抛——**不猜成成功**，也不猜成某一种失败。
 *
 * 主进程与渲染层共用 `contracts/intelligenceNotificationTest.ts` 的两个闭集，这里只做边界处的
 * 收窄：多一个没登记的原因码就等于界面上多一句没人写过的句子。
 */
export function readTestNotificationReceipt(value: unknown): IntelligenceTestReceipt {
  if (!isRecord(value)) throw new Error('test-notification-unreadable')
  if (value.state === 'sent' && typeof value.channelId === 'string' && typeof value.channelName === 'string'
    && value.channelName.length > 0) {
    return { state: 'sent', channelId: value.channelId, channelName: value.channelName }
  }
  if (value.state === 'no-data' && isKnownRelayCode(value.reasonCode, NO_DATA_REASONS)) {
    return { state: 'no-data', reasonCode: value.reasonCode }
  }
  if (value.state === 'unavailable' && isKnownRelayCode(value.reasonCode, UNAVAILABLE_REASONS)) {
    return typeof value.enabledChannelCount === 'number'
      ? { state: 'unavailable', reasonCode: value.reasonCode, enabledChannelCount: value.enabledChannelCount }
      : { state: 'unavailable', reasonCode: value.reasonCode }
  }
  throw new Error('test-notification-unreadable')
}

const NO_DATA_REASONS = ['sentiment-none', 'calendar-upcoming-none', 'calendar-landed-none'] as const
const UNAVAILABLE_REASONS = ['push-unavailable', 'source-disabled', 'timezone-unreadable', 'read-failed'] as const

function isKnownRelayCode<T extends string>(value: unknown, allowed: readonly T[]): value is T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
}

export async function sendIntelligenceTestNotification(
  kind: IntelligenceTestKind
): Promise<IntelligenceTestReceipt> {
  if (!(INTELLIGENCE_TEST_KINDS as readonly string[]).includes(kind)) {
    throw new Error('unknown-test-notification-kind')
  }
  return readTestNotificationReceipt(
    await window.platform.products.invoke(PRODUCT_ID, INTELLIGENCE_IPC_METHODS.sendTestNotification, { kind })
  )
}
