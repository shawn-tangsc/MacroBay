import { describe, expect, it, vi } from 'vitest'

import {
  channelImageBareSourceId,
  channelImageSourceId,
  type ChannelDeliveryResult,
  type ChannelImageDeliveryRequest
} from '../../ai/agent-platform/channels/ChannelDeliveryContracts'
import type { ChannelImageSourceRequest, ChannelImageSourceResult } from './channelImageSource'
import { createChannelImageSend, type ChannelImageSendChannel } from './channelImageSend'

/**
 * 图片出站按通道分发（多通道方案 §4b 定稿 A：发到**所有**已启用且支持图片的通道）。
 *
 * 要钉住的四件事：
 * - 只给「可发图」的通道各产生一条尝试；不支持图片的通道不产生尝试、不算失败；
 * - **字节只读一次**（`resolveImage` 一次），同一份字节交给每条通道；
 * - 聚合复用通知那套四档规则：一条失败就不许报 `sent-accepted`；
 * - ≥2 条 ready 不再被说成「宿主不可用」（`delivery-host-unavailable` 只表示拿不到，不表示没配）。
 */
const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47])

const ready = (id: string, patch: Partial<ChannelImageSendChannel> = {}): ChannelImageSendChannel => ({
  id, agentId: 'agent-a', state: 'runtime-ready', supportsImage: true, ...patch
})

function deps(options: {
  channels?: ChannelImageSendChannel[]
  resolve?: ChannelImageSourceResult
  outcomes?: Record<string, ChannelDeliveryResult[]>
} = {}) {
  const deliverImageToEnabledTargets = vi.fn(
    async (input: Omit<ChannelImageDeliveryRequest, 'conversationId'>): Promise<ChannelDeliveryResult[]> =>
      options.outcomes?.[input.channelId] ?? [{ status: 'delivered', attemptId: `attempt-${input.channelId}`, errorCode: null }]
  )
  const resolveImage = vi.fn(async (_input: ChannelImageSourceRequest): Promise<ChannelImageSourceResult> =>
    options.resolve ?? { ok: true, mime: 'image/png', bytes: pngBytes })
  const send = createChannelImageSend({
    listChannels: () => options.channels ?? [ready('channel-a')],
    resolveImage,
    deliverImageToEnabledTargets,
    captionFor: () => '日报'
  })
  return { send, deliverImageToEnabledTargets, resolveImage }
}

describe('send an assistant image to every image-capable channel', () => {
  it('sends one attempt per image-capable channel and reads the bytes once', async () => {
    const { send, deliverImageToEnabledTargets, resolveImage } = deps({
      channels: [ready('channel-a'), ready('channel-b')]
    })

    await expect(send.send({ messageId: 'm1', fileName: 'a.png' })).resolves.toMatchObject({
      ok: true,
      state: 'sent-accepted',
      code: null
    })

    // 两条尝试、每条一次投递调用；**字节只读一次**（读盘在循环外）。
    expect(deliverImageToEnabledTargets).toHaveBeenCalledTimes(2)
    expect(deliverImageToEnabledTargets.mock.calls.map((call) => call[0]?.channelId)).toEqual(['channel-a', 'channel-b'])
    expect(resolveImage).toHaveBeenCalledTimes(1)
    const firstBytes = deliverImageToEnabledTargets.mock.calls[0]?.[0]?.image.bytes
    const secondBytes = deliverImageToEnabledTargets.mock.calls[1]?.[0]?.image.bytes
    // 同一个 Uint8Array 复用给每条通道（每通道读一遍盘的实现会在这里红）。
    expect(firstBytes).toBe(secondBytes)
  })

  it('skips channels that declare no image support instead of calling them a failure', async () => {
    const { send, deliverImageToEnabledTargets } = deps({
      channels: [ready('channel-a'), ready('channel-b', { supportsImage: false })]
    })

    const result = await send.send({ messageId: 'm1', fileName: 'a.png' })
    expect(result.state).toBe('sent-accepted')
    expect(result.channels.map((channel) => channel.channelId)).toEqual(['channel-a'])
    expect(deliverImageToEnabledTargets).toHaveBeenCalledTimes(1)
  })

  it('does not use host-unavailable when there is simply no image-capable channel', async () => {
    const { send, deliverImageToEnabledTargets, resolveImage } = deps({
      channels: [ready('channel-a', { supportsImage: false }), ready('channel-b', { state: 'disabled', supportsImage: false })]
    })

    const result = await send.send({ messageId: 'm1', fileName: 'a.png' })
    // 配置事实，不是宿主故障；也不读盘、不产生任何尝试。
    expect(result).toMatchObject({ ok: false, state: 'failed', code: 'delivery-no-target-bound', channels: [] })
    expect(result.code).not.toBe('delivery-host-unavailable')
    expect(deliverImageToEnabledTargets).not.toHaveBeenCalled()
    expect(resolveImage).not.toHaveBeenCalled()
  })

  it('never reports sent-accepted when one channel failed', async () => {
    const { send } = deps({
      channels: [ready('channel-a'), ready('channel-b')],
      outcomes: {
        'channel-a': [{ status: 'delivered', attemptId: 'a', errorCode: null }],
        'channel-b': [{ status: 'failed', attemptId: 'b', errorCode: 'delivery-provider-rejected' }]
      }
    })

    const result = await send.send({ messageId: 'm1', fileName: 'a.png' })
    // 一成一败：聚合是 failed；总括原因只在全败时给，逐条原因在 channels 里。
    expect(result.state).toBe('failed')
    expect(result.code).toBeNull()
    expect(result.channels).toEqual([
      { channelId: 'channel-a', state: 'sent-accepted' },
      { channelId: 'channel-b', state: 'failed', code: 'delivery-provider-rejected' }
    ])
  })

  it('keeps a channel without a bound agent from taking down the other one', async () => {
    const { send, deliverImageToEnabledTargets } = deps({
      channels: [ready('channel-a'), ready('channel-b', { agentId: null })]
    })

    const result = await send.send({ messageId: 'm1', fileName: 'a.png' })
    expect(result.state).toBe('failed')
    expect(result.channels).toContainEqual({ channelId: 'channel-b', state: 'failed', code: 'delivery-no-target-bound' })
    expect(deliverImageToEnabledTargets).toHaveBeenCalledTimes(1)
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

  it('passes a source refusal through without reading twice or calling delivery', async () => {
    const { send, deliverImageToEnabledTargets, resolveImage } = deps({
      channels: [ready('channel-a'), ready('channel-b')],
      resolve: { ok: false, code: 'delivery-image-source-not-allowed', detail: 'role=user' }
    })
    await expect(send.send({ messageId: 'm1', fileName: 'a.png' }))
      .resolves.toMatchObject({ ok: false, code: 'delivery-image-source-not-allowed', detail: 'role=user' })
    expect(deliverImageToEnabledTargets).not.toHaveBeenCalled()
    // 来源被拒：读一次就停，不按通道重试。
    expect(resolveImage).toHaveBeenCalledTimes(1)
  })
})
