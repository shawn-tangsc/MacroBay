import { describe, expect, it } from 'vitest'

import { createDiscordChannelSmoke } from './discordChannelSmoke'

/**
 * Discord 启用自检：**一次** `/users/@me` 同时证明凭据活着、出网通、bot 存在。
 * 这里钉住的另一半是「失败要说得出是哪一种」：被拒 / 限流 / 连不通，三种下场完全不同。
 */

const TOKEN = 'discord-bot-token-secret'

type Recorded = { url: string; authorization: string | null }

function fakeFetch(responses: Array<Response | Error>): { fetch: typeof fetch; calls: Recorded[] } {
  const calls: Recorded[] = []
  let index = 0
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), authorization: new Headers(init?.headers).get('authorization') })
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

function smokeWith(fetchImpl: typeof fetch, secret: Record<string, string> | null | Error = { bot_token: TOKEN }) {
  return createDiscordChannelSmoke({
    credentialMetadata: () => ({ ref: 'channel-credential:channel-1' }),
    readSecret: async () => {
      if (secret instanceof Error) throw secret
      return secret
    },
    getPlatformFetch: () => fetchImpl,
    describeProxy: async () => 'PROXY 127.0.0.1:7888',
    fetchKind: 'net',
    userAgent: 'MacroBay/test (Discord adapter)'
  })
}

describe('discord enable self-check', () => {
  it('proves the token with one identity read', async () => {
    const { fetch, calls } = fakeFetch([json({ id: '999', username: 'macrobay-bot' })])

    await expect(smokeWith(fetch)({ id: 'channel-1', type: 'discord' })).resolves.toEqual({ ok: true })
    expect(calls).toEqual([{ url: 'https://discord.com/api/v10/users/@me', authorization: `Bot ${TOKEN}` }])
  })

  it('sends no request at all when the credential is missing or unreadable', async () => {
    for (const secret of [null, {}, new Error('vault locked')]) {
      const { fetch, calls } = fakeFetch([json({ ok: true })])
      const result = await smokeWith(fetch, secret)({ id: 'channel-1', type: 'discord' })
      expect(result).toMatchObject({ ok: false })
      expect(calls).toHaveLength(0)
    }
    await expect(smokeWith(fakeFetch([json({})]).fetch, null)({ id: 'channel-1', type: 'discord' }))
      .resolves.toEqual({ ok: false, code: 'channel-credential-missing' })
    await expect(smokeWith(fakeFetch([json({})]).fetch, new Error('vault locked'))({ id: 'channel-1', type: 'discord' }))
      .resolves.toEqual({ ok: false, code: 'channel-credential-unavailable' })
  })

  it('keeps a rejected token, rate limiting and a dead network apart', async () => {
    const rejected = await smokeWith(fakeFetch([json({ message: '401' }, 401)]).fetch)({ id: 'channel-1', type: 'discord' })
    // 401 是「换 Token」的错，与「权限/参数不对」分开说。
    expect(rejected).toMatchObject({ ok: false, code: 'discord-auth-rejected', proxy: 'PROXY 127.0.0.1:7888', fetch: 'net' })

    await expect(smokeWith(fakeFetch([json({ message: '429' }, 429)]).fetch)({ id: 'channel-1', type: 'discord' }))
      .resolves.toMatchObject({ ok: false, code: 'discord-rate-limited' })
    await expect(smokeWith(fakeFetch([new TypeError('fetch failed')]).fetch)({ id: 'channel-1', type: 'discord' }))
      .resolves.toMatchObject({ ok: false, code: 'discord-network-unavailable' })
  })

  it('never hands the token back and refuses to check another adapter', async () => {
    const result = await smokeWith(fakeFetch([json({ id: '999', username: 'bot' })]).fetch)({ id: 'channel-1', type: 'discord' })
    expect(JSON.stringify(result)).not.toContain(TOKEN)

    const { fetch, calls } = fakeFetch([json({})])
    await expect(smokeWith(fetch)({ id: 'channel-1', type: 'slack' })).resolves.toEqual({ ok: false, code: 'adapter-not-supported' })
    expect(calls).toHaveLength(0)
  })
})
