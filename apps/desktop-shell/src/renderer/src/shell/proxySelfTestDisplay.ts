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

/**
 * 结果的三档语气：`pass` 真走了代理（或系统模式下直连本来就合法），`partial` 到了站但没走代理
 * 或站点没给 2xx，`fail` 根本没到站。文案与语气必须同时从这个函数出，别让颜色另算一套判断。
 */
export type ProxySelfTestTone = 'pass' | 'partial' | 'fail'

export type ProxySelfTestView = { line: string; tone: ProxySelfTestTone; hint: string | null }

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

/**
 * 一次同时给出文案、语气与可选第二行。渲染层只照着 `tone` 上样式，不再自己判断成败。
 */
export function describeProxySelfTest(
  result: ProxySelfTestResult,
  labels: PlatformText,
  context: ProxySelfTestContext
): ProxySelfTestView {
  const preferences = labels.preferences

  // 代理端点连不上：代理坏了，与目标站无关。
  if (result.endpointReachable === false) {
    return {
      line: preferences.proxySelfTestProxyUnreachable(result.proxyEndpoint?.trim() || result.targetHost),
      tone: 'fail',
      hint: null
    }
  }

  // 目标站自己拒绝（401/403）：请求到了站，是「部分成功」，并给一行解释消解「代理坏了」的误判。
  const rejectedStatus = targetRejectedStatus(result)
  if (rejectedStatus !== null) {
    return {
      line: preferences.proxySelfTestTargetRejected(rejectedStatus, result.targetHost),
      tone: 'partial',
      hint: preferences.proxySelfTestAuthenticationHint
    }
  }

  if (result.ok) {
    const status = result.status ?? 0
    const seconds = (result.durationMs / 1000).toFixed(1)
    // 自定义模式下只有网络栈确认经代理才算通过；解析成直连或拿不到结论都只是「部分」。
    if (context.expectsProxy && result.proxied !== true) {
      return {
        line:
          result.proxied === false
            ? preferences.proxySelfTestNotApplied(result.resolvedProxy?.trim() || 'DIRECT')
            : preferences.proxySelfTestReachable(status, seconds),
        tone: 'partial',
        hint: null
      }
    }
    return {
      line:
        result.proxied === true
          ? preferences.proxySelfTestPassedViaProxy(status, seconds)
          : preferences.proxySelfTestReachable(status, seconds),
      tone: 'pass',
      hint: null
    }
  }

  // 没拿到 2xx：有 HTTP 状态码说明到了站（5xx/4xx 属「部分」），没有状态码说明没到站。
  return {
    line: `${proxyFailureSentence(result, labels)} · ${result.targetHost}`,
    tone: result.status === null ? 'fail' : 'partial',
    hint: null
  }
}

export function formatProxySelfTestLine(
  result: ProxySelfTestResult,
  labels: PlatformText,
  context: ProxySelfTestContext
): string {
  return describeProxySelfTest(result, labels, context).line
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
