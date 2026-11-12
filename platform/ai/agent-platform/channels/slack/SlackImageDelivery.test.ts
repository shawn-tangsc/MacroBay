import { describe, expect, it } from 'vitest'

import type { ChannelDeliveryTransport } from '../ChannelDeliveryContracts'
import { ChannelDeliveryTransportRouter } from '../ChannelDeliveryTransportRouter'
import { SlackApiClient } from './SlackApiClient'
import { SlackDeliveryTransport } from './SlackDeliveryTransport'

/**
 * 出站图片第二站：Slack。它不是一次请求，是**三步上传**：
 *
 * 1. `files.getUploadURLExternal`（拿预上传地址 + file id）
 * 2. POST 字节到那个地址（裸字节，不走 Web API 信封）
 * 3. `files.completeUploadExternal` 带 `channel_id` + `initial_comment`（caption）
 *
 * 要钉住三件事：
 * - 三步**按序**走，任一步失败就停，绝不把失败当成功往下走（第 2 步没收下字节时，第 3 步只会落一个空文件）；
 * - 失败分类与文本共用一处分流（限流 / 上游拒绝 / 其余不知道结果），不新开码；
 * - 大小与格式不在适配器里重判（那是投递层 `validateChannelImageDelivery` 的事），这里只发字节。
 */

const pngBytes = (size = 32): Uint8Array => {
  const value = new Uint8Array(size)
  value.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  return value
}

const uploadUrl = 'https://files.slack.test/upload/xyz'

type Call = { url: string; body: unknown; headers: Record<string, string> }

type Step = { status: number; body: unknown; retryAfter?: string }

/** 每一步各给一个响应；第 2 步按 URL 认（预签名地址不是 Web API 方法）。 */
function fakeFetch(steps: { open: Step; upload?: Step; complete?: Step }) {
  const calls: Call[] = []
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    calls.push({
      url,
      body: init?.body,
      headers: (init?.headers ?? {}) as Record<string, string>
    })
    const step = url.includes('files.getUploadURLExternal')
      ? steps.open
      : url === uploadUrl
        ? steps.upload ?? { status: 200, body: 'OK' }
        : steps.complete ?? { status: 200, body: { ok: true } }
    return new Response(typeof step.body === 'string' ? step.body : JSON.stringify(step.body), {
      status: step.status,
      headers: step.retryAfter ? { 'retry-after': step.retryAfter } : {}
    })
  }) as typeof fetch
  return { fetchImpl, calls }
}

function transportWith(fetchImpl: typeof fetch, current = true) {
  const transport = new SlackDeliveryTransport()
  const controller = new AbortController()
  transport.setClient(
    'slack-a',
    new SlackApiClient({ getPlatformFetch: () => fetchImpl, botToken: async () => 'xoxb-secret', appToken: async () => 'xapp-secret' }),
    { isCurrent: () => current, signal: controller.signal }
  )
  return { transport, controller }
}

const imageInput = (caption = '日报 *重点*', key = 'slack:conversation:C1') => ({
  channelId: 'slack-a',
  providerConversationKey: key,
  image: { mime: 'image/png', bytes: pngBytes() },
  caption,
  idempotencyKey: 'channel-delivery:test'
})

const jsonBody = (call: Call) => JSON.parse(String(call.body)) as Record<string, unknown>

