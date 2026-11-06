/**
 * 出站到读者已绑定通道的端口（通道方案 §2.2 / §4）。
 *
 * 这一层只做「把运行时解析好的同一份正文交出去」这一件事：
 *   - 不解析文案、不算时刻、不写文件（文案由 runtime 的文案端口解析一次，见 §2.2）；
 *   - 不决定「这条该不该推」（那是提交层的批准 ∩ 订阅，记录上已写成 `delivery.push.state='queued'`）；
 *   - 只判投递层的三条瞬时事实：接入、唯一目标、熔断（熔断的纯策略在 `pushBackoffPolicy.ts`，
 *     窗口内跳过由 runtime 的写入口执行，本端口不被调用）。
 *
 * 失败一律返回原因码、**不抛**：抛出去会打断 runtime 的提交路径，读者连中心那条记录都留不下。
 */
import type {
  ChannelConversationSafeView,
  ChannelDeliveryTargetView,
  ChannelManagementSafeView
} from '../../ai/agent-platform/channels/ChannelManagementContracts'
import { resolveDeliveryTarget } from '../../ai/agent-platform/channels/channelDeliveryTargetResolution'
import type { ChannelDeliveryRequest, ChannelDeliveryResult } from '../../ai/agent-platform/channels/ChannelDeliveryContracts'
import type { NotificationRecord } from '../contracts/notificationContracts'
import type { NotificationDeliveryContent } from '../runtime/notificationRouting'

/**
 * 契约 §8 的六个推送原因码，封闭集：端口不许发明第七个（通道方案 §4 映射表）。
 * `push-unavailable` 由 runtime 在端口未装配时写，端口自己只在通道选择为空时兜底用它。
 */
export type ChannelPushReason =
  | 'push-unavailable'
  | 'delivery-no-target-bound'
  | 'delivery-ambiguous-target'
  | 'push-backoff'
  | 'channel-rejected'
  | 'unknown-after-send'

export type ChannelPushResult = {
  ok: boolean
  reason?: ChannelPushReason
  /**
   * 通道侧受理凭据：投递尝试 id。契约 §8 要求 `sent-accepted` 带 `messageId`，
   * 而通道服务不返回上游消息 id——它能给出、也能在投递审计里查到的就是这一串。
   */
  messageId?: string
}

/**
 * 端口对通道侧的依赖面：只读投影 + 一个投递入口，不 import 仓储、不拿数据库。
 * 三个查询都是通道页用的同一份投影，端口不缓存第二份通道状态（通道方案 §2.3）。
 */
export type ChannelPushPortDeps = {
  channels: {
    list(): readonly ChannelManagementSafeView[]
    listDeliveryTargets(): { channels: readonly ChannelDeliveryTargetView[] }
    listConversations(input: { id: string; limit?: number }): readonly ChannelConversationSafeView[]
  }
  deliver(request: ChannelDeliveryRequest): Promise<ChannelDeliveryResult>
  /** 读读者选的通道；由组合根接到 runtime 设置（`push.channelId`）。 */
  settings: { pushChannelId(): Promise<string | null> }
}

/**
 * 手机推送的正文：标题 / 正文 / 「为什么推了」，去空去重。
 *
 * **末尾不加编号。** 以前这里是 `#${content.shortId}`，而 `shortId` 取记录 id 前 8 位、记录 id
 * 又以 `notification-` 开头——于是每一条的结尾都是同一个 `#notifica`：既重复又像坏掉的标签，
 * 读者还需要自己猜那是什么。手机上读者要的是「什么事」，不是我们的内部编号（2026-11-06 用户截图）。
 */
export function formatPushText(content: NotificationDeliveryContent): string {
  const lines: string[] = []
  for (const line of [content.title, content.body, content.reason]) {
    const trimmed = line.trim()
    if (trimmed.length > 0 && !lines.includes(trimmed)) lines.push(trimmed)
  }
  return lines.join('\n\n')
}

/**
 * 通道层结果 → 契约 §8 的六个码。映射表照抄通道方案 §4，多一个码都要改文档。
 *
 * `delivered` 只代表「通道接受了」，不是「读者看到了」；`unknown-after-send` 单独成码，
 * 不许写成「没发到手机」——把「拿不到」说成「没有」是红线。
 */
export function mapChannelDeliveryResult(result: ChannelDeliveryResult): ChannelPushResult {
  if (result.status === 'delivered') {
    return { ok: true, ...(result.attemptId === null ? {} : { messageId: result.attemptId }) }
  }
  if (result.status === 'unknown-after-send') return { ok: false, reason: 'unknown-after-send' }
  if (result.status === 'failed') return { ok: false, reason: 'channel-rejected' }
  switch (result.errorCode) {
    case 'delivery-target-disabled':
    case 'delivery-owner-invalid':
    case 'delivery-no-target-bound':
      return { ok: false, reason: 'delivery-no-target-bound' }
    case 'delivery-retry-not-permitted':
      return { ok: false, reason: 'push-backoff' }
    // 剩下的跳过码（未授权、空正文）都属于「通道那一侧拒收」；映射表里没有第二个去处。
    // `pending` / `sending` 是通道内部的进行态，`deliver()` 返回时不会停在这里，按拒绝处理更安全。
    default:
      return { ok: false, reason: 'channel-rejected' }
  }
}

export function createChannelPushPort(deps: ChannelPushPortDeps) {
  /**
   * `record` 只用来取幂等键（记录 id）；正文一律取自 `content`，
   * 端口不碰原始记录里的 metadata / 参数（脱敏在入记录那一刻已做过，通道方案 §2.5）。
   */
  return async function push(
    record: NotificationRecord,
    content: NotificationDeliveryContent
  ): Promise<ChannelPushResult> {
    try {
      const channelId = await deps.settings.pushChannelId()
      if (channelId === null) return { ok: false, reason: 'push-unavailable' }

      // 目标判定是**唯一实现**（`resolveDeliveryTarget`）：设置页、测试消息和这条推送都读它，
      // 免得两个功能在「一个说已绑定、另一个说没绑定」上各说各话。
      const resolved = resolveDeliveryTarget(deps.channels, channelId)
      if (!resolved.ok) {
        return {
          ok: false,
          reason: resolved.reason === 'no-target'
            ? 'delivery-no-target-bound'
            : resolved.reason === 'ambiguous' ? 'delivery-ambiguous-target' : 'channel-rejected'
        }
      }

      const result = await deps.deliver({
        channelId: resolved.channelId,
        agentId: resolved.agentId,
        conversationId: resolved.conversationId,
        source: 'notification',
        // 幂等键 = 记录 id：同一条记录重发不会在通道侧变成两次（通道方案 §2.2）。
        sourceId: record.id,
        text: formatPushText(content)
      })
      return mapChannelDeliveryResult(result)
    } catch {
      // 端口不许把异常抛回提交路径：失败是记录上的证据，不是一条丢掉的记录。
      return { ok: false, reason: 'channel-rejected' }
    }
  }
}

export type ChannelPushPort = ReturnType<typeof createChannelPushPort>
