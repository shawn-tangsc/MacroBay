import { larkApiBaseFor, type LarkDomain } from './LarkContracts'

/**
 * 用**同一把凭据**在两侧各试一次鉴权，拿到租户真正所属的那一站。
 *
 * 飞书中国站与国际站是两套租户：租户令牌只在所属站签发。写死国际站会让中国站租户「能连上、
 * 随后被 `1000040351 Incorrect domain name` 踢掉」——所以域名必须由租户决定，不能由产品拍一个。
 *
 * 顺序是有意的：先试 `feishu`（中国站是用户现场那一侧），不成立再试 `lark`。两次都失败时
 * 返回最后一次的失败码；两次都抛异常则归网络不可用。
 */
export type LarkTenantAuthResult =
  | { ok: true; domain: LarkDomain }
  /**
   * 两侧都没能确认这个应用属于哪一站。**不是** `lark-provider-rejected`：那是在说「凭据被拒绝」，
   * 而这里说的是「判不出域名/两站都不可达」——两件事，读者的下一步动作也不同。
   */
  | {
    ok: false
    code: 'lark-provider-rejected' | 'lark-tenant-domain-unresolved' | 'lark-network-unavailable' | 'lark-rate-limited'
  }

type LarkDomainAttempt =
  | { ok: true }
  | { ok: false; code: 'lark-provider-rejected' | 'lark-network-unavailable' | 'lark-rate-limited' }

export async function resolveLarkTenantAuth(input: {
  appId: string
  appSecret: string
  getPlatformFetch: () => typeof fetch
  /** 只给用例用：限定要试哪几站（默认两站都试）。生产不传。 */
  domains?: readonly LarkDomain[]
}): Promise<LarkTenantAuthResult> {
  const candidates = input.domains ?? (['feishu', 'lark'] as const)
  let sawNetworkFailure = false
  for (const domain of candidates) {
    const attempt = await authOnDomain(domain, input)
    if (attempt.ok) return { ok: true, domain }
    if (attempt.code === 'lark-rate-limited') return { ok: false, code: 'lark-rate-limited' }
    if (attempt.code === 'lark-network-unavailable') sawNetworkFailure = true
  }
  // 两站都不通 = 网络/代理问题。
  if (sawNetworkFailure) return { ok: false, code: 'lark-network-unavailable' }
  // 两站都被拒：默认探测下这是**凭据本身不对**（真错），如实说 rejected；
  // 只有在被限定到单一站的调用（`domains` 由调用方钉死，未来的“区域设置”)里，
  // “两站都拒”才可能是域名钉错了——那时说「判不出属于哪一站」，而不是把锅推给凭据。
  return { ok: false, code: input.domains === undefined ? 'lark-provider-rejected' : 'lark-tenant-domain-unresolved' }
}

async function authOnDomain(
  domain: LarkDomain,
  input: { appId: string; appSecret: string; getPlatformFetch: () => typeof fetch }
): Promise<LarkDomainAttempt> {
  try {
    const response = await input.getPlatformFetch()(`${larkApiBaseFor(domain)}/auth/v3/tenant_access_token/internal`, {
      method: 'POST',
      signal: AbortSignal.timeout(10_000),
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ app_id: input.appId, app_secret: input.appSecret })
    })
    if (response.status === 429) return { ok: false, code: 'lark-rate-limited' }
    if (response.status >= 400 && response.status < 500) return { ok: false, code: 'lark-provider-rejected' }
    if (!response.ok) return { ok: false, code: 'lark-network-unavailable' }
    const body = await response.json() as { code?: unknown; tenant_access_token?: unknown }
    // 飞书把拒绝放在 200 的 body 里（code !== 0）：这也算凭据被拒，不是网络问题。
    if (body.code !== 0 || typeof body.tenant_access_token !== 'string' || body.tenant_access_token.length === 0) {
      return { ok: false, code: 'lark-provider-rejected' }
    }
    return { ok: true }
  } catch {
    return { ok: false, code: 'lark-network-unavailable' }
  }
}
