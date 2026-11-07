import { describe, expect, it } from 'vitest'

import type { ChannelDeliveryRequest, ChannelDeliveryResult } from './ChannelDeliveryContracts'
import {
  CHANNEL_TEST_MESSAGE_MAX_LENGTH,
  sendChannelTestMessage,
  toTestMessageReceipt
} from './channelTestMessage'
import type { ChannelTargetView } from './channelDeliveryTargetResolution'

function view(options: {
  deliverable?: boolean
  reason?: 'no-enabled-target' | 'not-enabled'
  conversations?: ReadonlyArray<{ id: string; targetEnabled: boolean; hasBoundSession: boolean; sessionTitle?: string | null }>
} = {}): ChannelTargetView {
  return {
    list: () => [{ id: 'channel-a', agentId: 'agent-a' } as never],
    listDeliveryTargets: () => ({
      channels: [{
        id: 'channel-a',
        name: 'Telegram',
        deliverable: options.deliverable ?? true,
        reason: options.reason ?? null,
        target: { kind: 'bound', conversationKind: 'direct' }
      } as never]
    }),
    listConversations: () => (options.conversations ?? [
      { id: 'conversation-1', targetEnabled: true, hasBoundSession: true, sessionTitle: 'Telegram · 贾维斯' }
    ]) as never
  }
}

function harness(options: { result?: ChannelDeliveryResult; throws?: boolean; viewOptions?: Parameters<typeof view>[0] } = {}) {
  const requests: ChannelDeliveryRequest[] = []
  return {
    requests,
    deps: {
      channels: view(options.viewOptions),
      deliver: async (request: ChannelDeliveryRequest): Promise<ChannelDeliveryResult> => {
        requests.push(request)
        if (options.throws) throw new Error('transport exploded')
        return options.result ?? { status: 'delivered', attemptId: 'attempt-1', errorCode: null }
      }
    }
  }
}

describe('channel test message', () => {
  it('sends one text to the single bound target and reports that the channel accepted it', async () => {
    const { deps, requests } = harness()
    const receipt = await sendChannelTestMessage(deps, { channelId: 'channel-a', text: '测试消息', sourceId: 'channel-test:1' })

    // 回执带「发给谁」的**会话名**（不是 chat_id、不是频道 id）。
    expect(receipt).toEqual({ state: 'accepted', messageId: 'attempt-1', targetName: 'Telegram · 贾维斯' })
    expect(requests).toHaveLength(1)
    expect(requests[0]).toMatchObject({
      channelId: 'channel-a',
      agentId: 'agent-a',
      conversationId: 'conversation-1',
      source: 'agent-notify',
      sourceId: 'channel-test:1',
      text: '测试消息'
    })
  })

  it('keeps "handed over but not confirmed" out of the failed state', async () => {
    const { deps } = harness({ result: { status: 'unknown-after-send', attemptId: 'attempt-2', errorCode: 'delivery-transport-unknown' } })
    expect(await sendChannelTestMessage(deps, { channelId: 'channel-a', text: '测试消息', sourceId: 'x' }))
      .toEqual({ state: 'unconfirmed', messageId: 'attempt-2', targetName: 'Telegram · 贾维斯' })
  })

  it('reports a channel rejection without inventing a success', async () => {
    const { deps } = harness({ result: { status: 'failed', attemptId: 'attempt-3', errorCode: 'delivery-rate-limited' } })
    expect(await sendChannelTestMessage(deps, { channelId: 'channel-a', text: '测试消息', sourceId: 'x' }))
      .toEqual({ state: 'failed', reason: 'rejected' })
  })

  it('falls back to a null name when the session has no title yet', async () => {
    const { deps } = harness({
      viewOptions: { conversations: [{ id: 'conversation-1', targetEnabled: true, hasBoundSession: true, sessionTitle: null }] }
    })
    expect(await sendChannelTestMessage(deps, { channelId: 'channel-a', text: 't', sourceId: 'x' }))
      .toEqual({ state: 'accepted', messageId: 'attempt-1', targetName: null })
  })

  it('names the bound conversation when exactly one target is bound', async () => {
    const { deps } = harness({
      viewOptions: {
        conversations: [
          { id: 'conversation-bound', targetEnabled: true, hasBoundSession: true, sessionTitle: 'Telegram · 张三' }
        ]
      }
    })
    expect(await sendChannelTestMessage(deps, { channelId: 'channel-a', text: 't', sourceId: 'x' }))
      .toMatchObject({ state: 'accepted', targetName: 'Telegram · 张三' })
  })

  it('does not call the channel when there is no single target', async () => {
    const none = harness({ viewOptions: { conversations: [] } })
    expect(await sendChannelTestMessage(none.deps, { channelId: 'channel-a', text: 't', sourceId: 'x' }))
      .toEqual({ state: 'failed', reason: 'no-target' })
    expect(none.requests).toHaveLength(0)

    // 多个目标时**拒绝**（兜底已按技术方案 §1 删除）：不许按「最近活跃」猜一条发出去。
    const many = harness({
      viewOptions: {
        conversations: [
          { id: 'conversation-recent', targetEnabled: true, hasBoundSession: true },
          { id: 'conversation-older', targetEnabled: true, hasBoundSession: true }
        ]
      }
    })
    expect(await sendChannelTestMessage(many.deps, { channelId: 'channel-a', text: 't', sourceId: 'x' }))
      .toEqual({ state: 'failed', reason: 'ambiguous-target' })
    // 一条都不许发出去：猜一条发成功，才是这个按钮最坏的答案。
    expect(many.requests).toHaveLength(0)
  })

  it('separates an unbound channel from a channel that is not ready', async () => {
    const unbound = harness({ viewOptions: { deliverable: false, reason: 'no-enabled-target' } })
    expect(await sendChannelTestMessage(unbound.deps, { channelId: 'channel-a', text: 't', sourceId: 'x' }))
      .toEqual({ state: 'failed', reason: 'no-target' })

    const notEnabled = harness({ viewOptions: { deliverable: false, reason: 'not-enabled' } })
    expect(await sendChannelTestMessage(notEnabled.deps, { channelId: 'channel-a', text: 't', sourceId: 'x' }))
      .toEqual({ state: 'failed', reason: 'not-ready' })
  })

  it('maps the channel result to exactly three receipts and never claims delivery', () => {
    expect(toTestMessageReceipt({ status: 'delivered', attemptId: 'a', errorCode: null }, 'Telegram · 8768'))
      .toEqual({ state: 'accepted', messageId: 'a', targetName: 'Telegram · 8768' })
    // 读不到名字时给 null（界面回退到平台名），**不许编**。
    expect(toTestMessageReceipt({ status: 'unknown-after-send', attemptId: 'b', errorCode: null }))
      .toEqual({ state: 'unconfirmed', messageId: 'b', targetName: null })
    for (const status of ['failed', 'skipped', 'pending', 'sending'] as const) {
      expect(toTestMessageReceipt({ status, attemptId: null, errorCode: null })).toEqual({ state: 'failed', reason: 'rejected' })
    }
  })

  it('bounds the text it will send', () => {
    expect(CHANNEL_TEST_MESSAGE_MAX_LENGTH).toBe(500)
  })
})
