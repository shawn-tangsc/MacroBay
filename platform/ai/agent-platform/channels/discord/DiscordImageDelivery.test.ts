import { describe, expect, it } from 'vitest'

import type { ChannelDeliveryTransport } from '../ChannelDeliveryContracts'
import { ChannelDeliveryTransportRouter } from '../ChannelDeliveryTransportRouter'
import { DiscordApiClient } from './DiscordApiClient'
import { DiscordDeliveryTransport } from './DiscordDeliveryTransport'

/**
 * 出站图片第三站：Discord。与 Slack 不同，它**一次 multipart 请求**就发完：
 * `POST /channels/{id}/messages`，`payload_json` 里放 caption 与附件 id，`files[0]` 放字节。
 *
 * 要钉住三件事：
 * - 字节与 caption 在同一条消息里，附件必须在 payload 里点名（只给 `files[0]` 会落成一条没有附件的消息）；
 * - 线程不是额外字段：Discord 的线程自带频道 id，同一路径已经把消息发进线程；
 * - 失败分类与文本共用一处（限流 / 上游拒绝 / 其余不知道结果），大小与格式不在这里重判。
 */

const pngBytes = (size = 32): Uint8Array => {
  const value = new Uint8Array(size)
  value.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  return value
}

type Call = { url: string; headers: Headers; form: FormData | null }

function fakeFetch(responses: Array<Response | Error>) {
  const calls: Call[] = []
  let index = 0
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      url: String(input),
      headers: new Headers(init?.headers),
      form: typeof FormData !== 'undefined' && init?.body instanceof FormData ? init.body : null
    })
    const next = responses[Math.min(index, responses.length - 1)]!
    index += 1
    if (next instanceof Error) throw next
    return next
  }) as typeof fetch
  return { fetchImpl, calls }
}

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

function transportWith(fetchImpl: typeof fetch, current = true) {
  const transport = new DiscordDeliveryTransport()
  const controller = new AbortController()
  transport.setClient(
    'discord-a',
    new DiscordApiClient({ getPlatformFetch: () => fetchImpl, token: async () => 'discord-bot-token', userAgent: 'MacroBay/test (Discord adapter)' }),
    { isCurrent: () => current, signal: controller.signal }
  )
  return { transport, controller }
}

const imageInput = (caption = '日报 *重点*', key = 'discord:conversation:guild:123456789') => ({
  channelId: 'discord-a',
  providerConversationKey: key,
  image: { mime: 'image/png', bytes: pngBytes() },
  caption,
  idempotencyKey: 'channel-delivery:test'
})

const payloadOf = (form: FormData) => JSON.parse(String(form.get('payload_json'))) as Record<string, unknown>

