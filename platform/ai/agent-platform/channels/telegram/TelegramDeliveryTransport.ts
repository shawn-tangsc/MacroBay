import type { ChannelDeliveryTransport, ChannelDeliveryTransportResult } from '../ChannelDeliveryContracts'
import { TelegramApiClient } from './TelegramApiClient'
import { splitTelegramText } from './TelegramContracts'

/** Runtime-owned clients avoid exposing a token/reference to the delivery ledger or its DTOs. */
export class TelegramDeliveryTransport implements ChannelDeliveryTransport {
  private readonly clients = new Map<string, TelegramApiClient>()
  private readonly lifetimeByChannel = new Map<string, { isCurrent: () => boolean; signal: AbortSignal }>()

  setClient(channelId: string, client: TelegramApiClient, lifetime: { isCurrent: () => boolean; signal: AbortSignal }): void {
    this.clients.set(channelId, client)
    this.lifetimeByChannel.set(channelId, lifetime)
  }
  removeClient(channelId: string): void {
    this.clients.delete(channelId)
    this.lifetimeByChannel.delete(channelId)
  }

  async send(input: { channelId: string; providerConversationKey: string; text: string; idempotencyKey: string }): Promise<ChannelDeliveryTransportResult> {
    const client = this.clients.get(input.channelId)
    const lifetime = this.lifetimeByChannel.get(input.channelId)
    if (!client || !lifetime || lifetime.signal.aborted || !lifetime.isCurrent()) return { kind: 'failed', code: 'delivery-host-unavailable' }
    // 会话键是 `telegram:chat:<id>`（入站写进去的就是这个），而 Telegram 的 `chat_id` 只认那串数字。
    // 以前整串直接当 chat_id 发出去 → 400 `chat not found` → 被记成「凭据被拒」，用户看到「发送失败」。
    const chatId = telegramChatId(input.providerConversationKey)
    if (!chatId) return { kind: 'failed', code: 'delivery-target-invalid' }
    let lastMessageId: number | null = null
    for (const segment of splitTelegramText(input.text)) {
      // A fence between delivery admission and a later segment must not leak a stale send.
      if (lifetime.signal.aborted || !lifetime.isCurrent()) return { kind: 'failed', code: 'delivery-host-unavailable' }
      let response = await client.sendMessage(chatId, segment, false, lifetime.signal)
      if (lifetime.signal.aborted || !lifetime.isCurrent()) return { kind: 'failed', code: 'delivery-host-unavailable' }
      if (!response.ok && response.parseRejected) {
        if (lifetime.signal.aborted || !lifetime.isCurrent()) return { kind: 'failed', code: 'delivery-host-unavailable' }
        response = await client.sendMessage(chatId, segment, true, lifetime.signal)
        if (lifetime.signal.aborted || !lifetime.isCurrent()) return { kind: 'failed', code: 'delivery-host-unavailable' }
      }
      if (!response.ok) return mapFailure(response.code, response.providerDetail)
      if (typeof response.value.messageId === 'number') lastMessageId = response.value.messageId
    }
    // 上游 id 只作证据：没有它（个别网关不回 message_id）就不写 detail，别编一个。
    return {
      kind: 'delivered',
      ...(lastMessageId === null ? {} : { detail: JSON.stringify({ telegramMessageId: lastMessageId }) })
    }
  }

  supportsIdempotency(): boolean { return false }

  async typing(input: { channelId: string; providerConversationKey: string }): Promise<void> {
    const lifetime = this.lifetimeByChannel.get(input.channelId)
    if (!lifetime || lifetime.signal.aborted || !lifetime.isCurrent()) return
    await this.clients.get(input.channelId)?.typing(input.providerConversationKey, lifetime.signal)
  }
}

/**
 * 从入站写入的会话键里取出 Telegram 的 chat id。
 *
 * 入站统一把会话键写成 `<platform>:chat:<id>`（跨平台一致），发送侧必须按平台自己解析——
 * 直接把整串当 `chat_id`，Telegram 会回 400 `chat not found`，看起来像“凭据被拒”。
 */
export function telegramChatId(providerConversationKey: string): string | null {
  const match = /^telegram:chat:(.+)$/.exec(providerConversationKey.trim())
  const candidate = (match ? match[1] : providerConversationKey).trim()
  // 私聊/群/频道都是数字 id（可能有负号）；@name 形式不接受——那是另一套解析，别在这里猜。
  return /^-?\d+$/.test(candidate) ? candidate : null
}

function mapFailure(code: string, detail?: string): ChannelDeliveryTransportResult {
  if (code === 'telegram-rate-limited') return { kind: 'failed', code: 'delivery-rate-limited', ...(detail ? { detail } : {}) }
  if (code === 'telegram-provider-rejected') return { kind: 'failed', code: 'delivery-provider-rejected', ...(detail ? { detail } : {}) }
  if (code === 'telegram-network-unavailable' || code === 'telegram-proxy-unavailable') {
    return { kind: 'unknown-after-send', ...(detail ? { detail } : {}) }
  }
  return { kind: 'unknown-after-send' }
}
