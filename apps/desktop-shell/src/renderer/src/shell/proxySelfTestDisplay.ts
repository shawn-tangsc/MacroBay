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
  /** 代理端点是否在本机回环上；回环连不上只能说明代理没起或端口错。 */
  proxyEndpointLoopback?: boolean | null
  /** 不经代理的对照探针：true 通、false 探过且失败、null 未探或拿不到结论（证据不足）。 */
  directProbeReachable?: boolean | null
  directProbeEndpoint?: string | null
}

/**
 * 归因档位。文案由界面设计出，这里只给判定：上层照档位挑句子，不自己猜。
 * `directProbeReachable === null`（没跑过/未发出）**不是**失败证据，一律走「证据不足」。
 */
export type ProxySelfTestTriage =
  | 'pass'
  | 'config-not-effective'
  | 'proxy-not-running'
  | 'local-network'
  | 'network-ok-proxy-suspect'
  | 'insufficient-evidence'
  | 'proxy-error'
  | 'target-site'

/**
 * 结果的三档语气：`pass` 真走了代理（或系统模式下直连本来就合法），`partial` 到了站但没走代理
 * 或站点没给 2xx，`fail` 根本没到站。文案与语气必须同时从这个函数出，别让颜色另算一套判断。
 */
export type ProxySelfTestTone = 'pass' | 'partial' | 'fail'

export type ProxySelfTestView = { line: string; tone: ProxySelfTestTone; hint: string | null; triage: ProxySelfTestTriage }

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

  // 代理端点连不上：只有回环上才能确定是代理没起或端口错；非回环分不清本机断网、
  // VPN、主机不在、防火墙，只说「连不上代理服务器本身」并给两步自查，绝不归到目标站。
  if (result.endpointReachable === false) {
    const endpoint = result.proxyEndpoint?.trim() || result.targetHost
    const loopback = result.proxyEndpointLoopback === true
    if (loopback) {
      // 回环连不上不进三档：只能说明代理没起或端口错。
      return {
        line: preferences.proxySelfTestProxyNotRunning(endpoint),
        tone: 'fail',
        hint: null,
        triage: 'proxy-not-running'
      }
    }
    const triage = triageForUnreachableServer(result)
    if (triage === 'local-network') {
      return {
        line: preferences.proxySelfTestLocalNetwork,
        tone: 'fail',
        hint: preferences.proxySelfTestLocalNetworkHint,
        triage
      }
    }
    if (triage === 'network-ok-proxy-suspect') {
      return {
        line: preferences.proxySelfTestProxyAfterProbe(endpoint),
        tone: 'fail',
        hint: preferences.proxySelfTestProxyAfterProbeHint,
        triage
      }
    }
    return {
      line: preferences.proxySelfTestUnattributable(endpoint),
      tone: 'fail',
      hint: preferences.proxySelfTestCauseUnknownHint,
      triage: 'insufficient-evidence'
    }
  }

  // 目标站拒绝（401/403）：请求到了站，是「部分成功」，并给一行解释消解「代理坏了」的误判。
  // 两者不是一回事：401 是「站点要鉴权，这次没带 Key 所以正常」，403 是「站点把请求挡下来了」。
  const rejectedStatus = targetRejectedStatus(result)
  if (rejectedStatus !== null) {
    const denied = rejectedStatus === 403
    return {
      line: denied
        ? preferences.proxySelfTestTargetDenied(rejectedStatus, result.targetHost)
        : preferences.proxySelfTestTargetRejected(rejectedStatus, result.targetHost),
      tone: 'partial',
      hint: denied ? preferences.proxySelfTestDeniedHint : preferences.proxySelfTestAuthenticationHint,
      triage: 'target-site'
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
        hint: null,
        triage: 'config-not-effective'
      }
    }
    return {
      line:
        result.proxied === true
          ? preferences.proxySelfTestPassedViaProxy(status, seconds)
          : preferences.proxySelfTestReachable(status, seconds),
      tone: 'pass',
      hint: null,
      triage: 'pass'
    }
  }

  const sentence = proxyFailureSentence(result, labels)

  // 代理端点活着却自己报错：这是代理自身的问题。
  if (result.endpointReachable === true && (result.reasonCode === 'proxy_error' || result.reasonCode === 'invalid_response')) {
    return {
      line: preferences.proxySelfTestProxyAnsweredBadly(sentence),
      tone: 'fail',
      hint: null,
      triage: 'proxy-error'
    }
  }

  // 有状态码说明请求到了站（4xx/5xx 属「部分」）；没有状态码就绝不许说目标站有问题。
  if (result.status !== null) {
    return { line: `${sentence} · ${result.targetHost}`, tone: 'partial', hint: null, triage: 'target-site' }
  }

  // 一次响应都没拿到：说不清是代理出口还是目标站，按「无法归因」的句式说清排除了什么。
  return {
    line: preferences.proxySelfTestUnattributable(result.proxyEndpoint?.trim() || result.targetHost),
    tone: 'fail',
    hint: preferences.proxySelfTestCauseUnknownHint,
    triage: 'insufficient-evidence'
  }
}

function triageForUnreachableServer(result: ProxySelfTestResult): ProxySelfTestTriage {
  // null 表示未探/未发出：证据不足，不许当成失败。
  if (result.directProbeReachable === false) return 'local-network'
  if (result.directProbeReachable === true) return 'network-ok-proxy-suspect'
  return 'insufficient-evidence'
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
