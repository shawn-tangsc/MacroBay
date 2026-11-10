import { describe, expect, it, vi } from 'vitest'

import { createLarkChannelSmoke } from './larkChannelSmoke'
import type { LarkLongConnection } from './LarkLongConnectionClient'

/**
 * 飞书启用自检的判据：**鉴权 + 长连接，两步都要过**。
 * 只鉴权成功时判通过，等于把「拿到凭据却连不上」读成可用——而那条路上没有日志，只有沉默。
 */

const APP_ID = 'cli_12345678'
const APP_SECRET = 'app-secret-value'

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

function smoke(options: {
  auth?: Response | Error
  decision?: { kind: 'direct' } | { kind: 'proxy'; url: string } | null
  connect?: { ok: true } | { ok: false; code: 'lark-proxy-unresolved' | 'lark-connect-failed' }
  secret?: Record<string, string> | null | Error
}) {
  const fetched = vi.fn(async () => (options.auth ?? json({ code: 0, tenant_access_token: 't-123' })))
  const created: unknown[] = []
  const closed = vi.fn()
  const smokeFn = createLarkChannelSmoke({
    credentialMetadata: () => ({ ref: 'channel-credential:channel-1' }),
    readSecret: async () => {
      const secret = options.secret === undefined ? { app_id: APP_ID, app_secret: APP_SECRET } : options.secret
      if (secret instanceof Error) throw secret
      return secret
    },
    getPlatformFetch: () => fetched as unknown as typeof fetch,
    resolveProxy: async () => (options.decision === undefined ? { kind: 'proxy', url: 'http://127.0.0.1:7888' } : options.decision),
    describeProxy: async () => 'PROXY 127.0.0.1:7888',
    fetchKind: 'net',
    createConnection: () => {
      created.push(1)
      return {
        connect: async () => options.connect ?? { ok: true },
        close: closed
      } satisfies LarkLongConnection
    }
  })
  return { smokeFn, fetched, created, closed }
}

describe('lark enable self-check', () => {
  it('passes only when the credentials authenticate and the long connection really connects', async () => {
    const { smokeFn, fetched, created, closed } = smoke({})
    await expect(smokeFn({ id: 'channel-1', type: 'feishu' })).resolves.toEqual({ ok: true })
    expect(fetched).toHaveBeenCalledOnce()
    expect(created).toHaveLength(1)
    // 自检建起的连接必须关掉，不能顺手留一个在跑。
    expect(closed).toHaveBeenCalledOnce()
  })

  it('fails when the credentials are fine but the long connection cannot be established', async () => {
    const { smokeFn } = smoke({ connect: { ok: false, code: 'lark-connect-failed' } })
    // 这条就是「只鉴权成功」的绊线：凭据换到了 token，但网关连不上，一律判失败。
    await expect(smokeFn({ id: 'channel-1', type: 'feishu' }))
      .resolves.toMatchObject({ ok: false, code: 'lark-connect-failed' })
  })

  it('fails without constructing any connection when the proxy cannot be resolved', async () => {
    const { smokeFn, created, fetched } = smoke({ decision: null })
    await expect(smokeFn({ id: 'channel-1', type: 'feishu' }))
      .resolves.toEqual({ ok: false, code: 'lark-proxy-unresolved' })
    expect(created).toHaveLength(0)
    // 代理都没解析出来，鉴权请求也不该发：先问代理，再谈别的。
    expect(fetched).not.toHaveBeenCalled()
  })

  it('reports rejected credentials and network failure apart', async () => {
    await expect(smoke({ auth: json({ code: 10003, msg: 'invalid app_secret' }) }).smokeFn({ id: 'channel-1', type: 'feishu' }))
      .resolves.toMatchObject({ ok: false, code: 'lark-provider-rejected' })
    await expect(smoke({ auth: new TypeError('fetch failed') }).smokeFn({ id: 'channel-1', type: 'feishu' }))
      .resolves.toMatchObject({ ok: false, code: 'lark-network-unavailable' })
  })

  it('sends nothing and constructs nothing without a usable credential', async () => {
    for (const secret of [null, {}, new Error('vault locked')]) {
      const { smokeFn, fetched, created } = smoke({ secret })
      await expect(smokeFn({ id: 'channel-1', type: 'feishu' })).resolves.toMatchObject({ ok: false })
      expect(fetched).not.toHaveBeenCalled()
      expect(created).toHaveLength(0)
    }
    await expect(smoke({ secret: new Error('vault locked') }).smokeFn({ id: 'channel-1', type: 'feishu' }))
      .resolves.toEqual({ ok: false, code: 'channel-credential-unavailable' })
  })
})
