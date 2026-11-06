import { describe, expect, it, vi } from 'vitest'

import { TelegramApiClient } from './TelegramApiClient'
import { TelegramDeliveryTransport, telegramChatId } from './TelegramDeliveryTransport'

/**
 * 回复发不出去的真因（用户 2026-11-04 17:06）：入站把会话键写成 `telegram:chat:<id>`，
 * 发送侧却**整串**当成 `chat_id` 发给 Telegram → 400 `chat not found` → 被判成
 * 「凭据被拒」，界面上只剩一句「发送失败」。
 *
 * 这里钉三件事：键要解析成数字 id；解析不出来要说「目标不对」而不是网络；发送失败要把
 * Telegram 的说明带上来（脱敏截断），这样界面与审计能说下一句。
 */

function fakeTelegram(responses: Array<{ status: number; body: unknown }>) {
  const calls: Array<{ url: string; body: Record<string, unknown> }> = []
  let index = 0
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      url: String(input),
      body: typeof init?.body === 'string' ? JSON.parse(init.body) as Record<string, unknown> : {}
    })
    const next = responses[Math.min(index, responses.length - 1)]
    index += 1
    return new Response(JSON.stringify(next.body), { status: next.status, headers: { 'content-type': 'application/json' } })
  }) as typeof fetch
  return { fetch: fetchImpl, calls }
}

function transportWith(fetchImpl: typeof fetch) {
  const transport = new TelegramDeliveryTransport()
  const controller = new AbortController()
  transport.setClient('channel-a', new TelegramApiClient({ getPlatformFetch: () => fetchImpl, token: async () => '8830:secret' }), {
    isCurrent: () => true,
    signal: controller.signal
  })
  return transport
}

describe('telegram delivery target', () => {
  it('sends to the numeric chat id parsed out of the conversation key', async () => {
    const { fetch, calls } = fakeTelegram([{ status: 200, body: { ok: true, result: true } }])
    const transport = transportWith(fetch)

    const result = await transport.send({
      channelId: 'channel-a', providerConversationKey: 'telegram:chat:819234567', text: '你好', idempotencyKey: 'k1'
    })

    expect(result).toEqual({ kind: 'delivered' })
    expect(calls[0].url).toContain('/sendMessage')
    // 关键：发的是 `819234567`，不是 `telegram:chat:819234567`。
    expect(calls[0].body.chat_id).toBe('819234567')
  })

  it('accepts a bare numeric chat id from older rows', async () => {
    const { fetch, calls } = fakeTelegram([{ status: 200, body: { ok: true, result: true } }])
    await transportWith(fetch).send({
      channelId: 'channel-a', providerConversationKey: '-1001234567890', text: 'hi', idempotencyKey: 'k2'
    })
    expect(calls[0].body.chat_id).toBe('-1001234567890')
  })

  it('reports an unparsable target as a target problem, never as a network problem', async () => {
    const { fetch, calls } = fakeTelegram([{ status: 200, body: { ok: true, result: true } }])
    const result = await transportWith(fetch).send({
      channelId: 'channel-a', providerConversationKey: 'telegram:chat:@somebody', text: 'hi', idempotencyKey: 'k3'
    })
    expect(result).toEqual({ kind: 'failed', code: 'delivery-target-invalid' })
    expect(calls).toHaveLength(0)
  })

  it('carries the redacted provider detail on a rejected send', async () => {
    const { fetch } = fakeTelegram([{ status: 400, body: { ok: false, error_code: 400, description: 'Bad Request: chat not found' } }])
    const result = await transportWith(fetch).send({
      channelId: 'channel-a', providerConversationKey: 'telegram:chat:42', text: 'hi', idempotencyKey: 'k4'
    })
    expect(result).toEqual({
      kind: 'failed',
      code: 'delivery-provider-rejected',
      detail: 'Bad Request: chat not found'
    })
  })

  it('parses only what Telegram would accept as a chat id', () => {
    expect(telegramChatId('telegram:chat:42')).toBe('42')
    expect(telegramChatId('42')).toBe('42')
    expect(telegramChatId('telegram:chat:-1001234567890')).toBe('-1001234567890')
    expect(telegramChatId('telegram:chat:')).toBeNull()
    expect(telegramChatId('telegram:chat:@bot')).toBeNull()
    expect(telegramChatId('slack:channel:C123')).toBeNull()
  })
})
