import { describe, expect, it } from 'vitest'

import { createQqChannelSmoke } from './qqChannelSmoke'

/**
 * QQ 启用自检：**两步**，少一步都会把「连不上」说成「已启用」。
 * 1. 换 token（证凭据活）；2. 拿网关地址（证 token 能用、出网通）。
 */

const APP_ID = '102030405'
const SECRET = 'qq-client-secret-value'

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

function smokeWith(fetchImpl: typeof fetch, secret: Record<string, string> | null | Error = { app_id: APP_ID, client_secret: SECRET }) {
  return createQqChannelSmoke({
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

describe('qq enable self-check', () => {
  it('exchanges the credentials and then proves the token can reach the gateway', async () => {
    const { fetch, calls } = fakeFetch([
      json({ access_token: 'qq-access-token', expires_in: 7_200 }),
      json({ url: 'wss://api.sgroup.qq.com/websocket/' })
    ])

    await expect(smokeWith(fetch)({ id: 'channel-1', type: 'qq' })).resolves.toEqual({ ok: true })
    expect(calls.map((call) => call.url)).toEqual([
      'https://bots.qq.com/app/getAppAccessToken',
      'https://api.sgroup.qq.com/gateway'
    ])
    // 第二步带的是 `QQBot {token}`，不是 app_secret。
    expect(calls[1].authorization).toBe('QQBot qq-access-token')
  })

  it('sends no request at all without a stored or readable credential', async () => {
    const incomplete: Array<Record<string, string> | null | Error> = [null, {}, { app_id: APP_ID }, new Error('vault locked')]
    for (const secret of incomplete) {
      const { fetch, calls } = fakeFetch([json({})])
      const result = await smokeWith(fetch, secret)({ id: 'channel-1', type: 'qq' })
      expect(result).toMatchObject({ ok: false })
      expect(calls).toHaveLength(0)
    }
    await expect(smokeWith(fakeFetch([json({})]).fetch, new Error('vault locked'))({ id: 'channel-1', type: 'qq' }))
      .resolves.toEqual({ ok: false, code: 'channel-credential-unavailable' })
  })

  it('keeps rejected credentials, rate limiting and a dead network apart', async () => {
    await expect(smokeWith(fakeFetch([json({}, 401)]).fetch)({ id: 'channel-1', type: 'qq' }))
      .resolves.toMatchObject({ ok: false, code: 'qq-provider-rejected' })
    await expect(smokeWith(fakeFetch([json({ access_token: 't', expires_in: 1 }), json({}, 429)]).fetch)({ id: 'channel-1', type: 'qq' }))
      .resolves.toMatchObject({ ok: false, code: 'qq-rate-limited' })
    await expect(smokeWith(fakeFetch([new TypeError('fetch failed')]).fetch)({ id: 'channel-1', type: 'qq' }))
      .resolves.toMatchObject({ ok: false, code: 'qq-network-unavailable' })
  })

  it('fails when the token is fine but the gateway address is not usable', async () => {
    // 只验第一步会把这条读成「已启用」——那正是「拿到了 token 却连不上」的假绿。
    const { fetch } = fakeFetch([json({ access_token: 't', expires_in: 7_200 }), json({ url: 'http://api.sgroup.qq.com/websocket/' })])
    await expect(smokeWith(fetch)({ id: 'channel-1', type: 'qq' })).resolves.toMatchObject({ ok: false, code: 'qq-provider-rejected' })
  })

  it('never hands the secret back and refuses to check another adapter', async () => {
    const result = await smokeWith(fakeFetch([
      json({ access_token: 'qq-access-token', expires_in: 7_200 }),
      json({ url: 'wss://api.sgroup.qq.com/websocket/' })
    ]).fetch)({ id: 'channel-1', type: 'qq' })
    expect(JSON.stringify(result)).not.toContain(SECRET)

    const { fetch, calls } = fakeFetch([json({})])
    await expect(smokeWith(fetch)({ id: 'channel-1', type: 'slack' })).resolves.toEqual({ ok: false, code: 'adapter-not-supported' })
    expect(calls).toHaveLength(0)
  })
})
