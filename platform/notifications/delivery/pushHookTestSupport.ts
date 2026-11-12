import type { ChannelPushAttempt, ChannelPushHook } from './channelPushPort'
import type { ChannelPushResult } from './channelPushPort'
import type { PushAttemptResult } from './pushDeliveryState'
import type { NotificationDeliveryContent } from '../runtime/notificationRouting'
import type { NotificationRecord } from '../contracts/notificationContracts'

/**
 * 用例用的扇出钩子：**同一个结果回给每一个被点名的通道**。
 *
 * 为什么要有它：端口现在一次调用扇出到 N 条通道、回逐条结果。多数用例只关心「这一跳成没成」，
 * 用这个包装后写法与扇出之前一样；真正关心逐条差异的用例自己写钩子（见 `channelPushPort.test.ts`）。
 */
export function singleResultHook(
  result: (record: NotificationRecord, content: NotificationDeliveryContent) => PushAttemptResult | Promise<PushAttemptResult>
): ChannelPushHook {
  return async (record, content, targets): Promise<readonly ChannelPushAttempt[]> => {
    const value = await result(record, content)
    const attempt: ChannelPushResult = {
      ok: value.ok,
      ...(value.reason === undefined ? {} : { reason: value.reason as ChannelPushResult['reason'] }),
      ...(value.messageId === undefined ? {} : { messageId: value.messageId })
    }
    return targets.map((target) => ({ channelId: target.channelId, channelName: target.channelName, result: attempt }))
  }
}
