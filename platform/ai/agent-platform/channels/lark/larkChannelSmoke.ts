import type { AgentChannelType } from '../../schemas/channelSchemas'
import type { ChannelSmokeResult } from '../channelSmokeEnable'
import {
  createLarkLongConnection,
  larkWsTarget,
  larkWsTargetFor,
  type LarkLongConnection,
  type LarkLongConnectionEvent,
  type LarkProxyDecision
} from './LarkLongConnectionClient'
import type { LarkDomain } from './LarkContracts'
import { resolveLarkTenantAuth } from './larkTenantAuth'

/**
 * 用户点「启用」时对飞书的现场自检：**两步，缺一不可**。
 *
 * 1. **鉴权通过**：`app_id + app_secret` 换 `tenant_access_token`（证明这对凭据是活的）；
 * 2. **长连接能建**：用同一对凭据真的把长连接建起来再关掉（证明网关那侧通、代理生效）。
 *
 * 只做第 1 步等于把「拿到凭据却连不上」读成可用——而那条路上没有日志、没有报错，只有沉默。
 * 所以第 1 步成功、第 2 步失败时，这一条必须判失败。
 *
 * 代理解析不出来时**一个连接对象都不构造**：这台机器直连飞书必不通，落回默认直连会把
 * 「代理没配」伪装成「适配器坏了」。
 */
export type LarkChannelSmokeDeps = {
  credentialMetadata: (channelId: string) => { ref: string } | null
  readSecret: (ref: string) => Promise<Record<string, string> | null>
  getPlatformFetch: () => typeof fetch
  /** 平台那一侧：读网络设置 + 解析系统代理。返回 `null` = 解析不出来（不是直连）。 */
  resolveProxy: (targetUrl: string) => Promise<LarkProxyDecision | null>
  describeProxy?: (url: string) => Promise<string>
  fetchKind?: string
  /** 只给用例注入；生产走包装层的默认实现。 */
  createConnection?: (input: {
    appId: string
    appSecret: string
    resolveProxy: (targetUrl: string) => Promise<LarkProxyDecision | null>
    handshakeTimeoutMs?: number
    /** 租户所属那一站：SDK 的 `domain` 与代理目标都由它决定。 */
    domain: LarkDomain
  }) => LarkLongConnection
}

export function createLarkChannelSmoke(
  deps: LarkChannelSmokeDeps
): (channel: { id: string; type: AgentChannelType }) => Promise<ChannelSmokeResult> {
  return async ({ id, type }) => {
    // 通道类型是存储层的 `feishu`，适配器键是 `lark`：这里只认存储类型。
    if (type !== 'feishu') return { ok: false, code: 'adapter-not-supported' }
    const metadata = deps.credentialMetadata(id)
    if (!metadata) return { ok: false, code: 'channel-credential-missing' }
    let secret: Record<string, string> | null
    try {
      secret = await deps.readSecret(metadata.ref)
    } catch {
      return { ok: false, code: 'channel-credential-unavailable' }
    }
    const appId = secret?.app_id
    const appSecret = secret?.app_secret
    if (!appId || !appSecret) return { ok: false, code: 'channel-credential-missing' }

    // 先问代理：解析不出来就不往下走，连连接对象都不构造。
    const decision = await deps.resolveProxy(larkWsTarget)
    if (!decision) return { ok: false, code: 'lark-proxy-unresolved' }

    const proxy = await deps.describeProxy?.(larkWsTarget)
    const diagnostics = {
      ...(proxy ? { proxy } : {}),
      ...(deps.fetchKind ? { fetch: deps.fetchKind } : {})
    }

    // 第 1 步：鉴权 + **判出租户属于哪一站**（中国站/国际站两套租户，令牌只在所属站有效）。
    // 域名由凭据决定，不由产品拍一个：写死国际站会让中国站租户连上继而被 1000040351 踢掉。
    const auth = await resolveLarkTenantAuth({ appId, appSecret, getPlatformFetch: deps.getPlatformFetch })
    if (!auth.ok) return { ok: false, code: auth.code, ...diagnostics }
    const domain = auth.domain

    // 代理目标跟着域名走：两站不是同一个 host，代理判定必须按真正要连的那一个解析。
    const wsTarget = larkWsTargetFor(domain)
    const domainDecision = wsTarget === larkWsTarget ? decision : await deps.resolveProxy(wsTarget)
    if (!domainDecision) return { ok: false, code: 'lark-proxy-unresolved', ...diagnostics }

    // 第 2 步：长连接。**只鉴权成功不算通过**。
    const connection = deps.createConnection
      ? deps.createConnection({ appId, appSecret, resolveProxy: async () => domainDecision, domain })
      : createLarkLongConnection({
        appId,
        appSecret,
        resolveProxy: async () => domainDecision,
        getPlatformFetch: deps.getPlatformFetch,
        domain
      })
    try {
      const connected = await connection.connect({ onEvent: (_event: LarkLongConnectionEvent) => {} })
      if (!connected.ok) {
        return {
          ok: false,
          code: connected.code === 'lark-proxy-unresolved' ? 'lark-proxy-unresolved' : 'lark-connect-failed',
          ...diagnostics
        }
      }
      return { ok: true }
    } finally {
      connection.close()
    }
  }
}

