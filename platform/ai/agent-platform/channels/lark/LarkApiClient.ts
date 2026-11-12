import { larkApiBase, type LarkApiFailure, type LarkApiResult, type LarkProviderConversation } from './LarkContracts'

type Fetch = typeof fetch

/** Lark REST is injectable only; access tokens remain inside this short-lived main-process client. */
export class LarkApiClient {
  private tenantToken: string | null = null

  constructor(private readonly deps: { getPlatformFetch: () => Fetch; credentials: () => Promise<{ appId: string; appSecret: string } | null> }) {}

  async sendText(conversation: LarkProviderConversation, text: string, signal?: AbortSignal): Promise<LarkApiResult<true>> {
    if (signal?.aborted) return { ok: false, code: 'lark-network-unavailable' }
    const token = await this.token(signal)
    if (!token) return { ok: false, code: 'lark-provider-rejected' }
    const content = JSON.stringify({ text })
    return this.request(
      `im/v1/messages?receive_id_type=chat_id`,
      { receive_id: conversation.chatId, msg_type: 'text', content, ...(conversation.threadId ? { root_id: conversation.threadId } : {}) },
      token,
      signal
    ).then((result) => result.ok ? { ok: true, value: true } : result)
  }

  /**
   * 上传一张图，拿 `image_key`（`image_type=message`）：飞书的消息里只认 key，不认字节。
   *
   * 上传不是消息——一种投递仍然只发一条消息；大小与格式**不在这里判**，上限与字节签名归投递层
   * `validateChannelImageDelivery`（10 MB 与飞书上图上限同档）。
   */
  async uploadImage(input: { mime: string; bytes: Uint8Array }, signal?: AbortSignal): Promise<LarkApiResult<{ imageKey: string }>> {
    if (signal?.aborted) return { ok: false, code: 'lark-network-unavailable' }
    const token = await this.token(signal)
    if (!token) return { ok: false, code: 'lark-provider-rejected' }
    // 文件名只由嗅探出的 mime 决定（飞书按文件名与 content-type 认图），字节不落盘。
    const filename = `image.${input.mime === 'image/png' ? 'png' : 'jpg'}`
    const form = new FormData()
    form.set('image_type', 'message')
    form.set('image', new Blob([input.bytes], { type: input.mime }), filename)
    try {
      const response = await this.deps.getPlatformFetch()(`${larkApiBase}/im/v1/images`, {
        method: 'POST', signal, headers: { authorization: `Bearer ${token}` }, body: form
      })
      const json = await response.json() as { code?: unknown; data?: { image_key?: unknown } }
      if (!response.ok || json.code !== 0) return { ok: false, code: classifyStatus(response.status) }
      const imageKey = json.data?.image_key
      return typeof imageKey === 'string' && imageKey.length > 0 && imageKey.length <= 256
        ? { ok: true, value: { imageKey } }
        : { ok: false, code: 'lark-provider-rejected' }
    } catch { return { ok: false, code: 'lark-network-unavailable' } }
  }

  /**
   * 一条消息承载「图 + 说明」，按有没有说明分两种形态（都只有**一条**消息）：
   * - 没有说明：`msg_type: image`，content 就是 `{"image_key":…}`——原生图片消息，客户端按图片预览；
   * - 有说明：`msg_type: post`（富文本），同一份 content 里先 img 段、后 text 段。
   *
   * 为什么不用「image 一条 + text 一条」：两条非原子，图成功、文失败就留下一张没有说明的图。
   * 为什么有说明时不走 image：image 的 content 结构只有 `image_key`，**没有放文字的地方**（官方内容结构）。
   * 为什么 img 在前：Telegram / Slack / Discord 的 caption 都在图片下方，四个平台要长得一样。
   *
   * `title` 传空串：官方示例里富文本标题允许为空，我们不需要标题（多一行标题会变成读者可见的变化）。
   * 语言键给 `zh_cn` 与 `en_us` 两份相同的文本：只填一种时，另一种语言的客户端可能显示为空，
   * 我们不做翻译，两处放同一段（内容由调用方转成纯文本，post 元素不支持 markdown）。
   */
  async sendImage(
    conversation: LarkProviderConversation,
    input: { imageKey: string; caption: string },
    signal?: AbortSignal
  ): Promise<LarkApiResult<true>> {
    if (signal?.aborted) return { ok: false, code: 'lark-network-unavailable' }
    const token = await this.token(signal)
    if (!token) return { ok: false, code: 'lark-provider-rejected' }
    const hasCaption = input.caption.trim().length > 0
    const content = hasCaption
      ? JSON.stringify({
        zh_cn: { title: '', content: [[{ tag: 'img', image_key: input.imageKey }], [{ tag: 'text', text: input.caption }]] },
        en_us: { title: '', content: [[{ tag: 'img', image_key: input.imageKey }], [{ tag: 'text', text: input.caption }]] }
      })
      : JSON.stringify({ image_key: input.imageKey })
    return this.request(
      `im/v1/messages?receive_id_type=chat_id`,
      {
        receive_id: conversation.chatId,
        msg_type: hasCaption ? 'post' : 'image',
        content,
        ...(conversation.threadId ? { root_id: conversation.threadId } : {})
      },
      token,
      signal
    ).then((result) => result.ok ? { ok: true, value: true } : result)
  }

  private async token(signal?: AbortSignal): Promise<string | null> {
    if (this.tenantToken && !signal?.aborted) return this.tenantToken
    const credentials = await this.deps.credentials()
    if (!credentials || signal?.aborted) return null
    try {
      const response = await this.deps.getPlatformFetch()(`${larkApiBase}/auth/v3/tenant_access_token/internal`, {
        method: 'POST', signal, headers: { 'content-type': 'application/json; charset=utf-8' },
        body: JSON.stringify({ app_id: credentials.appId, app_secret: credentials.appSecret })
      })
      const body = await response.json() as { code?: unknown; tenant_access_token?: unknown }
      if (!response.ok || body.code !== 0 || typeof body.tenant_access_token !== 'string' || !body.tenant_access_token) return null
      this.tenantToken = body.tenant_access_token
      return signal?.aborted ? null : this.tenantToken
    } catch { return null }
  }

  private async request(path: string, body: Record<string, unknown>, token: string, signal?: AbortSignal): Promise<LarkApiResult<Record<string, unknown>>> {
    try {
      const response = await this.deps.getPlatformFetch()(`${larkApiBase}/${path}`, {
        method: 'POST', signal, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json; charset=utf-8' }, body: JSON.stringify(body)
      })
      const json = await response.json() as { code?: unknown }
      if (response.ok && json.code === 0) return { ok: true, value: json }
      return { ok: false, code: classifyStatus(response.status) }
    } catch { return { ok: false, code: 'lark-network-unavailable' } }
  }
}

/** HTTP 状态 → 失败分类（上传与消息共用一个判法）：429 限流、5xx 网络、其余被拒。 */
function classifyStatus(status: number): LarkApiFailure {
  return status === 429 ? 'lark-rate-limited' : status >= 500 ? 'lark-network-unavailable' : 'lark-provider-rejected'
}
