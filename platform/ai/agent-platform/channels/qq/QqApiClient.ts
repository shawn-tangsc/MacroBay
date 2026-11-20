import { createHash } from 'node:crypto'

import { qqApiBase, type QqProviderConversation } from './QqContracts'

/** Injectable-only REST seam; Release D manager never constructs it while QQ is blocked. */
export class QqApiClient {
  constructor(private readonly deps: { getPlatformFetch: () => typeof fetch; token: () => Promise<string | null> }) {}

  /**
   * 一条 Markdown 消息（`msg_type: 2`）承载「图 + 说明」：飞书之外的第二个平台能这么干。
   *
   * 为什么不是 `msg_type: 1/7`（富媒体）：那条的 content 结构只有 `file_info`，**没有地方放文字**；
   * 拆成「图一条、文字一条」会造出「图到了、说明没到」的半条成功。素材管理 + Markdown 是唯一
   * 一条能图文同条的路（官方：单聊/群聊自定义 Markdown 对所有机器人开放）。
   */
  async sendMarkdown(conversation: QqProviderConversation, markdown: string, signal?: AbortSignal): Promise<QqSendOutcome> {
    if (signal?.aborted) return 'unknown'
    const token = await this.deps.token()
    if (!token || signal?.aborted) return 'rejected'
    const path = conversation.kind === 'direct' ? `v2/users/${conversation.id}/messages` : conversation.kind === 'group' ? `v2/groups/${conversation.id}/messages` : `channels/${conversation.id}/messages`
    try {
      const response = await this.deps.getPlatformFetch()(`${qqApiBase}/${path}`, {
        method: 'POST', signal,
        headers: { authorization: `QQBot ${token}`, 'content-type': 'application/json; charset=utf-8' },
        body: JSON.stringify({ msg_type: 2, markdown: { content: markdown } })
      })
      const outcome = outcomeOf(response)
      return outcome === 'delivered' ? 'delivered' : outcome
    } catch { return 'unknown' }
  }

  /**
   * 素材上传（Markdown 里的图）：**三步**——申请预签名地址 → PUT 字节 → 完成登记，拿 `qqbot-media://` 引用。
   * 图片进 Markdown 后与说明在同一条消息里；素材与机器人绑定、90 天滑动过期。
   */
  async uploadMarkdownImage(input: { bytes: Uint8Array; mime: string; signal?: AbortSignal }): Promise<
    { ok: true; url: string; ttlSeconds: number } | { ok: false; outcome: Exclude<QqSendOutcome, 'delivered'> }
  > {
    const { signal } = input
    if (signal?.aborted) return { ok: false, outcome: 'unknown' }
    const token = await this.deps.token()
    if (!token || signal?.aborted) return { ok: false, outcome: 'rejected' }
    const md5 = createHash('md5').update(input.bytes).digest('hex')
    const sha1 = createHash('sha1').update(input.bytes).digest('hex')
    const fileName = `image.${input.mime === 'image/png' ? 'png' : 'jpg'}`
    const prepared = await this.post<{ upload_id?: unknown; presigned_url?: unknown }>('v2/media-images/prepare', {
      file_name: fileName,
      file_size: input.bytes.byteLength,
      content_type: input.mime,
      md5,
      sha1
    }, token, signal)
    if (!prepared.ok) return { ok: false, outcome: prepared.outcome }
    const uploadId = typeof prepared.value.upload_id === 'string' ? prepared.value.upload_id : ''
    const presignedUrl = typeof prepared.value.presigned_url === 'string' ? prepared.value.presigned_url : ''
    if (!uploadId || !presignedUrl) return { ok: false, outcome: 'rejected' }
    // 第 2 步：预签名地址是 COS，不是 Web API——不带 token，Content-Type 必须与申请时一致。
    const put = await this.putBytes(presignedUrl, input.bytes, input.mime, signal)
    if (!put) return { ok: false, outcome: 'unknown' }
    const completed = await this.post<{ url?: unknown; ttl?: unknown }>('v2/media-images/complete', { upload_id: uploadId, md5 }, token, signal)
    if (!completed.ok) return { ok: false, outcome: completed.outcome }
    const url = typeof completed.value.url === 'string' ? completed.value.url : ''
    if (!url.startsWith('qqbot-media://')) return { ok: false, outcome: 'rejected' }
    const ttl = typeof completed.value.ttl === 'number' && Number.isFinite(completed.value.ttl) ? completed.value.ttl : 0
    return { ok: true, url, ttlSeconds: ttl }
  }

  private async post<T>(path: string, body: Record<string, unknown>, token: string, signal?: AbortSignal): Promise<
    { ok: true; value: T } | { ok: false; outcome: Exclude<QqSendOutcome, 'delivered'> }
  > {
    try {
      const response = await this.deps.getPlatformFetch()(`${qqApiBase}/${path}`, {
        method: 'POST', signal,
        headers: { authorization: `QQBot ${token}`, 'content-type': 'application/json; charset=utf-8' },
        body: JSON.stringify(body)
      })
      if (!response.ok) {
        const outcome = outcomeOf(response)
        return { ok: false, outcome: outcome === 'delivered' ? 'rejected' : outcome }
      }
      return { ok: true, value: await response.json() as T }
    } catch { return { ok: false, outcome: 'unknown' } }
  }

  private async putBytes(url: string, bytes: Uint8Array, mime: string, signal?: AbortSignal): Promise<boolean> {
    try {
      const response = await this.deps.getPlatformFetch()(url, {
        method: 'PUT', signal, headers: { 'content-type': mime }, body: bytes as unknown as BodyInit
      })
      return response.ok
    } catch { return false }
  }

  async sendText(conversation: QqProviderConversation, content: string, signal?: AbortSignal): Promise<'delivered' | 'rejected' | 'rate-limited' | 'unknown'> {
    if (signal?.aborted) return 'unknown'
    const token = await this.deps.token()
    if (!token || signal?.aborted) return 'rejected'
    const path = conversation.kind === 'direct' ? `v2/users/${conversation.id}/messages` : conversation.kind === 'group' ? `v2/groups/${conversation.id}/messages` : `channels/${conversation.id}/messages`
    try {
      const response = await this.deps.getPlatformFetch()(`${qqApiBase}/${path}`, {
        method: 'POST', signal,
        headers: { authorization: `QQBot ${token}`, 'content-type': 'application/json; charset=utf-8' },
        body: JSON.stringify({ content })
      })
      return response.ok ? 'delivered' : response.status === 429 ? 'rate-limited' : response.status >= 500 ? 'unknown' : 'rejected'
    } catch { return 'unknown' }
  }
}

/** 一条出站请求的三种处境（文本、Markdown、素材三步共用一处判法）。 */
export type QqSendOutcome = 'delivered' | 'rejected' | 'rate-limited' | 'unknown'

/** HTTP 状态 → 处境：429 限流、5xx 不知道结果、其余 4xx 被拒（与文本那条同一套）。 */
function outcomeOf(response: Response): QqSendOutcome {
  return response.ok ? 'delivered' : response.status === 429 ? 'rate-limited' : response.status >= 500 ? 'unknown' : 'rejected'
}
