import { describe, expect, it, vi } from 'vitest'

import {
  channelPosterSourceId,
  channelPosterTextSourceId,
  type ChannelDeliveryRequest,
  type ChannelDeliveryResult,
  type ChannelImageDeliveryRequest
} from '../../ai/agent-platform/channels/ChannelDeliveryContracts'
import type { ReadPosterOutcome } from '../../storage/channelPosterOutbox'
import { createChannelPosterSend, type PosterChannel } from './channelPosterSend'

/**
 * 海报发到各通道（海报方案 §5）：支持图片的走 `:poster`（图 + 导读一条），
 * 不支持的走 `:poster-text`（纯导读一条，**明示降级**）。
 *
 * 四条判据：
 * - 一条通道一条尝试，`sourceId` 只按形态分后缀、不加通道维度；
 * - 图只在发之前读一次；
 * - 逐通道结果喂同一个聚合：全成之外不许 accepted；
 * - 降级必须在 `channels[]` 里看得见（`kind:'text'`），不许静默。
 */
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0])
const EDITION = { date: '2026-11-12', periodId: 'default', locale: 'zh-CN' }

const channel = (id: string, supportsImage: boolean, patch: Partial<PosterChannel> = {}): PosterChannel => ({
  id, name: id.toUpperCase(), agentId: 'agent-a', state: 'runtime-ready', supportsImage, ...patch
})

function harness(options: {
  channels?: PosterChannel[]
  poster?: ReadPosterOutcome
  imageResult?: ChannelDeliveryResult
  textResult?: ChannelDeliveryResult
  throwsChannelId?: string
} = {}) {
  const imageCalls: Array<Omit<ChannelImageDeliveryRequest, 'conversationId'>> = []
  const textCalls: Array<Omit<ChannelDeliveryRequest, 'conversationId'>> = []
  const readPoster = vi.fn(async (): Promise<ReadPosterOutcome> => options.poster ?? { ok: true, bytes: PNG, mime: 'image/png', record: {} as never })
  const send = createChannelPosterSend({
    listChannels: () => options.channels ?? [channel('channel-a', true), channel('channel-b', false)],
    readPoster,
    deliverImageToEnabledTargets: async (input) => {
      imageCalls.push(input)
      if (options.throwsChannelId === input.channelId) throw new Error('boom')
      return [options.imageResult ?? { status: 'delivered', attemptId: 'attempt', errorCode: null }]
    },
    deliverTextToEnabledTargets: async (input) => {
      textCalls.push(input)
      if (options.throwsChannelId === input.channelId) throw new Error('boom')
      return [options.textResult ?? { status: 'delivered', attemptId: 'attempt', errorCode: null }]
    },
    now: () => '2026-11-12T12:00:00.000Z'
  })
  return { send, imageCalls, textCalls, readPoster }
}

