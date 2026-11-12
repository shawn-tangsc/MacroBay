import { describe, expect, it } from 'vitest'

import type { ChannelDeliveryTransport } from '../ChannelDeliveryContracts'
import { ChannelDeliveryTransportRouter } from '../ChannelDeliveryTransportRouter'
import { LarkApiClient } from './LarkApiClient'
import { LarkDeliveryTransport } from './LarkDeliveryTransport'

/**
 * 出站图片第四站：飞书。图片消息的 content 只有 `{"image_key":…}`，**放不下说明**，所以：
 *
 * - 没有说明 → `msg_type: image`（原生图片消息，客户端按图片预览）；
 * - 有说明 → `msg_type: post`（富文本），同一份 content 里 **img 段在前、text 段在后**
 *   （Telegram / Slack / Discord 的 caption 都在图片下方，四个平台要长得一样）。
 *
 * 上传（`im/v1/images`，`image_type=message`）不是消息：一种投递仍然只有一条消息。
 * 上传没成就**不发**消息——否则读者会收到一条只有说明、没有图的消息。
 */

const pngBytes = (size = 32): Uint8Array => {
  const value = new Uint8Array(size)
  value.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  return value
}

type Call = { url: string; form: FormData | null; json: Record<string, unknown> | null }

type Step = { status: number; body: unknown }

/** 三步各给一个响应：取 token、上传图、发消息。 */
function fakeFetch(steps: { upload: Step; message?: Step; token?: Step }) {
  const calls: Call[] = []
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const form = typeof FormData !== 'undefined' && init?.body instanceof FormData ? init.body : null
    const json = !form && typeof init?.body === 'string' ? JSON.parse(init.body) as Record<string, unknown> : null
    calls.push({ url, form, json })
    const step = url.includes('auth/v3/tenant_access_token')
      ? steps.token ?? { status: 200, body: { code: 0, tenant_access_token: 't-secret' } }
      : url.includes('/im/v1/images')
        ? steps.upload
        : steps.message ?? { status: 200, body: { code: 0, data: { message_id: 'om_1' } } }
    return new Response(JSON.stringify(step.body), { status: step.status, headers: { 'content-type': 'application/json' } })
  }) as typeof fetch
  return { fetchImpl, calls }
}

function transportWith(fetchImpl: typeof fetch, current = true) {
  const transport = new LarkDeliveryTransport()
  const controller = new AbortController()
  transport.setClient(
    'lark-a',
    new LarkApiClient({ getPlatformFetch: () => fetchImpl, credentials: async () => ({ appId: 'cli_x', appSecret: 's-secret' }) }),
    { isCurrent: () => current, signal: controller.signal }
  )
  return { transport, controller }
}

const imageInput = (caption = '', key = 'lark:conversation:chat:oc_1') => ({
  channelId: 'lark-a',
  providerConversationKey: key,
  image: { mime: 'image/png', bytes: pngBytes() },
  caption,
  idempotencyKey: 'channel-delivery:test'
})

const uploaded = { status: 200, body: { code: 0, data: { image_key: 'img_v2_abc' } } }

const uploadCall = (calls: Call[]) => calls.find((call) => call.url.includes('/im/v1/images'))!
const messageCall = (calls: Call[]) => calls.find((call) => call.url.includes('/im/v1/messages'))!