describe('discord single-request image send', () => {
  it('posts the bytes and the caption as one multipart message', async () => {
    const { fetchImpl, calls } = fakeFetch([json(200, { id: 'msg-1' })])
    const { transport } = transportWith(fetchImpl)

    expect(transport.supportsImage('discord-a')).toBe(true)
    await expect(transport.sendImage(imageInput())).resolves.toEqual({ kind: 'delivered' })

    expect(calls).toHaveLength(1)
    expect(calls[0]!.url).toBe('https://discord.com/api/v10/channels/123456789/messages')
    expect(calls[0]!.headers.get('authorization')).toBe('Bot discord-bot-token')
    // multipart 的 boundary 由 fetch 自己写，代码不许手写 content-type。
    expect(calls[0]!.headers.get('content-type')).toBeNull()

    const form = calls[0]!.form!
    // caption 与附件 id 在同一个 payload 里：只给 files[0] 不点名，消息会没有附件。
    expect(payloadOf(form)).toEqual({ content: '日报 *重点*', attachments: [{ id: 0, filename: 'image.png' }] })
    const file = form.get('files[0]')
    expect(file).toBeInstanceOf(Blob)
    expect((file as Blob).type).toBe('image/png')
    expect((file as File).name).toBe('image.png')
    expect((file as Blob).size).toBe(pngBytes().byteLength)
  })

  it('drops the empty caption but still names the attachment', async () => {
    const { fetchImpl, calls } = fakeFetch([json(200, { id: 'msg-2' })])
    const { transport } = transportWith(fetchImpl)

    await expect(transport.sendImage(imageInput(''))).resolves.toEqual({ kind: 'delivered' })
    expect(payloadOf(calls[0]!.form!)).toEqual({ attachments: [{ id: 0, filename: 'image.png' }] })
  })

  it('posts into a thread through its own channel id, inventing no extra field', async () => {
    const { fetchImpl, calls } = fakeFetch([json(200, { id: 'msg-3' })])
    const { transport } = transportWith(fetchImpl)

    await expect(transport.sendImage(imageInput('日报', 'discord:conversation:thread:987654321'))).resolves.toEqual({ kind: 'delivered' })
    // 线程就是那个频道：路径变、payload 不变，没有硬造的 thread 字段。
    expect(calls[0]!.url).toBe('https://discord.com/api/v10/channels/987654321/messages')
    expect(payloadOf(calls[0]!.form!)).toEqual({ content: '日报', attachments: [{ id: 0, filename: 'image.png' }] })
  })

  it('maps the same three outcomes the text path does', async () => {
    const cases: Array<[Response | Error, { kind: string; code?: string }]> = [
      [json(429, { message: 'You are being rate limited.' }), { kind: 'failed', code: 'delivery-rate-limited' }],
      [json(403, { message: 'Missing Permissions' }), { kind: 'failed', code: 'delivery-provider-rejected' }],
      [json(500, { message: 'internal' }), { kind: 'unknown-after-send' }],
      [new Error('ECONNRESET'), { kind: 'unknown-after-send' }]
    ]
    for (const [response, expected] of cases) {
      const { fetchImpl } = fakeFetch([response])
      await expect(transportWith(fetchImpl).transport.sendImage(imageInput())).resolves.toEqual(expected)
    }
  })

  it('refuses without runtime ownership and on an undecodable conversation key', async () => {
    const { fetchImpl, calls } = fakeFetch([json(200, { id: 'msg-4' })])
    const gone = transportWith(fetchImpl, false)
    expect(gone.transport.supportsImage('discord-a')).toBe(false)
    await expect(gone.transport.sendImage(imageInput())).resolves.toEqual({ kind: 'failed', code: 'delivery-host-unavailable' })

    const live = transportWith(fetchImpl)
    await expect(live.transport.sendImage(imageInput('日报', 'discord:conversation:guild:not valid'))).resolves.toEqual({
      kind: 'failed', code: 'delivery-provider-rejected'
    })
    expect(calls).toHaveLength(0)
  })
})

describe('router with the real Discord adapter', () => {
  /** 只实现文本的适配器：路由的判据是「有没有实现 sendImage」，不是平台名。 */
  const textOnly: ChannelDeliveryTransport = {
    send: async () => ({ kind: 'delivered' }),
    supportsIdempotency: () => false
  }

  it('counts Discord as image-capable and keeps text-only adapters unsupported', async () => {
    const { fetchImpl } = fakeFetch([json(200, { id: 'msg-5' })])
    const instance = new ChannelDeliveryTransportRouter({
      typeForChannel: (channelId) => (channelId === 'discord-a' ? 'discord' : channelId === 'qq-a' ? 'qq' : null),
      telegram: textOnly,
      slack: textOnly,
      lark: textOnly,
      qq: textOnly,
      discord: transportWith(fetchImpl).transport,
      wechat: textOnly
    })

    expect(instance.supportsImage('discord-a')).toBe(true)
    expect(instance.supportsImage('qq-a')).toBe(false)
    await expect(instance.sendImage({ ...imageInput(), channelId: 'discord-a' })).resolves.toEqual({ kind: 'delivered' })
    await expect(instance.sendImage({ ...imageInput(), channelId: 'qq-a' }))
      .resolves.toEqual({ kind: 'failed', code: 'delivery-image-unsupported' })
    // 同一个实例、同一个平台：文本接口没被图片接口顶掉。
    await expect(instance.send({ channelId: 'discord-a', providerConversationKey: 'discord:conversation:guild:123456789', text: 'hi', idempotencyKey: 'k' }))
      .resolves.toEqual({ kind: 'delivered' })
  })
})
