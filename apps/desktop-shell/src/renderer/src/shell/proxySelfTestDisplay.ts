import type { PlatformText } from '../i18n/platformText'

/**
 * PLAT-61 代理自检（基础设置 → 代理）：只做展示与目标选择，真正的请求由主进程
 * `probeProviderProxyTarget` 用 Electron `net.fetch`（当前 session 代理）发起。
 */
export type ProxySelfTestResult = {
  ok: boolean
  status: number | null
  durationMs: number
  reasonCode: string | null
  targetHost: string
  /** `session.resolveProxy` 的原始返回；老主进程不给时为空。 */
  resolvedProxy?: string
  /** 第一跳是否真的经过代理；未知为 undefined，不能当成「走了」。 */
  proxied?: boolean
  endpointReachable?: boolean | null
  proxyEndpoint?: string | null
}

export type ProxySelfTestContext = {
  /** 只有「自定义代理」模式下，解析成 DIRECT 才算没生效。 */
  expectsProxy: boolean
  /** 主进程没给解析结果时的回退展示（模式名或地址）。 */
  fallbackProxyLabel: string
}

/** 用当前供应商的 origin 作为中性目标；没有可用供应商时回退 siliconflow。 */
export function buildProxyProbeUrl(baseUrl: string | null | undefined): string {
  const fallback = 'https://api.siliconflow.cn/'
  if (!baseUrl) return fallback
  try {
    const parsed = new URL(baseUrl.trim())
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return `${parsed.origin}/`
  } catch {
    return fallback
  }
  return fallback
}

export function formatProxySelfTestLine(
  result: ProxySelfTestResult,
  labels: PlatformText['preferences'],
  context: ProxySelfTestContext
): string {
  // 想走代理、网络栈却解析成直连：这次没走代理，不管请求是否成功都不许显示「通过」。
  if (context.expectsProxy && result.proxied === false) {
    return labels.proxySelfTestNotApplied(result.resolvedProxy?.trim() || 'DIRECT')
  }
  // 代理端点连不上是「代理坏了」，与目标站无关。
  if (result.endpointReachable === false) {
    return labels.proxySelfTestProxyUnreachable(result.proxyEndpoint?.trim() || result.targetHost)
  }
  if (result.ok) {
    return labels.proxySelfTestPassed(
      result.status ?? 0,
      (result.durationMs / 1000).toFixed(1),
      result.resolvedProxy?.trim() || context.fallbackProxyLabel
    )
  }
  return labels.proxySelfTestFailed(result.reasonCode ?? 'unknown', result.targetHost)
}
