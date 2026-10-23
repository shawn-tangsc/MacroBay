import type { TelegramApiResult, TelegramUpdate } from './TelegramContracts'
import { telegramApiBase } from './TelegramContracts'

type Fetch = typeof fetch

/** All Telegram HTTP is injected from the desktop composition root. */
export class TelegramApiClient {
  constructor(private readonly deps: { getPlatformFetch: () => Fetch; token: () => Promise<string | null> }) {}

  async updates(offset: number, signal: AbortSignal): Promise<TelegramApiResult<TelegramUpdate[]>> {
    return this.request<TelegramUpdate[]>('getUpdates', { offset, timeout: 25, allowed_updates: ['message', 'channel_post'] }, signal)
  }

  async sendMessage(chatId: string, text: string, plain: boolean, signal?: AbortSignal): Promise<TelegramApiResult<true>> {
    return this.request<true>('sendMessage', { chat_id: chatId, text, ...(plain ? {} : { parse_mode: 'MarkdownV2' }) }, signal)
  }

  async typing(chatId: string, signal?: AbortSignal): Promise<TelegramApiResult<true>> {
    return this.request<true>('sendChatAction', { chat_id: chatId, action: 'typing' }, signal)
  }

  async botUsername(signal?: AbortSignal): Promise<TelegramApiResult<string>> {
    const response = await this.request<{ username?: unknown }>('getMe', {}, signal)
    return response.ok && typeof response.value.username === 'string' && response.value.username.trim()
      ? { ok: true, value: response.value.username.trim() }
      : response.ok ? { ok: false, code: 'telegram-provider-rejected' } : response
  }

  private async request<T>(method: string, body: Record<string, unknown>, signal?: AbortSignal): Promise<TelegramApiResult<T>> {
    try {
      if (signal?.aborted) return { ok: false, code: 'telegram-network-unavailable' }
      const token = await this.deps.token()
      if (!token || signal?.aborted) return { ok: false, code: 'telegram-provider-rejected' }
      const response = await this.deps.getPlatformFetch()(`${telegramApiBase}/bot${token}/${method}`, {
        method: 'POST', signal, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body)
      })
      const json = await response.json() as { ok?: boolean; result?: T; error_code?: number; parameters?: { retry_after?: number }; description?: string }
      if (response.ok && json.ok === true) return { ok: true, value: json.result as T }
      if (response.status === 429) return { ok: false, code: 'telegram-rate-limited', retryAfterMs: boundedRetry(json.parameters?.retry_after) }
      if (response.status === 409) return { ok: false, code: 'telegram-conflict' }
      if (response.status >= 500) return { ok: false, code: 'telegram-network-unavailable' }
      return { ok: false, code: 'telegram-provider-rejected', parseRejected: /parse entities|can't parse/i.test(json.description ?? '') }
    } catch (error) {
      if (signal?.aborted) return { ok: false, code: 'telegram-network-unavailable' }
      return { ok: false, code: 'telegram-network-unavailable' }
    }
  }
}

function boundedRetry(value: unknown): number {
  const seconds = typeof value === 'number' && Number.isFinite(value) ? value : 1
  return Math.max(1_000, Math.min(60_000, Math.floor(seconds * 1_000)))
}
