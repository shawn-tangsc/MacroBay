import type { TelegramApiFailure, TelegramApiResult, TelegramUpdate } from './TelegramContracts'
import { telegramApiBase } from './TelegramContracts'

type Fetch = typeof fetch

/** 自检要「一次接收往返」，不是等新消息：短轮询必须用 0，长轮询会让自检等到自己超时。 */
const allowedUpdates = ['message', 'channel_post']

/**
 * Chromium 的代理层错误。命中它们说明**代理这一跳**没连上（代理没开、端口不对、隧道被拒），
 * 与「代理通了但 Telegram 不可达」是两种处境，用户要修的地方也不同。
 */
const proxyTransportErrors = [
  'ERR_PROXY_CONNECTION_FAILED',
  'ERR_TUNNEL_CONNECTION_FAILED',
  'ERR_PROXY_AUTH_UNSUPPORTED',
  'ERR_PROXY_AUTH_REQUESTED',
  'ERR_MANDATORY_PROXY_CONFIGURATION_FAILED',
  'ERR_SOCKS_CONNECTION_FAILED',
  'ERR_SOCKS_CONNECTION_HOST_UNREACHABLE'
]

/** All Telegram HTTP is injected from the desktop composition root. */
export class TelegramApiClient {
  constructor(private readonly deps: { getPlatformFetch: () => Fetch; token: () => Promise<string | null> }) {}

  async updates(offset: number, signal: AbortSignal): Promise<TelegramApiResult<TelegramUpdate[]>> {
    return this.request<TelegramUpdate[]>('getUpdates', { offset, timeout: 25, allowed_updates: allowedUpdates }, signal)
  }

  /**
   * 现场自检专用：**短轮询**，立刻返回一次（有没有新消息都算收到）。
   * 用 `updates()` 会走 25 秒长轮询，外面再套一个更短的超时，自检就必然被自己掐断——
   * 那正是「网络或代理连不通」这条假原因的来源。
   */
  async probe(signal?: AbortSignal): Promise<TelegramApiResult<TelegramUpdate[]>> {
    return this.request<TelegramUpdate[]>('getUpdates', { offset: 0, timeout: 0, allowed_updates: allowedUpdates }, signal)
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
      return {
        ok: false,
        code: 'telegram-provider-rejected',
        parseRejected: /parse entities|can't parse/i.test(json.description ?? ''),
        // Telegram 的说明是人类可读的（`Bad Request: chat not found` 这类），不含 token、不含 URL；
        // 截断后随失败一路带到投递审计里——用户看到「发送失败」时，我们总算有下一句可查。
        providerDetail: sanitizeProviderDetail(json.description)
      }
    } catch (error) {
      const transportError = chromiumErrorName(error)
      const failure = { ok: false as const, code: classifyTransportFailure(error, signal) }
      return transportError ? { ...failure, transportError } : failure
    }
  }
}

/**
 * 出网失败要能分辨「代理这一跳没通」与「目标不可达」：一个让用户去查代理，一个让用户去查网络。
 * 拿不到 Chromium 错误名时（超时/我们自己 abort）只能说「网络不可用」——宁可保守，不编原因。
 */
export function classifyTransportFailure(error: unknown, signal?: AbortSignal): TelegramApiFailure {
  if (signal?.aborted) return 'telegram-network-unavailable'
  const text = describeError(error)
  return proxyTransportErrors.some((marker) => text.includes(marker))
    ? 'telegram-proxy-unavailable'
    : 'telegram-network-unavailable'
}

/**
 * 只取 Chromium 的错误**名字**（如 `ERR_PROXY_CONNECTION_FAILED`），不带消息正文：
 * 消息里可能带完整 URL，而 URL 里有 bot token。名字本身足以分辨 DNS / 连接重置 / 代理拒绝。
 */
export function chromiumErrorName(error: unknown): string | undefined {
  return /net::(ERR_[A-Z0-9_]+)/.exec(describeError(error))?.[1]
}

function describeError(error: unknown): string {
  if (error instanceof Error) {
    const cause = error.cause instanceof Error ? error.cause.message : ''
    return `${error.name}: ${error.message} ${cause}`
  }
  return String(error)
}

/** 只保留 Telegram 自己的说明文字：去掉尖括号里的占位（可能含 id）与多余空白，截断到 120 字。 */
function sanitizeProviderDetail(description: unknown): string | undefined {
  if (typeof description !== 'string') return undefined
  const cleaned = description.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim()
  return cleaned ? cleaned.slice(0, 120) : undefined
}

function boundedRetry(value: unknown): number {
  const seconds = typeof value === 'number' && Number.isFinite(value) ? value : 1
  return Math.max(1_000, Math.min(60_000, Math.floor(seconds * 1_000)))
}