describe('slack three-step upload', () => {
  it('opens an upload url, posts the bytes there, then completes the file in the conversation', async () => {
    const { fetchImpl, calls } = fakeFetch({
      open: { status: 200, body: { ok: true, upload_url: uploadUrl, file_id: 'F123' } },
      complete: { status: 200, body: { ok: true, files: [{ id: 'F123' }] } }
    })
    const { transport } = transportWith(fetchImpl)

    await expect(transport.sendImage(imageInput())).resolves.toEqual({
      kind: 'delivered',
      detail: '{"slackFileId":"F123"}'
    })

    expect(calls.map((call) => call.url)).toEqual([
      'https://slack.com/api/files.getUploadURLExternal',
      uploadUrl,
      'https://slack.com/api/files.completeUploadExternal'
    ])

    // 第 1 步：文件名按嗅探 mime 给扩展名，长度是真实字节数。
    expect(jsonBody(calls[0]!)).toEqual({ filename: 'image.png', length: pngBytes().byteLength })
    // 第 2 步：字节原样、按 mime 声明 content-type（预签名地址不走 Web API，也不带 token）。
    expect(calls[1]!.headers['content-type']).toBe('image/png')
    expect((await (calls[1]!.body as Blob).arrayBuffer()).byteLength).toBe(pngBytes().byteLength)
    expect(calls[1]!.headers['authorization']).toBeUndefined()
    // 第 3 步：file id 落到会话，caption 进 initial_comment；身份里有 token 但不进第 2 步。
    expect(jsonBody(calls[2]!)).toEqual({ files: [{ id: 'F123' }], channel_id: 'C1', initial_comment: '日报 *重点*' })
    expect(calls[2]!.headers['authorization']).toBe('Bearer xoxb-secret')
    // caption 与图片是同一条消息（不是先文本后图两条），也不在字节那一步重复。
    expect(JSON.stringify(calls[0]!.body)).not.toContain('日报')
    expect(JSON.stringify(calls[1]!.body ?? '')).not.toContain('日报')
  })

  it('keeps the thread reply and drops initial_comment when the caption is empty', async () => {
    const { fetchImpl, calls } = fakeFetch({ open: { status: 200, body: { ok: true, upload_url: uploadUrl, file_id: 'F9' } } })
    const { transport } = transportWith(fetchImpl)

    await expect(transport.sendImage(imageInput('', 'slack:conversation:C1:thread:1.1'))).resolves.toMatchObject({ kind: 'delivered' })
    expect(jsonBody(calls[2]!)).toEqual({ files: [{ id: 'F9' }], channel_id: 'C1', thread_ts: '1.1' })
  })

  it('stops at the first failing step instead of walking on to the next one', async () => {
    const openFailed = fakeFetch({ open: { status: 429, body: { ok: false }, retryAfter: '2' } })
    await expect(transportWith(openFailed.fetchImpl).transport.sendImage(imageInput())).resolves.toEqual({
      kind: 'failed', code: 'delivery-rate-limited'
    })
    // 第 1 步就失败：一次字节请求、一次完成请求都不许发。
    expect(openFailed.calls).toHaveLength(1)

    const uploadFailed = fakeFetch({
      open: { status: 200, body: { ok: true, upload_url: uploadUrl, file_id: 'F1' } },
      upload: { status: 400, body: 'invalid' }
    })
    await expect(transportWith(uploadFailed.fetchImpl).transport.sendImage(imageInput())).resolves.toEqual({
      kind: 'failed', code: 'delivery-provider-rejected'
    })
    // 第 2 步失败：不拿半张文件去 complete（那会落一个空文件，读者只看到一条空消息）。
    expect(uploadFailed.calls.map((call) => call.url)).toEqual([
      'https://slack.com/api/files.getUploadURLExternal', uploadUrl
    ])

    const completeFailed = fakeFetch({
      open: { status: 200, body: { ok: true, upload_url: uploadUrl, file_id: 'F1' } },
      upload: { status: 200, body: 'OK' },
      complete: { status: 400, body: { ok: false, error: 'channel_not_found' } }
    })
    await expect(transportWith(completeFailed.fetchImpl).transport.sendImage(imageInput())).resolves.toEqual({
      kind: 'failed', code: 'delivery-provider-rejected'
    })
  })

  it('maps the same three outcomes the text path does, including an unknown result after a 5xx', async () => {
    const cases: Array<[Step, { kind: string; code?: string }]> = [
      [{ status: 403, body: { ok: false } }, { kind: 'failed', code: 'delivery-provider-rejected' }],
      [{ status: 503, body: { ok: false } }, { kind: 'unknown-after-send' }]
    ]
    for (const [open, expected] of cases) {
      const { fetchImpl } = fakeFetch({ open })
      await expect(transportWith(fetchImpl).transport.sendImage(imageInput())).resolves.toEqual(expected)
    }

    // 第 2 步的 5xx 同样是「不知道收没收下」；429 则仍是限流。
    const byteServerError = fakeFetch({
      open: { status: 200, body: { ok: true, upload_url: uploadUrl, file_id: 'F1' } },
      upload: { status: 500, body: 'boom' }
    })
    await expect(transportWith(byteServerError.fetchImpl).transport.sendImage(imageInput())).resolves.toEqual({
      kind: 'unknown-after-send'
    })
  })

  it('refuses without runtime ownership and on an undecodable conversation key', async () => {
    const { fetchImpl, calls } = fakeFetch({ open: { status: 200, body: { ok: true, upload_url: uploadUrl, file_id: 'F1' } } })
    const gone = transportWith(fetchImpl, false)
    expect(gone.transport.supportsImage('slack-a')).toBe(false)
    await expect(gone.transport.sendImage(imageInput())).resolves.toEqual({ kind: 'failed', code: 'delivery-host-unavailable' })

    const live = transportWith(fetchImpl)
    expect(live.transport.supportsImage('slack-a')).toBe(true)
    await expect(live.transport.sendImage(imageInput('日报', 'slack:conversation:not-a-channel'))).resolves.toEqual({
      kind: 'failed', code: 'delivery-provider-rejected'
    })
    expect(calls).toHaveLength(0)
  })
})

describe('router with the real Slack adapter', () => {
  /** 只实现文本的适配器：路由的图片能力判据是「有没有实现 sendImage」，不看平台名。 */
  const textOnly: ChannelDeliveryTransport = {
    send: async () => ({ kind: 'delivered' }),
    supportsIdempotency: () => false
  }

  it('counts Slack as image-capable and keeps text-only adapters unsupported', async () => {
    const { fetchImpl } = fakeFetch({ open: { status: 200, body: { ok: true, upload_url: uploadUrl, file_id: 'F7' } } })
    const instance = new ChannelDeliveryTransportRouter({
      typeForChannel: (channelId) => (channelId === 'slack-a' ? 'slack' : channelId === 'lark-a' ? 'feishu' : null),
      telegram: textOnly,
      slack: transportWith(fetchImpl).transport,
      lark: textOnly,
      qq: textOnly,
      discord: textOnly,
      wechat: textOnly
    })

    expect(instance.supportsImage('slack-a')).toBe(true)
    expect(instance.supportsImage('lark-a')).toBe(false)
    await expect(instance.sendImage({ ...imageInput(), channelId: 'slack-a' })).resolves.toMatchObject({ kind: 'delivered' })
    await expect(instance.sendImage({ ...imageInput(), channelId: 'lark-a' }))
      .resolves.toEqual({ kind: 'failed', code: 'delivery-image-unsupported' })
    // 同一个实例、同一个平台：文本接口没被图片接口顶掉。
    await expect(instance.send({ channelId: 'slack-a', providerConversationKey: 'slack:conversation:C1', text: 'hi', idempotencyKey: 'k' }))
      .resolves.toEqual({ kind: 'delivered' })
  })
})
