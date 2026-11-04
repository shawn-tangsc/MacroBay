/**
 * 设置页「发一条测试消息」的真实出站与回执（不是假按钮）。
 *
 * 三种回执，**没有「已送达」**：我们只能证明「通道接受了」，证明不了读者手机上显示了。
 * 失败原因用四个平台词，不把通道层的原始码送出去——那是诊断用语，读者看不懂，
 * 而界面一旦直接印码，就等于把内部词汇漏给了读者。
 */
import type { ChannelDeliveryRequest, ChannelDeliveryResult } from './ChannelDeliveryContracts'
import { resolveDeliveryTarget, type ChannelTargetView } from './channelDeliveryTargetResolution'

export type ChannelTestMessageFailure = 'not-ready' | 'no-target' | 'ambiguous-target' | 'rejected'

export type ChannelTestMessageReceipt =
  | { state: 'accepted'; messageId: string | null }
  | { state: 'unconfirmed'; messageId: string | null }
  | { state: 'failed'; reason: ChannelTestMessageFailure }

/** 测试消息的正文上限：够放一句话与时刻，又不至于让用户把整段文档推进来。 */
export const CHANNEL_TEST_MESSAGE_MAX_LENGTH = 500

/** 通道层回执 → 给读者的三种话。`unknown-after-send` 单独一档，不写成失败（手机很可能收到了）。 */
export function toTestMessageReceipt(result: ChannelDeliveryResult): ChannelTestMessageReceipt {
  if (result.status === 'delivered') return { state: 'accepted', messageId: result.attemptId }
  if (result.status === 'unknown-after-send') return { state: 'unconfirmed', messageId: result.attemptId }
  return { state: 'failed', reason: 'rejected' }
}

export async function sendChannelTestMessage(
  deps: { channels: ChannelTargetView; deliver: (request: ChannelDeliveryRequest) => Promise<ChannelDeliveryResult> },
  input: { channelId: string; text: string; sourceId: string }
): Promise<ChannelTestMessageReceipt> {
  const resolved = resolveDeliveryTarget(deps.channels, input.channelId, { allowFallback: true })
  if (resolved.ok && resolved.source === 'fallback') {
    // 读者没绑定过：这次推断出来的目标**回写**成绑定，下次不必再推断。
    try { deps.channels.bindDeliveryTarget?.({ channelId: resolved.channelId, conversationId: resolved.conversationId }) } catch {}
  }
  if (!resolved.ok) {
    return {
      state: 'failed',
      reason: resolved.reason === 'ambiguous' ? 'ambiguous-target' : resolved.reason
    }
  }
  const result = await deps.deliver({
    channelId: resolved.channelId,
    agentId: resolved.agentId,
    conversationId: resolved.conversationId,
    // 测试消息是平台发给读者的一条通知，不是任务结果、也不是入站回复的续答。
    source: 'agent-notify',
    // 每次点都该真发一次：幂等键带时间，同一条消息连点不会被通道侧折叠掉。
    sourceId: input.sourceId,
    text: input.text
  })
  return toTestMessageReceipt(result)
}

/**
 * 服务层用的装配：把「这一条发给谁」交给唯一的目标解析，把「能不能发」交给注入的投递服务。
 * `deliver` 为空说明组合根没接投递（或没起运行时），这一档回执写 `not-ready`，不假装发过。
 */
export function createChannelTestMessageSender(deps: {
  channels: () => ChannelTargetView
  deliver: () => { deliver(request: ChannelDeliveryRequest): Promise<ChannelDeliveryResult> } | undefined
  now: () => string
}) {
  return async function sendTestMessage(input: { channelId: string; text: unknown }): Promise<ChannelTestMessageReceipt> {
    const text = typeof input.text === 'string' ? input.text.trim() : ''
    if (text.length === 0 || text.length > CHANNEL_TEST_MESSAGE_MAX_LENGTH) throw new Error('channel-input-invalid')
    const delivery = deps.deliver()
    if (delivery === undefined) return { state: 'failed', reason: 'not-ready' }
    return sendChannelTestMessage(
      { channels: deps.channels(), deliver: (request) => delivery.deliver(request) },
      { channelId: input.channelId, text, sourceId: `channel-test:${deps.now()}` }
    )
  }
}
