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
  conversations?: ReadonlyArray<{ id: string; targetEnabled: boolean; hasBoundSession: boolean }>
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
    listConversations: () => (options.conversations ?? [{ id: 'conversation-1', targetEnabled: true, hasBoundSession: true }]) as never
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

    expect(receipt).toEqual({ state: 'accepted', messageId: 'attempt-1' })
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
      .toEqual({ state: 'unconfirmed', messageId: 'attempt-2' })
  })

  it('reports a channel rejection without inventing a success', async () => {
    const { deps } = harness({ result: { status: 'failed', attemptId: 'attempt-3', errorCode: 'delivery-rate-limited' } })
    expect(await sendChannelTestMessage(deps, { channelId: 'channel-a', text: '测试消息', sourceId: 'x' }))
      .toEqual({ state: 'failed', reason: 'rejected' })
  })

  it('does not call the channel when there is no single target', async () => {
    const none = harness({ viewOptions: { conversations: [] } })
    expect(await sendChannelTestMessage(none.deps, { channelId: 'channel-a', text: 't', sourceId: 'x' }))
      .toEqual({ state: 'failed', reason: 'no-target' })
    expect(none.requests).toHaveLength(0)

    const many = harness({
      viewOptions: {
        conversations: [
          { id: 'conversation-1', targetEnabled: true, hasBoundSession: true },
          { id: 'conversation-2', targetEnabled: true, hasBoundSession: true }
        ]
      }
    })
    expect(await sendChannelTestMessage(many.deps, { channelId: 'channel-a', text: 't', sourceId: 'x' }))
      .toEqual({ state: 'failed', reason: 'ambiguous-target' })
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
    expect(toTestMessageReceipt({ status: 'delivered', attemptId: 'a', errorCode: null })).toEqual({ state: 'accepted', messageId: 'a' })
    expect(toTestMessageReceipt({ status: 'unknown-after-send', attemptId: 'b', errorCode: null })).toEqual({ state: 'unconfirmed', messageId: 'b' })
    for (const status of ['failed', 'skipped', 'pending', 'sending'] as const) {
      expect(toTestMessageReceipt({ status, attemptId: null, errorCode: null })).toEqual({ state: 'failed', reason: 'rejected' })
    }
  })

  it('bounds the text it will send', () => {
    expect(CHANNEL_TEST_MESSAGE_MAX_LENGTH).toBe(500)
  })
})
