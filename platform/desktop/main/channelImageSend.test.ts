import { describe, expect, it, vi } from 'vitest'

import {
  channelImageBareSourceId,
  channelImageSourceId,
  type ChannelDeliveryResult,
  type ChannelImageDeliveryRequest
} from '../../ai/agent-platform/channels/ChannelDeliveryContracts'
import type { ChannelImageSourceResult } from './channelImageSource'
import { createChannelImageSend } from './channelImageSend'

function deps(options: {
  channels?: Array<{ id: string; agentId: string | null; state: string }>
  resolve?: ChannelImageSourceResult
  outcomes?: ChannelDeliveryResult[]
} = {}) {
  const deliverImageToEnabledTargets = vi.fn(
    async (_input: Omit<ChannelImageDeliveryRequest, 'conversationId'>): Promise<ChannelDeliveryResult[]> =>
      options.outcomes ?? [{ status: 'delivered', attemptId: 'a', errorCode: null }]
  )
  const send = createChannelImageSend({
    listChannels: () => options.channels ?? [{ id: 'channel-a', agentId: 'agent-a', state: 'runtime-ready' }],
    resolveImage: vi.fn(async (_input: { messageId: string; fileName: string }): Promise<ChannelImageSourceResult> =>
      options.resolve ?? { ok: true, mime: 'image/png', bytes: new Uint8Array([0x89, 0x50]) }),
    deliverImageToEnabledTargets,
    captionFor: () => '日报'
  })
  return { send, deliverImageToEnabledTargets }
}

describe('send an assistant image to the channel', () => {
  it('refuses when no channel is runtime-ready, without reading the image', async () => {
    const { send, deliverImageToEnabledTargets } = deps({ channels: [{ id: 'channel-a', agentId: 'agent-a', state: 'disabled' }] })
    await expect(send.send({ messageId: 'm1', fileName: 'a.png' }))
      .resolves.toMatchObject({ ok: false, code: 'delivery-host-unavailable' })
    expect(deliverImageToEnabledTargets).not.toHaveBeenCalled()
  })

  it('uses the image key with a caption, and the bare key without one', async () => {
    const withCaption = deps()
    await withCaption.send.send({ messageId: 'm1', fileName: 'a.png' })
    expect(withCaption.deliverImageToEnabledTargets.mock.calls[0]?.[0]).toMatchObject({
      channelId: 'channel-a', agentId: 'agent-a', caption: '日报', sourceId: channelImageSourceId('m1')
    })

    // 「只发图片」是**第三个键**，不是重试那条 caption 失败的行；两次互不覆盖。
    const bare = deps()
    await bare.send.send({ messageId: 'm1', fileName: 'a.png', withoutCaption: true })
    expect(bare.deliverImageToEnabledTargets.mock.calls[0]?.[0]).toMatchObject({
      caption: '', sourceId: channelImageBareSourceId('m1')
    })
    expect(channelImageBareSourceId('m1')).not.toBe(channelImageSourceId('m1'))
  })

  it('passes a source refusal through without calling delivery', async () => {
    const { send, deliverImageToEnabledTargets } = deps({
      resolve: { ok: false, code: 'delivery-image-source-not-allowed', detail: 'role=user' }
    })
    await expect(send.send({ messageId: 'm1', fileName: 'a.png' }))
      .resolves.toMatchObject({ ok: false, code: 'delivery-image-source-not-allowed', detail: 'role=user' })
    expect(deliverImageToEnabledTargets).not.toHaveBeenCalled()
  })
})
