import { describe, expect, it, vi } from 'vitest'

import { TelegramApiClient, classifyTransportFailure } from './TelegramApiClient'
import { createTelegramChannelSmoke } from './telegramChannelSmoke'

/**
 * 启用自检的现场证据（用户 2026-11-04 的「网络或代理连不通」）。
 *
 * 当时的写法是：握手 `getMe` 之后用 `updates(0, AbortSignal.timeout(10_000))` 做「一次接收往返」，
 * 而 `updates()` 发的是 **25 秒长轮询**。没有新消息时 Telegram 会把请求挂住，10 秒 abort 必然先到，
 * 自检于是必然失败，并被归一成 `telegram-network-unavailable`——代理和 token 都是好的，
 * 用户却被指去看代理。所以这里钉住三条：接收往返必须是 `timeout: 0`、代理失败与目标失败必须分开、
 * 没有 Token 时一个请求都不许发出去。
 */

type Recorded = { url: string; body: Record<string, unknown> }

function fakeFetch(responses: Array<Response | Error>): { fetch: typeof fetch; calls: Recorded[] } {
  const calls: Recorded[] = []
  let index = 0
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) as Record<string, unknown> : {}
    calls.push({ url: String(input), body })
    const next = responses[index] ?? responses[responses.length - 1]
    index += 1
    if (next instanceof Error) throw next
    return next
  }) as typeof fetch
  return { fetch: fetchImpl, calls }
}

function ok(result: unknown): Response {
  return new Response(JSON.stringify({ ok: true, result }), { status: 200, headers: { 'content-type': 'application/json' } })
}

function fail(status: number, description: string): Response {
  return new Response(JSON.stringify({ ok: false, error_code: status, description }), { status, headers: { 'content-type': 'application/json' } })
}

function smokeWith(fetchImpl: typeof fetch, token: string | null = '8830:secret') {
  return createTelegramChannelSmoke({
    credentialMetadata: () => ({ ref: 'channel-credential:channel-1' }),
    readSecret: async () => (token === null ? null : { bot_token: token }),
    getPlatformFetch: () => fetchImpl
  })
}

describe('telegram enable self-check', () => {
  it('probes updates with a short poll, not the 25 second long poll', async () => {
    const { fetch, calls } = fakeFetch([ok({ username: 'bot' }), ok([])])
    const smoke = smokeWith(fetch)

    await expect(smoke({ id: 'channel-1', type: 'telegram' })).resolves.toEqual({ ok: true })

    expect(calls).toHaveLength(2)
    expect(calls[0].url).toContain('/bot8830:secret/getMe')
    expect(calls[1].url).toContain('/getUpdates')
    // 这条断言就是根因本身：长轮询 + 更短的 abort = 自己把自己掐断。
    expect(calls[1].body.timeout).toBe(0)
    expect(calls[1].body.offset).toBe(0)
  })

  it('still accepts an empty update list as a successful round trip', async () => {
    const { fetch } = fakeFetch([ok({ username: 'bot' }), ok([])])
    await expect(smokeWith(fetch)({ id: 'channel-1', type: 'telegram' })).resolves.toEqual({ ok: true })
  })

  it('does not send a single request when the channel has no token', async () => {
    const { fetch, calls } = fakeFetch([ok({ username: 'bot' })])
    await expect(smokeWith(fetch, null)({ id: 'channel-1', type: 'telegram' })).resolves.toEqual({
      ok: false, code: 'channel-credential-missing'
    })
    expect(calls).toHaveLength(0)
  })

  it('reports a rejected bot credential as provider-rejected, not as a network problem', async () => {
    const { fetch } = fakeFetch([fail(401, 'Unauthorized')])
    await expect(smokeWith(fetch)({ id: 'channel-1', type: 'telegram' })).resolves.toEqual({
      ok: false, code: 'telegram-provider-rejected'
    })
  })

  it('reports another process holding the bot as conflict', async () => {
    const { fetch } = fakeFetch([ok({ username: 'bot' }), fail(409, 'Conflict: terminated by other getUpdates request')])
    await expect(smokeWith(fetch)({ id: 'channel-1', type: 'telegram' })).resolves.toEqual({
      ok: false, code: 'telegram-conflict'
    })
  })

  it('separates a dead proxy hop from an unreachable target', async () => {
    const proxyDown = fakeFetch([ok({ username: 'bot' }), new Error('TypeError: net::ERR_PROXY_CONNECTION_FAILED')])
    await expect(smokeWith(proxyDown.fetch)({ id: 'channel-1', type: 'telegram' })).resolves.toEqual({
      ok: false, code: 'telegram-proxy-unavailable'
    })

    const targetDown = fakeFetch([ok({ username: 'bot' }), new Error('TypeError: net::ERR_CONNECTION_TIMED_OUT')])
    await expect(smokeWith(targetDown.fetch)({ id: 'channel-1', type: 'telegram' })).resolves.toEqual({
      ok: false, code: 'telegram-network-unavailable'
    })
  })

  it('never claims a proxy problem it cannot prove', () => {
    // 拿不到 Chromium 错误名（超时、我们自己 abort）时只能说网络不可用：宁可保守，不编原因。
    expect(classifyTransportFailure(new Error('The operation was aborted due to timeout'))).toBe('telegram-network-unavailable')
    expect(classifyTransportFailure(new Error('fetch failed'))).toBe('telegram-network-unavailable')
    expect(classifyTransportFailure(new Error('TypeError: net::ERR_SOCKS_CONNECTION_FAILED'))).toBe('telegram-proxy-unavailable')
    expect(classifyTransportFailure(new Error('TypeError: net::ERR_TUNNEL_CONNECTION_FAILED'))).toBe('telegram-proxy-unavailable')
    const aborted = new AbortController()
    aborted.abort()
    expect(classifyTransportFailure(new Error('net::ERR_PROXY_CONNECTION_FAILED'), aborted.signal)).toBe('telegram-network-unavailable')
  })

  it('does not classify a plain 500 as a proxy failure', async () => {
    const { fetch } = fakeFetch([ok({ username: 'bot' }), fail(502, 'Bad Gateway')])
    await expect(smokeWith(fetch)({ id: 'channel-1', type: 'telegram' })).resolves.toEqual({
      ok: false, code: 'telegram-network-unavailable'
    })
  })

  it('keeps the smoke to a bounded number of requests even when nothing is pending', async () => {
    const { fetch, calls } = fakeFetch([ok({ username: 'bot' }), ok([])])
    const started = Date.now()
    await smokeWith(fetch)({ id: 'channel-1', type: 'telegram' })
    expect(calls).toHaveLength(2)
    expect(Date.now() - started).toBeLessThan(1_000)
  })
})

describe('telegram api client transport', () => {
  it('exposes probe as a short poll while updates keeps the runtime long poll', async () => {
    const { fetch, calls } = fakeFetch([ok([]), ok([])])
    const client = new TelegramApiClient({ getPlatformFetch: () => fetch, token: async () => 'token' })
    const controller = new AbortController()
    await client.probe(controller.signal)
    await client.updates(0, controller.signal)
    expect(calls[0].body).toMatchObject({ offset: 0, timeout: 0 })
    expect(calls[1].body).toMatchObject({ offset: 0, timeout: 25 })
  })

  it('does not fetch when the token is missing', async () => {
    const spy = vi.fn()
    const client = new TelegramApiClient({ getPlatformFetch: () => spy as unknown as typeof fetch, token: async () => null })
    await expect(client.probe()).resolves.toEqual({ ok: false, code: 'telegram-provider-rejected' })
    expect(spy).not.toHaveBeenCalled()
  })
})