describe('poster fan-out per channel', () => {
  it('sends an image + caption to an image channel and plain text to the others, one attempt each', async () => {
    const { send, imageCalls, textCalls, readPoster } = harness()
    const result = await send.publish({ recordId: 'record-1', edition: EDITION, caption: '今天的导读' })

    expect(result.state).toBe('sent-accepted')
    expect(result.channels.map((entry) => [entry.channelId, entry.kind])).toEqual([
      ['channel-a', 'image'],
      ['channel-b', 'text']
    ])
    // 图与导读在**同一条**消息里；文字通道只有导读、另一条产物形态。
    expect(imageCalls).toHaveLength(1)
    expect(imageCalls[0]).toMatchObject({
      channelId: 'channel-a',
      sourceId: channelPosterSourceId('record-1'),
      caption: '今天的导读',
      image: { mime: 'image/png' }
    })
    expect(textCalls).toHaveLength(1)
    expect(textCalls[0]).toMatchObject({
      channelId: 'channel-b',
      sourceId: channelPosterTextSourceId('record-1'),
      text: '今天的导读'
    })
    // 图只读一次。
    expect(readPoster).toHaveBeenCalledTimes(1)
  })

  it('sends no image and reads no poster when no channel supports images', async () => {
    const { send, imageCalls, readPoster } = harness({ channels: [channel('channel-b', false)] })
    const result = await send.publish({ recordId: 'record-1', edition: EDITION, caption: '导读' })
    expect(result.channels).toEqual([expect.objectContaining({ kind: 'text', state: 'sent-accepted' })])
    expect(imageCalls).toHaveLength(0)
    expect(readPoster).not.toHaveBeenCalled()
  })

  it('never reports accepted when one channel failed', async () => {
    const { send } = harness({ imageResult: { status: 'failed', attemptId: 'a', errorCode: 'delivery-provider-rejected' } })
    const result = await send.publish({ recordId: 'record-1', edition: EDITION, caption: '导读' })
    expect(result.state).toBe('failed')
    // 一成一败：聚合不给总括原因（逐条原因在 channels 里）。
    expect(result.code).toBeNull()
    expect(result.channels.map((entry) => entry.state)).toEqual(['failed', 'sent-accepted'])
  })

  it('keeps a single channel error from taking down the others', async () => {
    const { send } = harness({ channels: [channel('channel-a', true), channel('channel-b', false)], throwsChannelId: 'channel-a' })
    const result = await send.publish({ recordId: 'record-1', edition: EDITION, caption: '导读' })
    expect(result.channels.map((entry) => [entry.channelId, entry.state])).toEqual([
      ['channel-a', 'failed'],
      ['channel-b', 'sent-accepted']
    ])
    expect(result.state).toBe('failed')
  })

  it('sends text only when the reader chose that: no upload anywhere, and the text key is used', async () => {
    const { send, imageCalls, textCalls, readPoster } = harness()
    const result = await send.publish({
      recordId: 'record-1', edition: EDITION, caption: '导读', mode: 'text'
    })
    // 一次上传都没有，连图都不读。
    expect(imageCalls).toHaveLength(0)
    expect(readPoster).not.toHaveBeenCalled()
    // 每条通道都走纯文字，并且用 `:poster-text` 那个键（与「不支持图片的通道」同一个形态）。
    expect(textCalls).toHaveLength(2)
    expect(textCalls.every((call) => call.sourceId === channelPosterTextSourceId('record-1'))).toBe(true)
    expect(result.channels.map((entry) => entry.kind)).toEqual(['text', 'text'])
    expect(result.state).toBe('sent-accepted')
  })

  it('re-sends only the channels that are not delivered yet', async () => {
    const { send, imageCalls, textCalls, readPoster } = harness()
    const result = await send.publish({
      recordId: 'record-1',
      edition: EDITION,
      caption: '导读',
      // 上一次：图片通道已送达，文字通道失败。
      skipChannelIds: ['channel-a']
    })

    // 已送达的那条**一点都不重发**：不上传、不产生新结果行。
    expect(imageCalls).toHaveLength(0)
    expect(textCalls.map((call) => call.channelId)).toEqual(['channel-b'])
    expect(result.channels.map((entry) => [entry.channelId, entry.kind, entry.state])).toEqual([
      ['channel-b', 'text', 'sent-accepted']
    ])
    // 剩下要补的那条不支持图片：这次连图都不读（读了也没人用）。
    expect(readPoster).not.toHaveBeenCalled()
  })

  it('does nothing at all when every channel already delivered', async () => {
    const { send, imageCalls, textCalls, readPoster } = harness()
    const result = await send.publish({
      recordId: 'record-1', edition: EDITION, caption: '导读',
      skipChannelIds: ['channel-a', 'channel-b']
    })
    expect(result).toMatchObject({ ok: true, state: 'sent-accepted', channels: [] })
    expect(imageCalls).toHaveLength(0)
    expect(textCalls).toHaveLength(0)
    expect(readPoster).not.toHaveBeenCalled()
  })

  it('refuses the whole publish when the caption is over 1024 characters, before any upload', async () => {
    const { send, imageCalls, textCalls } = harness()
    const result = await send.publish({ recordId: 'record-1', edition: EDITION, caption: 'x'.repeat(1_025) })
    expect(result).toMatchObject({ ok: false, state: 'failed', code: 'delivery-caption-too-long', channels: [] })
    expect(imageCalls).toHaveLength(0)
    expect(textCalls).toHaveLength(0)
  })

  it('refuses the whole publish when the poster is gone or bound to another edition', async () => {
    for (const code of ['delivery-image-unavailable', 'delivery-image-source-not-allowed']) {
      const { send, imageCalls, textCalls } = harness({ poster: { ok: false, code: code as ReadPosterOutcome extends { ok: false; code: infer C } ? C : never, detail: 'edition-mismatch' } })
      const result = await send.publish({ recordId: 'record-1', edition: EDITION, caption: '导读' })
      expect(result).toMatchObject({ ok: false, code, channels: [] })
      // 来源不符/图不在：一次上传都不发生（连文字通道也不发——整条不发的判定在这里）。
      expect(imageCalls).toHaveLength(0)
      expect(textCalls).toHaveLength(0)
    }
  })

  it('reports a configuration fact, not a host failure, when no channel is ready', async () => {
    const { send, readPoster } = harness({ channels: [channel('channel-a', true, { state: 'disabled' })] })
    const result = await send.publish({ recordId: 'record-1', edition: EDITION, caption: '导读' })
    expect(result).toMatchObject({ ok: false, code: 'delivery-no-target-bound', channels: [] })
    expect(readPoster).not.toHaveBeenCalled()
  })
})
