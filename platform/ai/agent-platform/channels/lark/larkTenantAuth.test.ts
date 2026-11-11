import { describe, expect, it, vi } from 'vitest'

import { resolveLarkTenantAuth } from './larkTenantAuth'

/**
 * 租户域名由凭据决定：飞书中国站（`open.feishu.cn`）与国际站（`open.larksuite.com`）是两套租户，
 * 令牌只在所属站签发。写死国际站会让中国站租户「连上、ready、随后被 1000040351 踢掉」。
 */
const token = (body: Record<string, unknown>) => ({
  ok: true,
  status: 200,
  json: async () => body
}) as unknown as Response

function fetchByHost(handlers: Record<string, () => Response | Promise<Response>>) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    const host = url.includes('open.feishu.cn') ? 'feishu' : url.includes('open.larksuite.com') ? 'lark' : 'other'
    const handler = handlers[host] ?? handlers.other
    return await handler!()
  }) as unknown as typeof fetch
}

const ok = token({ code: 0, tenant_access_token: 't-123' })
const rejected = token({ code: 10003, msg: 'invalid app_secret' })

describe('resolving which station a tenant belongs to', () => {
  it('picks the Feishu China station when only it issues a token', async () => {
    const result = await resolveLarkTenantAuth({
      appId: 'cli_a',
      appSecret: 's',
      getPlatformFetch: () => fetchByHost({ feishu: () => ok, lark: () => rejected })
    })
    expect(result).toEqual({ ok: true, domain: 'feishu' })
  })

  it('still lets an international tenant through', async () => {
    const result = await resolveLarkTenantAuth({
      appId: 'cli_a',
      appSecret: 's',
      getPlatformFetch: () => fetchByHost({ feishu: () => rejected, lark: () => ok })
    })
    expect(result).toEqual({ ok: true, domain: 'lark' })
  })

  it('says the credentials are rejected when both stations reject them', async () => {
    const result = await resolveLarkTenantAuth({
      appId: 'cli_a',
      appSecret: 's',
      getPlatformFetch: () => fetchByHost({ feishu: () => rejected, lark: () => rejected })
    })
    expect(result).toEqual({ ok: false, code: 'lark-provider-rejected' })
  })

  it('calls a pinned single-station failure a domain mismatch, not bad credentials', async () => {
    // 反向判据：把基址钉死在国际站、租户其实在中国站时，不许说「凭据被拒」。
    const result = await resolveLarkTenantAuth({
      appId: 'cli_a',
      appSecret: 's',
      getPlatformFetch: () => fetchByHost({ feishu: () => ok, lark: () => rejected }),
      domains: ['lark']
    })
    expect(result).toEqual({ ok: false, code: 'lark-tenant-domain-unresolved' })
    expect((result as { code?: string }).code).not.toBe('lark-provider-rejected')
  })

  it('calls a double network failure a network problem', async () => {
    const result = await resolveLarkTenantAuth({
      appId: 'cli_a',
      appSecret: 's',
      getPlatformFetch: () => fetchByHost({ other: () => { throw new TypeError('fetch failed') } })
    })
    expect(result).toEqual({ ok: false, code: 'lark-network-unavailable' })
  })
})
