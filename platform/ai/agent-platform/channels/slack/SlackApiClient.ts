import type { SlackApiResult, SlackProviderConversation } from './SlackContracts'
import { slackApiBase } from './SlackContracts'

type Fetch = typeof fetch

/** Slack REST has no global fallback: desktop composition injects the proxy-aware fetch implementation. */
export class SlackApiClient {
  constructor(private readonly deps: { getPlatformFetch: () => Fetch; botToken: () => Promise<string | null>; appToken: () => Promise<string | null> }) {}

  async socketUrl(signal?: AbortSignal): Promise<SlackApiResult<string>> {
    return this.request('apps.connections.open', {}, 'app', signal).then((result) => {
      if (!result.ok || typeof result.value.url !== 'string' || !result.value.url.startsWith('wss://')) return result.ok ? { ok: false, code: 'slack-provider-rejected' } : result
      return { ok: true, value: result.value.url }
    })
  }

  async authUser(signal?: AbortSignal): Promise<SlackApiResult<string>> {
    return this.request('auth.test', {}, 'bot', signal).then((result) => {
      if (!result.ok || typeof result.value.user_id !== 'string' || !result.value.user_id) return result.ok ? { ok: false, code: 'slack-provider-rejected' } : result
      return { ok: true, value: result.value.user_id }
    })
  }

  sendMessage(conversation: { channelId: string; threadTs: string | null }, text: string, signal?: AbortSignal): Promise<SlackApiResult<true>> {
    return this.request('chat.postMessage', {
      channel: conversation.channelId, text, ...(conversation.threadTs ? { thread_ts: conversation.threadTs } : {})
    }, 'bot', signal).then((result) => result.ok ? { ok: true, value: true } : result)
  }

  /**
   * 发一张图 + caption。Slack 的对外文件上传是**三步**，不是一次请求：
   * 1. `files.getUploadURLExternal`：拿预签名地址与 file id；
   * 2. 把字节 POST 到那个地址（裸字节，不走 Web API 的 JSON 信封、不带 Bearer）；
   * 3. `files.completeUploadExternal`：把 file id 落到目标会话，`initial_comment` 就是 caption。
   *
   * 三步任一失败都返回失败，调用方不会再往下走（第 2 步没上传成功时，第 3 步只会得到一个空文件）。
   * 大小与格式**不在这里判**：上限与字节签名由投递层的 `validateChannelImageDelivery` 统一判定。
   */
  async uploadImage(input: {
    conversation: SlackProviderConversation
    mime: string
    bytes: Uint8Array
    caption: string
    signal?: AbortSignal
  }): Promise<SlackApiResult<{ fileId: string | null }>> {
    try {
      const opened = await this.request('files.getUploadURLExternal', {
        filename: `image.${imageExtension(input.mime)}`,
        length: input.bytes.byteLength
      }, 'bot', input.signal)
      if (!opened.ok) return opened
      const uploadUrl = typeof opened.value.upload_url === 'string' ? opened.value.upload_url : ''
      const fileId = typeof opened.value.file_id === 'string' ? opened.value.file_id : ''
      if (!uploadUrl || !fileId) return { ok: false, code: 'slack-provider-rejected' }

      const uploaded = await this.uploadBytes(uploadUrl, input)
      if (!uploaded.ok) return uploaded

      const completed = await this.request('files.completeUploadExternal', {
        files: [{ id: fileId }],
        channel_id: input.conversation.channelId,
        ...(input.caption.trim() ? { initial_comment: input.caption } : {}),
        ...(input.conversation.threadTs ? { thread_ts: input.conversation.threadTs } : {})
      }, 'bot', input.signal)
      if (!completed.ok) return completed
      return { ok: true, value: { fileId } }
    } catch { return { ok: false, code: 'slack-network-unavailable' } }
  }

  /** 第 2 步：字节直接进预签名地址；与 Web API 共用同一套 HTTP 失败分类。 */
  private async uploadBytes(url: string, input: { mime: string; bytes: Uint8Array; signal?: AbortSignal }): Promise<SlackApiResult<true>> {
    try {
      if (input.signal?.aborted) return { ok: false, code: 'slack-network-unavailable' }
      const response = await this.deps.getPlatformFetch()(url, {
        method: 'POST', signal: input.signal, headers: { 'content-type': input.mime }, body: new Blob([input.bytes], { type: input.mime })
      })
      if (response.ok) return { ok: true, value: true }
      if (response.status === 429) return { ok: false, code: 'slack-rate-limited', retryAfterMs: retryAfter(response.headers.get('retry-after')) }
      return { ok: false, code: response.status >= 500 ? 'slack-network-unavailable' : 'slack-provider-rejected' }
    } catch { return { ok: false, code: 'slack-network-unavailable' } }
  }

  private async request(method: string, body: Record<string, unknown>, tokenKind: 'bot' | 'app', signal?: AbortSignal): Promise<SlackApiResult<Record<string, unknown>>> {
    try {
      if (signal?.aborted) return { ok: false, code: 'slack-network-unavailable' }
      const token = await (tokenKind === 'bot' ? this.deps.botToken() : this.deps.appToken())
      if (!token || signal?.aborted) return { ok: false, code: 'slack-provider-rejected' }
      const response = await this.deps.getPlatformFetch()(`${slackApiBase}/${method}`, {
        method: 'POST', signal, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json; charset=utf-8' }, body: JSON.stringify(body)
      })
      const json = await response.json() as { ok?: unknown }
      if (response.ok && json.ok === true) return { ok: true, value: json }
      if (response.status === 429) return { ok: false, code: 'slack-rate-limited', retryAfterMs: retryAfter(response.headers.get('retry-after')) }
      return { ok: false, code: response.status >= 500 ? 'slack-network-unavailable' : 'slack-provider-rejected' }
    } catch { return { ok: false, code: 'slack-network-unavailable' } }
  }
}

function retryAfter(value: string | null): number {
  const seconds = Number(value)
  return Math.max(1_000, Math.min(60_000, Number.isFinite(seconds) ? seconds * 1_000 : 1_000))
}

/** 扩展名只由嗅探出的 mime 决定（上游按扩展名与 content-type 认图），字节本身不落盘。 */
function imageExtension(mime: string): string {
  return mime === 'image/png' ? 'png' : 'jpg'
}
