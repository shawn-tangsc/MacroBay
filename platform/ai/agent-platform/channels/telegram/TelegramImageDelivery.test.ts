import { describe, expect, it, vi } from 'vitest'

import { ChannelDeliveryTransportRouter } from '../ChannelDeliveryTransportRouter'
import type { ChannelDeliveryTransport } from '../ChannelDeliveryContracts'
import { TelegramApiClient } from './TelegramApiClient'
import { TelegramDeliveryTransport } from './TelegramDeliveryTransport'

/**
 * 出站图片第一站：Telegram `sendPhoto`（multipart）+ 路由同时实现两个接口。
 *
 * 三件事要钉住：
 * - 字节作为 `photo` 部分发出去，caption 与图**同一条消息**；
 * - caption 的 Markdown 回落与文本同一套（上游拒了就整条以纯文本重发一次，不是第二条消息）；
 * - 路由只有一张表：支持的平台才为真，其余给 `delivery-image-unsupported`，不是 `host-unavailable`。
 */

function pngBytes(size = 32): Uint8Array {
  const value = new Uint8Array(size)
  value.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  return value
}

type Call = { url: string; form: FormData | null; body: unknown }

function fakeFetch(responses: Array<{ status: number; body: unknown }>) {
  const calls: Call[] = []
  let index = 0
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const form = typeof FormData !== 'undefined' && init?.body instanceof FormData ? init.body : null
    calls.push({ url: String(input), form, body: init?.body })
    const next = responses[Math.min(index, responses.length - 1)]
    index += 1
    return new Response(JSON.stringify(next.body), { status: next.status, headers: { 'content-type': 'application/json' } })
  }) as typeof fetch
  return { fetch: fetchImpl, calls }
}

function transportWith(fetchImpl: typeof fetch, current = true) {
  const transport = new TelegramDeliveryTransport()
  const controller = new AbortController()
  transport.setClient('channel-a', new TelegramApiClient({ getPlatformFetch: () => fetchImpl, token: async () => '8830:secret' }), {
    isCurrent: () => current,
    signal: controller.signal
  })
  return { transport, controller }
}

function imageInput(caption = '日报 *重点*') {
  return {
    channelId: 'channel-a',
    providerConversationKey: 'telegram:chat:819234567',
    image: { mime: 'image/png', bytes: pngBytes() },
    caption,
    idempotencyKey: 'channel-delivery:test'
  }
}

describe('telegram sendPhoto', () => {
  it('posts the bytes as a photo part with the caption in the same message', async () => {
    const { fetch, calls } = fakeFetch([{ status: 200, body: { ok: true, result: { message_id: 4242 } } }])
    const { transport } = transportWith(fetch)

    expect(transport.supportsImage('channel-a')).toBe(true)
    const result = await transport.sendImage(imageInput())

    expect(result).toEqual({ kind: 'delivered', detail: '{"telegramMessageId":4242}' })
    expect(calls[0].url).toContain('/sendPhoto')
    const form = calls[0].form
    expect(form).not.toBeNull()
    expect(form?.get('chat_id')).toBe('819234567')
    expect(form?.get('caption')).toBe('日报 *重点*')
    expect(form?.get('parse_mode')).toBe('MarkdownV2')
    const photo = form?.get('photo')
    expect(photo).toBeInstanceOf(Blob)
    expect((photo as Blob).type).toBe('image/png')
    expect((photo as Blob).size).toBe(pngBytes().byteLength)
  })

  it('falls back to plain text once when Telegram rejects the caption markdown', async () => {
    const { fetch, calls } = fakeFetch([
      { status: 400, body: { ok: false, error_code: 400, description: "Bad Request: can't parse entities" } },
      { status: 200, body: { ok: true, result: { message_id: 4243 } } }
    ])
    const { transport } = transportWith(fetch)

    await expect(transport.sendImage(imageInput('日报 *重点*'))).resolves.toMatchObject({ kind: 'delivered' })
    expect(calls).toHaveLength(2)
    // 同一条消息重发一次，不是两条；第二条不带 parse_mode。
    expect(calls[1].form?.get('parse_mode')).toBeNull()
    expect(calls[1].form?.get('caption')).toBe('日报 *重点*')
  })

  it('maps rate limiting and aborted ownership the same way text does', async () => {
    const limited = fakeFetch([{ status: 429, body: { ok: false, parameters: { retry_after: 3 } } }])
    await expect(transportWith(limited.fetch).transport.sendImage(imageInput())).resolves.toMatchObject({
      kind: 'failed', code: 'delivery-rate-limited'
    })

    const gone = transportWith(fakeFetch([{ status: 200, body: { ok: true, result: {} } }]).fetch, false)
    expect(gone.transport.supportsImage('channel-a')).toBe(false)
    await expect(gone.transport.sendImage(imageInput())).resolves.toEqual({ kind: 'failed', code: 'delivery-host-unavailable' })
  })
})

describe('delivery router with one table for both kinds', () => {
  /** 只实现文本的适配器。判据是「有没有实现 sendImage」，不是平台名——Slack 已有自己的图片用例。 */
  const textOnlyTransport: ChannelDeliveryTransport = {
    send: async () => ({ kind: 'delivered' }),
    supportsIdempotency: () => false
  }

  function router(fetchImpl: typeof fetch) {
    const { transport } = transportWith(fetchImpl)
    const routerInstance = new ChannelDeliveryTransportRouter({
      typeForChannel: (channelId) => (channelId === 'lark-a' ? 'feishu' : channelId === 'unknown-a' ? null : 'telegram'),
      telegram: transport,
      slack: textOnlyTransport,
      lark: textOnlyTransport,
      qq: textOnlyTransport,
      discord: textOnlyTransport,
      wechat: textOnlyTransport
    })
    return routerInstance
  }

  it('answers image capability per adapter and refuses text-only adapters as unsupported', async () => {
    const instance = router(fakeFetch([{ status: 200, body: { ok: true, result: { message_id: 1 } } }]).fetch)

    expect(instance.supportsImage('channel-a')).toBe(true)
    expect(instance.supportsImage('lark-a')).toBe(false)
    expect(instance.supportsImage('unknown-a')).toBe(false)
    await expect(instance.sendImage({ ...imageInput(), channelId: 'lark-a' }))
      .resolves.toEqual({ kind: 'failed', code: 'delivery-image-unsupported' })
    await expect(instance.sendImage({ ...imageInput(), channelId: 'unknown-a' }))
      .resolves.toEqual({ kind: 'failed', code: 'delivery-image-unsupported' })
  })

  it('keeps the text path on the same instance unchanged', async () => {
    const instance = router(fakeFetch([{ status: 200, body: { ok: true, result: true } }]).fetch)
    await expect(instance.send({
      channelId: 'channel-a', providerConversationKey: 'telegram:chat:819234567', text: 'hi', idempotencyKey: 'k'
    })).resolves.toEqual({ kind: 'delivered' })
    // 同一个实例同时有两个接口：这就是「不开第二张路由表」的可执行判据。
    expect(typeof instance.send).toBe('function')
    expect(typeof instance.sendImage).toBe('function')
  })
})