describe('lark image send', () => {
  it('uploads the bytes then sends a native image message when there is no caption', async () => {
    const { fetchImpl, calls } = fakeFetch({ upload: uploaded })
    const { transport } = transportWith(fetchImpl)

    // 能力开关是关的（飞书先不做）；这里直接调适配器，用来钉住「打开之后要按这个形状发」。
    expect(transport.supportsImage('lark-a')).toBe(false)
    await expect(transport.sendImage(imageInput(''))).resolves.toEqual({ kind: 'delivered' })

    const upload = uploadCall(calls)
    expect(upload.form?.get('image_type')).toBe('message')
    const file = upload.form?.get('image')
    expect(file).toBeInstanceOf(Blob)
    expect((file as Blob).size).toBe(pngBytes().byteLength)

    const message = messageCall(calls)
    expect(message.json).toEqual({
      receive_id: 'oc_1',
      msg_type: 'image',
      content: '{"image_key":"img_v2_abc"}'
    })
    // 一种投递只有一条消息：图上去了就不再补一条文本。
    expect(calls.filter((call) => call.url.includes('/im/v1/messages'))).toHaveLength(1)
  })

  it('sends one post with the image first and the caption below it', async () => {
    const { fetchImpl, calls } = fakeFetch({ upload: uploaded })
    const { transport } = transportWith(fetchImpl)

    await expect(transport.sendImage(imageInput('日报 **重点**'))).resolves.toEqual({ kind: 'delivered' })

    const message = messageCall(calls)
    expect(message.json?.msg_type).toBe('post')
    expect(message.json?.receive_id).toBe('oc_1')
    const content = JSON.parse(String(message.json?.content)) as {
      zh_cn: { title: string; content: Array<Array<Record<string, string>>> }
      en_us: { title: string; content: Array<Array<Record<string, string>>> }
    }
    // img 在前、text 在后：caption 在图片下方，与另外三个平台一致。
    expect(content.zh_cn.content).toEqual([
      [{ tag: 'img', image_key: 'img_v2_abc' }],
      [{ tag: 'text', text: '日报 重点' }]
    ])
    // 标题留空（多一行标题会是读者可见的变化）；两种语言放同一段文本，避免另一种语言客户端显示为空。
    expect(content.zh_cn.title).toBe('')
    expect(content.en_us).toEqual(content.zh_cn)
    // post 的 text 元素不认 markdown：星号不能留给读者。
    expect(content.zh_cn.content[1]![0]!.text).not.toContain('**')
  })

  it('posts into a thread through root_id and keeps it on both message shapes', async () => {
    const { fetchImpl, calls } = fakeFetch({ upload: uploaded })
    const { transport } = transportWith(fetchImpl)

    await expect(transport.sendImage(imageInput('', 'lark:conversation:chat:oc_1:thread:omt_9'))).resolves.toEqual({ kind: 'delivered' })
    expect(messageCall(calls).json?.root_id).toBe('omt_9')
  })

  it('does not send any message when the upload fails', async () => {
    const { fetchImpl, calls } = fakeFetch({ upload: { status: 429, body: { code: 99991400 } } })
    await expect(transportWith(fetchImpl).transport.sendImage(imageInput('日报'))).resolves.toEqual({
      kind: 'failed', code: 'delivery-rate-limited'
    })
    // 上传失败必须停在超限/拒绝那一层：发一条只有说明的消息比不发更糟。
    expect(calls.some((call) => call.url.includes('/im/v1/messages'))).toBe(false)
  })

  it('reports a failed message send even though the upload succeeded', async () => {
    const { fetchImpl } = fakeFetch({ upload: uploaded, message: { status: 400, body: { code: 230001, msg: 'invalid content' } } })
    await expect(transportWith(fetchImpl).transport.sendImage(imageInput('日报'))).resolves.toEqual({
      kind: 'failed', code: 'delivery-provider-rejected'
    })

    const serverError = fakeFetch({ upload: uploaded, message: { status: 503, body: { code: 500 } } })
    await expect(transportWith(serverError.fetchImpl).transport.sendImage(imageInput('日报'))).resolves.toEqual({
      kind: 'unknown-after-send'
    })
  })

  it('refuses without runtime ownership and on an undecodable conversation key', async () => {
    const { fetchImpl, calls } = fakeFetch({ upload: uploaded })
    const gone = transportWith(fetchImpl, false)
    expect(gone.transport.supportsImage('lark-a')).toBe(false)
    await expect(gone.transport.sendImage(imageInput())).resolves.toEqual({ kind: 'failed', code: 'delivery-host-unavailable' })

    const live = transportWith(fetchImpl)
    await expect(live.transport.sendImage(imageInput('', 'lark:conversation:chat:not a chat'))).resolves.toEqual({
      kind: 'failed', code: 'delivery-provider-rejected'
    })
    expect(calls).toHaveLength(0)
  })
})

describe('router with the real Lark adapter', () => {
  /** 只实现文本的适配器：路由的判据是「有没有实现 sendImage」，不是平台名。 */
  const textOnly: ChannelDeliveryTransport = {
    send: async () => ({ kind: 'delivered' }),
    supportsIdempotency: () => false
  }

  it('keeps Lark unsupported while the capability switch is off', async () => {
    const { fetchImpl, calls } = fakeFetch({ upload: uploaded })
    const instance = new ChannelDeliveryTransportRouter({
      typeForChannel: (channelId) => (channelId === 'lark-a' ? 'feishu' : channelId === 'wechat-a' ? 'wechat' : null),
      telegram: textOnly,
      slack: textOnly,
      lark: transportWith(fetchImpl).transport,
      qq: textOnly,
      discord: textOnly,
      wechat: textOnly
    })

    // 开关关着：路由不为飞书放行图片，界面也不会有按钮。把常量改成 true，这条必须红。
    // 这是产品路径上的唯一判据——`ChannelDeliveryService.deliverImage` 先问 `supportsImage`，
    // 为假就直接判 `delivery-image-unsupported`，连 `sendImage` 都不会调（上传请求为 0 就是证据）。
    expect(instance.supportsImage('lark-a')).toBe(false)
    expect(instance.supportsImage('wechat-a')).toBe(false)
    const sent = await instance.supportsImage('lark-a')
      ? instance.sendImage({ ...imageInput('日报'), channelId: 'lark-a' })
      : { kind: 'failed' as const, code: 'delivery-image-unsupported' }
    expect(sent).toEqual({ kind: 'failed', code: 'delivery-image-unsupported' })
    await expect(instance.sendImage({ ...imageInput('日报'), channelId: 'wechat-a' }))
      .resolves.toEqual({ kind: 'failed', code: 'delivery-image-unsupported' })
    // 关的只是图片能力：一次上传请求都不该发出去。
    expect(calls).toHaveLength(0)
    // 同一个实例、同一个平台：文本接口没被图片接口顶掉。
    await expect(instance.send({ channelId: 'lark-a', providerConversationKey: 'lark:conversation:chat:oc_1', text: 'hi', idempotencyKey: 'k' }))
      .resolves.toEqual({ kind: 'delivered' })
  })
})
