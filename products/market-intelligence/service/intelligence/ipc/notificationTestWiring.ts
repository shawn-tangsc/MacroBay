import { getNotificationRuntime } from '@platform/notifications'
import type {
  NotificationSubmitOutcome,
  NotificationSubmitRequest
} from '@platform/notifications/contracts/notificationContracts'
import type { PushChannelResolution } from '@platform/notifications/delivery/pushChannelResolution'

/**
 * 三枚「发一条…」按钮要的平台侧接缝：通道解析、提交入口、数据源状态、读者时区。
 *
 * 单独成文件，让 `bootstrap.ts`（基线 718 行）只为它加一行调用——那个文件每涨三行都该有人问
 * 「为什么必须在这里」。这里全是**转发**：不判断、不缓存、不自己数通道。
 */
export type IntelligenceNotificationTestWiring = Readonly<{
  readEnabledCalendarFeeds: () => Promise<readonly string[]>
  getTimeZone: () => string
  getAppLanguage?: () => Promise<'zh-CN' | 'en-US'>
  resolvePushChannel: () => Promise<PushChannelResolution>
  submit: (request: NotificationSubmitRequest) => Promise<NotificationSubmitOutcome>
}>

export function createNotificationTestWiring(input: Readonly<{
  readEnabledCalendarFeeds: () => Promise<readonly string[]>
  /** 读者显示时区（壳层 `shellTimeZone().get()`）：窗口与日界按它算。 */
  readTimeZone: () => string
  getAppLanguage?: () => Promise<'zh-CN' | 'en-US'>
}>): IntelligenceNotificationTestWiring {
  return {
    readEnabledCalendarFeeds: input.readEnabledCalendarFeeds,
    getTimeZone: input.readTimeZone,
    getAppLanguage: input.getAppLanguage,
    // 通道与提交都走运行时**同一份**实现：产品侧不写第二套「恰好一条通道」的判定。
    resolvePushChannel: () => getNotificationRuntime().resolvePushChannel(),
    submit: (request) => getNotificationRuntime().submit(request)
  }
}
