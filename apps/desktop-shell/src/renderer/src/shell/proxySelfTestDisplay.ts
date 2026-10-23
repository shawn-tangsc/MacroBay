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
  proxyLabel: string,
  labels: PlatformText['preferences']
): string {
  if (result.ok) {
    return labels.proxySelfTestPassed(result.status ?? 0, (result.durationMs / 1000).toFixed(1), proxyLabel)
  }
  return labels.proxySelfTestFailed(result.reasonCode ?? 'unknown', result.targetHost)
}
