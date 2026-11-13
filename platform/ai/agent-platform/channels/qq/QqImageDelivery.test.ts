import { describe, expect, it } from 'vitest'

import { QqApiClient } from './QqApiClient'
import { QqDeliveryTransport } from './QqDeliveryTransport'

/**
 * QQ 图片出站（最小范围）：**一条 Markdown 消息**承载「图 + 说明」——单聊、群聊做，频道不支持。
 *
 * 三条判据：
 * - 三步素材上传只在**第一次**发生；同一张图第二次发复用 `qqbot-media://` 引用，一次上传都没有
 *   （单机器人 100 张/90 天是硬上限，复用是代码判据，不是优化建议）；
 * - 图与说明在**同一条**消息里（`msg_type: 2`），不拆两条；
 * - 频道（guild）没有素材上传接口 → `delivery-image-unsupported`，不许假装能发。
 */
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])
const MEDIA_URL = 'qqbot-media://image/v1/token-1'

type Call = { url: string; method: string; body: unknown }

function fakeFetch(steps: { prepare?: unknown; complete?: unknown; markdown?: unknown; putStatus?: number; prepareStatus?: number } = {}) {
  const calls: Call[] = []
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    calls.push({ url, method, body: init?.body })
    if (url.includes('v2/media-images/prepare')) {
      const status = steps.prepareStatus ?? 200
      return new Response(JSON.stringify(steps.prepare ?? { upload_id: 'upload-1', presigned_url: 'https://cos.test/put/1' }), { status })
    }
    if (url === 'https://cos.test/put/1') return new Response('', { status: steps.putStatus ?? 200 })
    if (url.includes('v2/media-images/complete')) {
      return new Response(JSON.stringify(steps.complete ?? { url: MEDIA_URL, ttl: 7_776_000 }), { status: 200 })
    }
    if (url.includes('/messages')) return new Response(JSON.stringify(steps.markdown ?? { id: 'm-1' }), { status: 200 })
    return new Response('{}', { status: 200 })
  }) as typeof fetch
  return { fetchImpl, calls }
}

function transportWith(fetchImpl: typeof fetch, current = true) {
  const transport = new QqDeliveryTransport()
  const controller = new AbortController()
  transport.setClient(
    'qq-a',
    new QqApiClient({ getPlatformFetch: () => fetchImpl, token: async () => 'access-token' }),
    { isCurrent: () => current, signal: controller.signal }
  )
  return { transport, controller }
}

const imageInput = (caption = '今天的导读', key = 'qq:conversation:direct:user-openid') => ({
  channelId: 'qq-a',
  providerConversationKey: key,
  image: { mime: 'image/png', bytes: PNG },
  caption,
  idempotencyKey: 'channel-delivery:test'
})

const uploadCalls = (calls: Call[]) => calls.filter((call) => call.url.includes('media-images') || call.url.includes('cos.test'))
const messageCalls = (calls: Call[]) => calls.filter((call) => call.url.includes('/messages'))

describe('QQ image send (single message, materials reused)', () => {
  it('uploads once and sends one markdown message with the image and the caption', async () => {
    const { fetchImpl, calls } = fakeFetch()
    const { transport } = transportWith(fetchImpl)

    await expect(transport.sendImage(imageInput())).resolves.toEqual({ kind: 'delivered' })

    // 三步各一次：申请 → PUT → 完成。
    expect(uploadCalls(calls).map((call) => `${call.method} ${call.url}`)).toEqual([
      'POST https://api.sgroup.qq.com/v2/media-images/prepare',
      'PUT https://cos.test/put/1',
      'POST https://api.sgroup.qq.com/v2/media-images/complete'
    ])
    const message = messageCalls(calls)[0]!
    expect(message.url).toBe('https://api.sgroup.qq.com/v2/users/user-openid/messages')
    const body = JSON.parse(String(message.body)) as { msg_type: number; markdown: { content: string } }
    // 一条消息：图 + 说明，图在上。
    expect(body.msg_type).toBe(2)
    expect(body.markdown.content).toBe(`![](${MEDIA_URL})\n\n今天的导读`)
  })

  it('reuses the uploaded material for the same bytes instead of uploading again', async () => {
    const { fetchImpl, calls } = fakeFetch()
    const { transport } = transportWith(fetchImpl)

    await transport.sendImage(imageInput('第一次'))
    await transport.sendImage(imageInput('第二次', 'qq:conversation:group:group-openid'))

    // 第二次一次上传都没有，只有第二条消息；配额是 100 张/90 天的硬上限。
    expect(uploadCalls(calls)).toHaveLength(3)
    expect(messageCalls(calls)).toHaveLength(2)
    const second = JSON.parse(String(messageCalls(calls)[1]!.body)) as { markdown: { content: string } }
    expect(second.markdown.content).toContain(MEDIA_URL)
  })

  it('re-uploads after the material TTL has passed', async () => {
    const { fetchImpl, calls } = fakeFetch({ complete: { url: MEDIA_URL, ttl: 1 } })
    const { transport } = transportWith(fetchImpl)
    const realNow = Date.now
    try {
      await transport.sendImage(imageInput())
      // TTL 过期之后必须重新上传，不许拿一个过期引用发出去。
      Date.now = () => realNow() + 5_000
      await transport.sendImage(imageInput())
    } finally {
      Date.now = realNow
    }
    expect(uploadCalls(calls)).toHaveLength(6)
  })

  it('refuses a guild channel: there is no material upload there', async () => {
    const { fetchImpl, calls } = fakeFetch()
    const { transport } = transportWith(fetchImpl)
    await expect(transport.sendImage(imageInput('导读', 'qq:conversation:channel:guild-channel')))
      .resolves.toEqual({ kind: 'failed', code: 'delivery-image-unsupported' })
    expect(calls).toHaveLength(0)
  })

  it('maps upload failures onto the existing closed set, and sends no message', async () => {
    const limited = fakeFetch({ prepareStatus: 429 })
    await expect(transportWith(limited.fetchImpl).transport.sendImage(imageInput()))
      .resolves.toEqual({ kind: 'failed', code: 'delivery-rate-limited' })
    expect(messageCalls(limited.calls)).toHaveLength(0)

    const rejected = fakeFetch({ prepareStatus: 400 })
    await expect(transportWith(rejected.fetchImpl).transport.sendImage(imageInput()))
      .resolves.toEqual({ kind: 'failed', code: 'delivery-provider-rejected' })
    expect(messageCalls(rejected.calls)).toHaveLength(0)
  })

  it('keeps the capability closed until a real device verifies it', () => {
    const { transport } = transportWith(fakeFetch().fetchImpl)
    // 没验过就不开门：router 据此判 unsupported，聊天卡片也不画按钮。
    expect(transport.supportsImage('qq-a')).toBe(false)
  })
})
