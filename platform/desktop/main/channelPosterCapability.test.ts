import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { ChannelDeliveryTransportRouter } from '../../ai/agent-platform/channels/ChannelDeliveryTransportRouter'
import type {
  ChannelDeliveryTransport,
  ChannelDeliveryTransportResult,
  ChannelImageTransport
} from '../../ai/agent-platform/channels/ChannelDeliveryContracts'
import { QqApiClient } from '../../ai/agent-platform/channels/qq/QqApiClient'
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

/**
 * 图片能力还要看**这条通道绑定的会话是什么种类**（0.4.4 补齐，Chief 2026-11-19 批）。
 *
 * QQ 的频道（guild）没有素材上传接口：同一条通道，绑到单聊能发图，绑到频道就不能。旧判据只看
 * 「通道 + 连接」，于是绑到频道的通道会被画成能发图、点了却报 `delivery-image-unsupported`——
 * 本该按设计走文字。判据在路由器收窄，适配器自己声明哪几类会话能承载图片。
 *
 * 这里用**真实的 `QqDeliveryTransport`** 做 sendImage 与会话种类声明，只把「开关开着且已连上」
 * 换成一个等价的能力替身：否则这条判据会被常量挡在前面，测不到会话种类那一档。
 */
const PNG_CAPABILITY = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0])
const EDITION_CAPABILITY = { date: '2026-11-19', periodId: 'default', locale: 'zh-CN' }

const fakeQqFetch = (async (input: RequestInfo | URL) => {
  const url = String(input)
  if (url.includes('media-images/prepare')) {
    return new Response(JSON.stringify({ upload_id: 'upload-1', presigned_url: 'https://cos.test/put/1' }), { status: 200 })
  }
  if (url === 'https://cos.test/put/1') return new Response('', { status: 200 })
  if (url.includes('media-images/complete')) {
    return new Response(JSON.stringify({ url: 'qqbot-media://image/v1/token-1', ttl: 7_776_000 }), { status: 200 })
  }
  return new Response(JSON.stringify({ id: 'm-1' }), { status: 200 })
}) as typeof fetch

function guildHarness(
  kindOf: Readonly<Record<string, 'direct' | 'group' | 'channel'>>,
  /** 只知道它存在、判不出绑定目标种类的通道（`targetKindForChannel` 回 null）。 */
  unbound: readonly string[] = []
) {
  const textOnly: ChannelDeliveryTransport = { send: async () => ({ kind: 'delivered' }), supportsIdempotency: () => false }
  const realQq = new QqDeliveryTransport()
  // 每一条通道都当成「已连上」：真实适配器的客户端表按通道 id 存。
  for (const channelId of [...Object.keys(kindOf), ...unbound]) {
    realQq.setClient(channelId, new QqApiClient({ getPlatformFetch: () => fakeQqFetch, token: async () => 'access-token' }), {
      isCurrent: () => true,
      signal: new AbortController().signal
    })
  }
  // 「开关开着、连接正常」的等价物：能力本身为真，只剩「会话种类」这一档参与判定。
  const connectedQq: ChannelDeliveryTransport & ChannelImageTransport = {
    send: (input) => realQq.send(input),
    supportsIdempotency: () => false,
    supportsImage: () => true,
    // 不在这里复制一份 QQ 的条件：接它自己那一份声明。
    supportsImageForConversationKind: (kind) => realQq.supportsImageForConversationKind(kind),
    sendImage: (input) => realQq.sendImage(input)
  }
  const router = new ChannelDeliveryTransportRouter({
    typeForChannel: (channelId) => (channelId.startsWith('qq-') ? 'qq' : null),
    targetKindForChannel: (channelId) => kindOf[channelId] ?? null,
    telegram: textOnly,
    slack: textOnly,
    lark: textOnly,
    qq: connectedQq,
    discord: textOnly,
    wechat: textOnly
  })

  const channels: PosterChannel[] = [...Object.keys(kindOf), ...unbound].map((id) => ({
    id, name: id, agentId: 'agent-a', state: 'runtime-ready', supportsImage: router.supportsImage(id)
  }))
  const image: string[] = []
  const text: string[] = []
  const send = createChannelPosterSend({
    listChannels: () => channels,
    readPoster: async () => ({ ok: true, bytes: PNG_CAPABILITY, mime: 'image/png', record: {} as never }),
    deliverImageToEnabledTargets: async (input) => {
      image.push(input.channelId)
      // 真正问一次适配器：频道那一路由 QQ 自己拒（`delivery-image-unsupported`），不是测试编的。
      const result: ChannelDeliveryTransportResult = await router.sendImage({
        channelId: input.channelId,
        providerConversationKey: `qq:conversation:${kindOf[input.channelId]}:peer-1`,
        image: input.image,
        caption: input.caption,
        idempotencyKey: 'channel-delivery:test'
      })
      return [result.kind === 'delivered'
        ? { status: 'delivered' as const, attemptId: 'attempt', errorCode: null }
        : {
            status: result.kind === 'unknown-after-send' ? 'unknown-after-send' as const : 'failed' as const,
            attemptId: 'attempt',
            errorCode: result.kind === 'failed' ? result.code : null
          }]
    },
    deliverTextToEnabledTargets: async (input) => {
      text.push(input.channelId)
      return [{ status: 'delivered' as const, attemptId: 'attempt', errorCode: null }]
    },
    now: () => '2026-11-19T10:00:00.000Z'
  })
  return { send, router, image, text }
}

describe('image capability is bounded by the bound conversation kind', () => {
  it('declares that QQ carries an image to a direct chat or a group, never to a channel', () => {
    const qq = new QqDeliveryTransport()
    expect(['direct', 'group', 'channel'].map((kind) => qq.supportsImageForConversationKind(kind as 'direct' | 'group' | 'channel')))
      .toEqual([true, true, false])
  })

  it('reports no image capability for a channel bound to a guild conversation, and keeps the others', () => {
    const { router } = guildHarness({ 'qq-direct': 'direct', 'qq-group': 'group', 'qq-guild': 'channel' }, ['qq-unbound'])
    expect(router.supportsImage('qq-direct')).toBe(true)
    expect(router.supportsImage('qq-group')).toBe(true)
    expect(router.supportsImage('qq-guild')).toBe(false)
    // 判不出绑定的会话种类 → 不改变现状：按适配器声明走（宁可按能发处理，也不凭空把能力关掉）。
    expect(router.supportsImage('qq-unbound')).toBe(true)
  })

  it('publishes the poster as plain text to a guild-bound channel instead of failing on the image', async () => {
    const kinds = { 'qq-direct': 'direct', 'qq-guild': 'channel' } as const
    const { send, image, text } = guildHarness(kinds)
    const result = await send.publish({ recordId: 'record-1', edition: EDITION_CAPABILITY, caption: '今日导读' })

    // 绑到频道的通道走文字：**不**产生图片尝试，也就没有 `delivery-image-unsupported` 这一行。
    expect(image).toEqual(['qq-direct'])
    expect(text).toEqual(['qq-guild'])
    expect(result.channels.map((entry) => [entry.channelId, entry.kind, entry.state])).toEqual([
      ['qq-direct', 'image', 'sent-accepted'],
      ['qq-guild', 'text', 'sent-accepted']
    ])
    expect(result.channels.map((entry) => entry.reason ?? null)).toEqual([null, null])
    expect(result.state).toBe('sent-accepted')
  })
})
