import { describe, expect, it } from 'vitest'

import { createSlackChannelSmoke } from './slackChannelSmoke'

/**
 * Slack 启用自检的判据。这里钉住的是「两把凭据各证一件事」：
 * 只有 Bot Token 过关、App Token 或 Socket Mode 不行时，用户拿到的是「已启用但收不到消息」——
 * 那种状态没有日志、没有报错，只有沉默，所以自检必须替他把这一步问出来。
 */

type Recorded = { url: string; authorization: string | null }

function fakeFetch(responses: Array<Response | Error>): { fetch: typeof fetch; calls: Recorded[] } {
  const calls: Recorded[] = []
  let index = 0
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers)
    calls.push({ url: String(input), authorization: headers.get('authorization') })
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

const BOT = 'xoxb-bot-token-secret'
const APP = 'xapp-app-token-secret'

function smokeWith(
  fetchImpl: typeof fetch,
  secret: Record<string, string> | null | Error = { bot_token: BOT, app_token: APP }
) {
  return createSlackChannelSmoke({
    credentialMetadata: () => ({ ref: 'channel-credential:channel-1' }),
    readSecret: async () => {
      if (secret instanceof Error) throw secret
      return secret
    },
    getPlatformFetch: () => fetchImpl,
    describeProxy: async () => 'PROXY 127.0.0.1:7888',
    fetchKind: 'net'
  })
}

describe('slack enable self-check', () => {
  it('proves the bot token and the Socket Mode app token in two calls', async () => {
    const { fetch, calls } = fakeFetch([
      json({ ok: true, user_id: 'U123' }),
      json({ ok: true, url: 'wss://wss-primary.slack.com/link/?ticket=t' })
    ])
    const smoke = smokeWith(fetch)

    await expect(smoke({ id: 'channel-1', type: 'slack' })).resolves.toEqual({ ok: true })

    expect(calls.map((call) => call.url)).toEqual([
      'https://slack.com/api/auth.test',
      'https://slack.com/api/apps.connections.open'
    ])
    // 第一步必须是 Bot Token，第二步必须是 App Token：拿错一把会得到 invalid_auth。
    expect(calls[0].authorization).toBe(`Bearer ${BOT}`)
    expect(calls[1].authorization).toBe(`Bearer ${APP}`)
  })

  it('sends no request at all when a credential is missing', async () => {
    const incomplete: Array<Record<string, string> | null> = [null, {}, { bot_token: BOT }, { app_token: APP }]
    for (const secret of incomplete) {
      const { fetch, calls } = fakeFetch([json({ ok: true })])
      const smoke = smokeWith(fetch, secret)
      await expect(smoke({ id: 'channel-1', type: 'slack' })).resolves.toEqual({ ok: false, code: 'channel-credential-missing' })
      expect(calls).toHaveLength(0)
    }
  })

  it('separates an unreadable credential from a missing one', async () => {
    const { fetch, calls } = fakeFetch([json({ ok: true })])
    const smoke = smokeWith(fetch, new Error('vault locked'))
    await expect(smoke({ id: 'channel-1', type: 'slack' })).resolves.toEqual({ ok: false, code: 'channel-credential-unavailable' })
    expect(calls).toHaveLength(0)
  })

  it('reports a rejected bot token without asking the app token side', async () => {
    const { fetch, calls } = fakeFetch([json({ ok: false, error: 'invalid_auth' })])
    const smoke = smokeWith(fetch)
    await expect(smoke({ id: 'channel-1', type: 'slack' })).resolves.toEqual({
      ok: false,
      code: 'slack-provider-rejected',
      proxy: 'PROXY 127.0.0.1:7888',
      fetch: 'net'
    })
    expect(calls).toHaveLength(1)
  })

  it('catches Socket Mode being off even though the bot token is fine', async () => {
    const { fetch } = fakeFetch([
      json({ ok: true, user_id: 'U123' }),
      json({ ok: false, error: 'not_allowed_token_type' })
    ])
    const smoke = smokeWith(fetch)
    await expect(smoke({ id: 'channel-1', type: 'slack' })).resolves.toMatchObject({ ok: false, code: 'slack-provider-rejected' })
  })

  it('keeps network failure, rate limiting and rejected credentials apart', async () => {
    const failing = smokeWith(fakeFetch([new TypeError('fetch failed')]).fetch)
    await expect(failing({ id: 'channel-1', type: 'slack' })).resolves.toMatchObject({ ok: false, code: 'slack-network-unavailable' })

    const limited = smokeWith(fakeFetch([json({ ok: false, error: 'ratelimited' }, 429)]).fetch)
    await expect(limited({ id: 'channel-1', type: 'slack' })).resolves.toMatchObject({ ok: false, code: 'slack-rate-limited' })
  })

  it('never puts a token in the result it hands back', async () => {
    for (const responses of [[json({ ok: true, user_id: 'U1' }), json({ ok: true, url: 'wss://x/y' })], [json({ ok: false, error: 'invalid_auth' })]] as const) {
      const result = await smokeWith(fakeFetch([...responses] as Array<Response | Error>).fetch)({ id: 'channel-1', type: 'slack' })
      expect(JSON.stringify(result)).not.toContain(BOT)
      expect(JSON.stringify(result)).not.toContain(APP)
    }
  })

  it('shows nothing to a caller asking it to check another adapter', async () => {
    const { fetch, calls } = fakeFetch([json({ ok: true })])
    await expect(smokeWith(fetch)({ id: 'channel-1', type: 'telegram' })).resolves.toEqual({ ok: false, code: 'adapter-not-supported' })
    expect(calls).toHaveLength(0)
  })
})
