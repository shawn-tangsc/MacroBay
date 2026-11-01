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
  labels: PlatformText,
  context: ProxySelfTestContext
): string {
  const preferences = labels.preferences
  // 想走代理、网络栈却解析成直连：这次没走代理，不管请求是否成功都不许显示「通过」。
  if (context.expectsProxy && result.proxied === false) {
    return preferences.proxySelfTestNotApplied(result.resolvedProxy?.trim() || 'DIRECT')
  }
  // 代理端点连不上是「代理坏了」，与目标站无关。
  if (result.endpointReachable === false) {
    return preferences.proxySelfTestProxyUnreachable(result.proxyEndpoint?.trim() || result.targetHost)
  }
  // 目标站点自己拒绝（401/403）：先说人话，别让用户以为代理坏了，也别把内部码当句子。
  const rejectedStatus = targetRejectedStatus(result)
  if (rejectedStatus !== null) {
    return preferences.proxySelfTestTargetRejected(rejectedStatus, result.targetHost)
  }
  if (result.ok) {
    const status = result.status ?? 0
    const seconds = (result.durationMs / 1000).toFixed(1)
    // 绿档分两支：只有网络栈确认走了代理才说「通过代理」；模式判断只来自 context，不在这里另算。
    return result.proxied === true
      ? preferences.proxySelfTestPassedViaProxy(status, seconds)
      : preferences.proxySelfTestReachable(status, seconds)
  }
  // 兜底分支同样不许把内部码当句子：按码映射到连接检查那套人话，码只留在主进程返回值与日志里。
  return `${proxyFailureSentence(result, labels)} · ${result.targetHost}`
}

function proxyFailureSentence(result: ProxySelfTestResult, labels: PlatformText): string {
  const sentences = labels.models
  switch (result.reasonCode) {
    case 'proxy_error':
      return sentences.connectionCheckReasonProxy
    case 'network_timeout':
    case 'timeout':
      return sentences.connectionCheckReasonTimeout
    case 'network_dns':
    case 'dns_error':
      return sentences.connectionCheckReasonDns
    case 'tls_error':
      return sentences.connectionCheckReasonTls
    case 'network_refused':
    case 'connection_refused':
      return sentences.connectionCheckReasonRefused
    case 'rate_limited':
      return sentences.connectionCheckReasonRateLimited
    case 'invalid_response':
      return sentences.connectionCheckReasonInvalidResponse
    default:
      return result.status === null
        ? sentences.connectionCheckReasonUnknown
        : sentences.connectionCheckReasonHttp(result.status)
  }
}

function targetRejectedStatus(result: ProxySelfTestResult): number | null {
  if (result.reasonCode === 'http_401' || result.status === 401) return result.status ?? 401
  if (result.reasonCode === 'http_403' || result.status === 403) return result.status ?? 403
  return null
}
