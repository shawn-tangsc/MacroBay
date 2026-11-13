import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { ChannelDeliveryTransportRouter } from '../../ai/agent-platform/channels/ChannelDeliveryTransportRouter'
import type { ChannelDeliveryTransport } from '../../ai/agent-platform/channels/ChannelDeliveryContracts'
import { QqDeliveryTransport } from '../../ai/agent-platform/channels/qq/QqDeliveryTransport'
import { createChannelPosterSend, type PosterChannel } from './channelPosterSend'

/**
 * 「按通道能力选形态」的三条判据（QQ 第二笔）：
 *
 * 1. 支持图的走 `:poster`、不支持的走 `:poster-text`，**同一套聚合与逐通道记账**，不许为某个平台单开一条路；
 * 2. 能力只看适配器声明（`supportsImage`），**没有第二份平台名单**；
 * 3. 记录里 `kind` 写清是图还是纯文字降级。
 *
 * 这里同时钉住 QQ 当前的状态：能力开关关着 → 它被当成「发不了图」，走纯文字降级，不许画成能发图。
 */
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0])
const EDITION = { date: '2026-11-13', periodId: 'default', locale: 'zh-CN' }

const channel = (id: string, supportsImage: boolean): PosterChannel => ({
  id, name: id.toUpperCase(), agentId: 'agent-a', state: 'runtime-ready', supportsImage
})

const ok = [{ status: 'delivered' as const, attemptId: 'attempt', errorCode: null }]

function harness(channels: readonly PosterChannel[]) {
  const image: string[] = []
  const text: string[] = []
  const send = createChannelPosterSend({
    listChannels: () => channels,
    readPoster: async () => ({ ok: true, bytes: PNG, mime: 'image/png', record: {} as never }),
    deliverImageToEnabledTargets: async (input) => { image.push(input.channelId); return ok },
    deliverTextToEnabledTargets: async (input) => { text.push(input.channelId); return ok },
    now: () => '2026-11-13T10:00:00.000Z'
  })
  return { send, image, text }
}

describe('per-channel capability decides the form, and nothing else does', () => {
  it('sends :poster only to image-capable channels and :poster-text to the rest', async () => {
    // 同一个适配器类型：一条声明支持图，一条不支持——能力是适配器声明，不是平台名字。
    const { send, image, text } = harness([channel('channel-a', true), channel('channel-b', false)])
    const result = await send.publish({ recordId: 'record-1', edition: EDITION, caption: '导读' })

    expect(image).toEqual(['channel-a'])
    expect(text).toEqual(['channel-b'])
    // 一次调用一套聚合，逐通道记账，`kind` 写清走了哪条。
    expect(result.channels.map((entry) => [entry.channelId, entry.kind, entry.state])).toEqual([
      ['channel-a', 'image', 'sent-accepted'],
      ['channel-b', 'text', 'sent-accepted']
    ])
    expect(result.state).toBe('sent-accepted')
  })

  it('has no platform name in the sender: a second list of "who can send images" would drift', () => {
    const source = readFileSync(join(process.cwd(), 'platform/desktop/main/channelPosterSend.ts'), 'utf8')
    for (const platform of ['qq', 'telegram', 'slack', 'feishu', 'lark', 'discord', 'wechat']) {
      expect(source.toLowerCase()).not.toContain(platform)
    }
  })

  it('keeps QQ image capability closed while its switch is off, so it degrades to text', async () => {
    // 适配器实现了图片接口，但开关关着：router 的能力判定必须是 false（按钮不画、海报走文字）。
    const textOnly: ChannelDeliveryTransport = { send: async () => ({ kind: 'delivered' }), supportsIdempotency: () => false }
    const router = new ChannelDeliveryTransportRouter({
      typeForChannel: (channelId) => (channelId === 'qq-a' ? 'qq' : null),
      telegram: textOnly,
      slack: textOnly,
      lark: textOnly,
      qq: new QqDeliveryTransport(),
      discord: textOnly,
      wechat: textOnly
    })
    expect(router.supportsImage('qq-a')).toBe(false)
  })
})
