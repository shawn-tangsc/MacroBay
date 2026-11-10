import { describe, expect, it, vi } from 'vitest'

import { DiscordApiClient } from './DiscordApiClient'

/**
 * Discord 的**握手与身份**两次读（运行时接线第一步）：网关地址从 `/gateway/bot` 拿，
 * 机器人身份从 `/users/@me` 拿——后者正好是「启用自检」要的那一次请求。
 *
 * 协议依据（Discord Developers › Docs › Topical › Gateway）：**Get Gateway Bot** 返回
 * `{ url, shards, session_start_limit }`，`url` 是 wss 接入点；Resources › User 的
 * **Get Current User** 返回 `{ id, username }`。
 *
 * 这一层只读、不建连接：假 fetch，一次真请求都不发。
 */

type Recorded = { url: string; method: string | undefined; authorization: string | null }

function fakeFetch(responses: Array<Response | Error>): { fetch: typeof fetch; calls: Recorded[] } {
  const calls: Recorded[] = []
  let index = 0
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      url: String(input),
      method: init?.method,
      authorization: new Headers(init?.headers).get('authorization')
    })
    const next = responses[index] ?? responses[responses.length - 1]
    index += 1
    if (next instanceof Error) throw next
    return next
  }) as typeof fetch
  return { fetch: fetchImpl, calls }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

const TOKEN = 'discord-bot-token-secret'

function clientWith(fetchImpl: typeof fetch, token: string | null = TOKEN): DiscordApiClient {
  return new DiscordApiClient({ getPlatformFetch: () => fetchImpl, token: async () => token })
}

describe('discord REST handshake reads', () => {
  it('reads the gateway url and shard count from /gateway/bot', async () => {
    const { fetch, calls } = fakeFetch([json({ url: 'wss://gateway.discord.gg', shards: 1, session_start_limit: { total: 1000, remaining: 999 } })])

    await expect(clientWith(fetch).gatewayBot()).resolves.toEqual({ ok: true, value: { url: 'wss://gateway.discord.gg', shards: 1 } })
    expect(calls).toEqual([{ url: 'https://discord.com/api/v10/gateway/bot', method: 'GET', authorization: `Bot ${TOKEN}` }])
  })

  it('refuses a gateway url that is not wss', async () => {
    // 服务器给什么就连什么，是最容易把凭据送到别处的一条路；这里只认 wss。
    for (const url of ['http://gateway.discord.gg', 'ws://gateway.discord.gg', 'javascript:alert(1)', '']) {
      const { fetch } = fakeFetch([json({ url, shards: 1 })])
      await expect(clientWith(fetch).gatewayBot()).resolves.toEqual({ ok: false, code: 'discord-provider-rejected' })
    }
  })

  it('reads the bot identity from /users/@me, which is what the enable check needs', async () => {
    const { fetch, calls } = fakeFetch([json({ id: '1001', username: 'macrobay-bot' })])

    await expect(clientWith(fetch).currentUser()).resolves.toEqual({ ok: true, value: { id: '1001', username: 'macrobay-bot' } })
    expect(calls[0]).toEqual({ url: 'https://discord.com/api/v10/users/@me', method: 'GET', authorization: `Bot ${TOKEN}` })
  })

  it('rejects an identity answer without a usable id', async () => {
    for (const body of [json({ username: 'no-id' }), json({ id: '', username: 'x' }), json({ id: 1001 }), json({ id: 'bad id!' })]) {
      const { fetch } = fakeFetch([body])
      await expect(clientWith(fetch).currentUser()).resolves.toEqual({ ok: false, code: 'discord-provider-rejected' })
    }
  })

  it('keeps rejected credentials, rate limiting and network failure apart', async () => {
    await expect(clientWith(fakeFetch([json({ message: '401: Unauthorized' }, 401)]).fetch).gatewayBot())
      .resolves.toEqual({ ok: false, code: 'discord-provider-rejected' })
    await expect(clientWith(fakeFetch([json({ message: '429' }, 429)]).fetch).currentUser())
      .resolves.toEqual({ ok: false, code: 'discord-rate-limited' })
    await expect(clientWith(fakeFetch([json({ message: 'boom' }, 502)]).fetch).currentUser())
      .resolves.toEqual({ ok: false, code: 'discord-network-unavailable' })
    await expect(clientWith(fakeFetch([new TypeError('fetch failed')]).fetch).gatewayBot())
      .resolves.toEqual({ ok: false, code: 'discord-network-unavailable' })
  })

  it('sends nothing at all without a token or with an already aborted signal', async () => {
    const missing = fakeFetch([json({})])
    await expect(clientWith(missing.fetch, null).gatewayBot()).resolves.toEqual({ ok: false, code: 'discord-provider-rejected' })
    await expect(clientWith(missing.fetch, null).currentUser()).resolves.toEqual({ ok: false, code: 'discord-provider-rejected' })

    const aborted = new AbortController()
    aborted.abort()
    const cancelled = fakeFetch([json({})])
    await expect(clientWith(cancelled.fetch).currentUser(aborted.signal)).resolves.toEqual({ ok: false, code: 'discord-network-unavailable' })
    expect(missing.calls).toHaveLength(0)
    expect(cancelled.calls).toHaveLength(0)
  })

  it('never puts the token into what it hands back', async () => {
    const results = await Promise.all([
      clientWith(fakeFetch([json({ url: 'wss://gateway.discord.gg', shards: 1 })]).fetch).gatewayBot(),
      clientWith(fakeFetch([json({ id: '1001', username: 'bot' })]).fetch).currentUser(),
      clientWith(fakeFetch([json({ message: 'no' }, 401)]).fetch).gatewayBot()
    ])
    for (const result of results) expect(JSON.stringify(result)).not.toContain(TOKEN)
  })
})

describe('discord REST reads are proxy-aware by construction', () => {
  it('goes through the injected platform fetch, never a bare global', async () => {
    const fetch = vi.fn(async () => json({ id: '1001', username: 'bot' })) as unknown as typeof globalThis.fetch
    await clientWith(fetch).currentUser()
    expect(fetch).toHaveBeenCalledOnce()
  })
})
