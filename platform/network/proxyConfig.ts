import type { NetworkSettings } from '../settings/schema/appSettings'

import { checkBypassRules, normalizeBypassRules } from './proxyBypass'

export type SessionProxyConfig = {
  mode?: 'direct' | 'auto_detect' | 'pac_script' | 'fixed_servers' | 'system'
  pacScript?: string
  proxyRules?: string
  proxyBypassRules?: string
}

/**
 * 这份网络设置为什么不可保存；调用方据此给用户一句人话，别把内部原因拼进句子。
 * `bypass-rule-unsupported` 是绕过规则层面的拒绝（端口、CIDR 等超出 Chromium 那套语法）。
 */
export type ProxySettingsRejectionReason =
  | 'empty'
  | 'unsupported-protocol'
  | 'unparsable'
  | 'bypass-rule-unsupported'

/**
 * 自定义代理地址的解析结果。**不用字符串冒充失败**：旧实现解析不出来就回 `direct://`，
 * 界面上看不出任何异常，等于记录在骗人。
 */
export type CustomProxyResolution =
  | {
      ok: true
      rules: string
      protocol: 'http' | 'https' | 'socks5'
      /** 只写了 `host:port`、没写协议时为真：按 socks5 解释，但必须让用户看见这句话。 */
      protocolWasImplicit: boolean
    }
  | { ok: false; reason: ProxySettingsRejectionReason }

export type NetworkSettingsValidation =
  | { ok: true; interpretation: 'explicit' | 'socks5-implicit' }
  | { ok: false; reason: ProxySettingsRejectionReason }

export function buildSessionProxyConfig(network: NetworkSettings): SessionProxyConfig {
  switch (network.proxyMode) {
    case 'system':
      return { mode: 'system' }
    case 'none':
      return { mode: 'direct' }
    case 'custom': {
      const resolution = resolveCustomProxyRules(network.proxyUrl)
      // 保存路径已经拒绝非法地址，这里只剩历史遗留值；直连不是「没设代理」，由调用方记录一次。
      if (!resolution.ok) return { mode: 'direct' }
      return {
        mode: 'fixed_servers',
        proxyRules: resolution.rules,
        proxyBypassRules: normalizeProxyBypassRules(network.proxyBypassRules)
      }
    }
  }
}

/**
 * 解析自定义代理地址。支持 `http://`、`https://`、`socks5://`、`socks5h://` 与裸 `host:port`；
 * 其余一律返回原因，由保存路径拒绝落盘。
 */
export function resolveCustomProxyRules(proxyUrl: string): CustomProxyResolution {
  const trimmed = proxyUrl.trim()
  if (!trimmed) return { ok: false, reason: 'empty' }

  try {
    const url = new URL(trimmed)
    const host = url.hostname
    const port = url.port || defaultPortForProtocol(url.protocol)
    if (!host) return { ok: false, reason: 'unparsable' }
    if (url.protocol === 'socks5:' || url.protocol === 'socks5h:') {
      return { ok: true, rules: `socks5=${host}:${port}`, protocol: 'socks5', protocolWasImplicit: false }
    }
    if (url.protocol === 'http:') {
      return {
        ok: true,
        rules: `http=${host}:${port};https=${host}:${port}`,
        protocol: 'http',
        protocolWasImplicit: false
      }
    }
    if (url.protocol === 'https:') {
      return { ok: true, rules: `https=${host}:${port}`, protocol: 'https', protocolWasImplicit: false }
    }
    return { ok: false, reason: 'unsupported-protocol' }
  } catch {
    // 只接受形状明确的裸 `host:port`；其余解析不出就是真的解析不出，不再猜。
    if (/^[\w.-]+:\d+$/.test(trimmed)) {
      return { ok: true, rules: `socks5=${trimmed}`, protocol: 'socks5', protocolWasImplicit: true }
    }
    return { ok: false, reason: 'unparsable' }
  }
}

/**
 * 保存前的校验：只有 `custom` 模式需要地址，其余模式不看地址字段。
 * 返回 `socks5-implicit` 时界面必须显示「未写协议，按 socks5 解释」。
 */
export function validateNetworkSettings(network: NetworkSettings): NetworkSettingsValidation {
  if (network.proxyMode !== 'custom') return { ok: true, interpretation: 'explicit' }
  const resolution = resolveCustomProxyRules(network.proxyUrl)
  if (!resolution.ok) return { ok: false, reason: resolution.reason }
  // 绕过规则必须落在 Chromium 与 WebSocket 都能正确解释的语法内，否则保存即拒。
  if (!checkBypassRules(network.proxyBypassRules).ok) return { ok: false, reason: 'bypass-rule-unsupported' }
  return { ok: true, interpretation: resolution.protocolWasImplicit ? 'socks5-implicit' : 'explicit' }
}

/** Chromium 的绕过规则列表；归一化逻辑只有 `proxyBypass` 一份。 */
export function normalizeProxyBypassRules(value: string): string {
  return normalizeBypassRules(value)
}

function defaultPortForProtocol(protocol: string): string {
  switch (protocol) {
    case 'http:':
      return '80'
    case 'https:':
      return '443'
    case 'socks5:':
    case 'socks5h:':
      return '1080'
    default:
      return '1080'
  }
}
