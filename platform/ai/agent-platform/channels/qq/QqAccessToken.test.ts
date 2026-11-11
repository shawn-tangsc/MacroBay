import { describe, expect, it } from 'vitest'

import { exchangeQqAccessToken, qqTokenUrl, readQqGateway } from './QqAccessToken'

/**
 * QQ 的凭据交换：`app_id + client_secret` → access token → wss 接入点。
 *
 * 这两步必须分开证：交换过了不等于网关能用（Token 可能没开通权限），网关拿到了也不等于
 * 这把 secret 是活的。失败三分（被拒 / 限流 / 连不通）与另外三家同一口径。
 */

type Recorded = { url: string; method: string | undefined; authorization: string | null; body: unknown }

function fakeFetch(responses: Array<Response | Error>): { fetch: typeof fetch; calls: Recorded[] } {
  const calls: Recorded[] = []
  let index = 0
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      url: String(input),
      method: init?.method,
      authorization: new Headers(init?.headers).get('authorization'),
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : null
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

const APP_ID = '102030405'
const SECRET = 'qq-client-secret-value'

describe('qq access token exchange', () => {
  it('trades the credentials for a token the documented way', async () => {
    const { fetch, calls } = fakeFetch([json({ access_token: 'qq-access-token', expires_in: 7200 })])

    await expect(exchangeQqAccessToken({ getPlatformFetch: () => fetch }, { appId: APP_ID, clientSecret: SECRET }))
      .resolves.toEqual({ ok: true, value: { accessToken: 'qq-access-token', expiresInSeconds: 7_200 } })

    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe(qqTokenUrl)
    expect(calls[0].method).toBe('POST')
    // 交换这一步带的是 appId/clientSecret，不是 Bearer：shape 错了会被直接拒。
    expect(calls[0].body).toEqual({ appId: APP_ID, clientSecret: SECRET })
    expect(calls[0].authorization).toBeNull()
  })

  it('refuses an answer without a usable token', async () => {
    for (const body of [json({}), json({ access_token: '' }), json({ access_token: 42 })]) {
      const { fetch } = fakeFetch([body])
      await expect(exchangeQqAccessToken({ getPlatformFetch: () => fetch }, { appId: APP_ID, clientSecret: SECRET }))
        .resolves.toEqual({ ok: false, code: 'qq-provider-rejected' })
    }
  })

  it('keeps rejected credentials, rate limiting and a dead network apart', async () => {
    await expect(exchangeQqAccessToken({ getPlatformFetch: () => fakeFetch([json({}, 401)]).fetch }, { appId: APP_ID, clientSecret: SECRET }))
      .resolves.toEqual({ ok: false, code: 'qq-provider-rejected' })
    await expect(exchangeQqAccessToken({ getPlatformFetch: () => fakeFetch([json({}, 429)]).fetch }, { appId: APP_ID, clientSecret: SECRET }))
      .resolves.toEqual({ ok: false, code: 'qq-rate-limited' })
    await expect(exchangeQqAccessToken({ getPlatformFetch: () => fakeFetch([new TypeError('fetch failed')]).fetch }, { appId: APP_ID, clientSecret: SECRET }))
      .resolves.toEqual({ ok: false, code: 'qq-network-unavailable' })
  })

  it('sends nothing without both credentials or with an aborted signal', async () => {
    const missing = fakeFetch([json({})])
    await expect(exchangeQqAccessToken({ getPlatformFetch: () => missing.fetch }, { appId: '', clientSecret: SECRET }))
      .resolves.toEqual({ ok: false, code: 'qq-provider-rejected' })
    await expect(exchangeQqAccessToken({ getPlatformFetch: () => missing.fetch }, { appId: APP_ID, clientSecret: '' }))
      .resolves.toEqual({ ok: false, code: 'qq-provider-rejected' })

    const aborted = new AbortController()
    aborted.abort()
    const cancelled = fakeFetch([json({})])
    await expect(exchangeQqAccessToken({ getPlatformFetch: () => cancelled.fetch }, { appId: APP_ID, clientSecret: SECRET }, aborted.signal))
      .resolves.toEqual({ ok: false, code: 'qq-network-unavailable' })
    expect(missing.calls).toHaveLength(0)
    expect(cancelled.calls).toHaveLength(0)
  })
})

describe('qq gateway address', () => {
  it('reads the wss address with the exchanged token', async () => {
    const { fetch, calls } = fakeFetch([json({ url: 'wss://api.sgroup.qq.com/websocket/' })])

    await expect(readQqGateway({ getPlatformFetch: () => fetch }, 'qq-access-token'))
      .resolves.toEqual({ ok: true, value: { url: 'wss://api.sgroup.qq.com/websocket/', shards: 1 } })
    expect(calls[0].authorization).toBe('QQBot qq-access-token')
  })

  it('refuses an address that is not wss', async () => {
    for (const url of ['http://api.sgroup.qq.com/websocket/', 'ws://x', '', 'javascript:alert(1)']) {
      const { fetch } = fakeFetch([json({ url })])
      await expect(readQqGateway({ getPlatformFetch: () => fetch }, 'qq-access-token'))
        .resolves.toEqual({ ok: false, code: 'qq-provider-rejected' })
    }
  })

  it('never hands the token back in the gateway result', async () => {
    const result = await readQqGateway({ getPlatformFetch: () => fakeFetch([json({ url: 'wss://a.b/c' })]).fetch }, 'qq-access-token-secret')
    expect(JSON.stringify(result)).not.toContain('qq-access-token-secret')
  })
})
