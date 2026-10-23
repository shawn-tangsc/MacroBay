import type { NetworkSettings } from '../settings/schema/appSettings'

export type SessionProxyConfig = {
  mode?: 'direct' | 'auto_detect' | 'pac_script' | 'fixed_servers' | 'system'
  pacScript?: string
  proxyRules?: string
  proxyBypassRules?: string
}

export function buildSessionProxyConfig(network: NetworkSettings): SessionProxyConfig {
  switch (network.proxyMode) {
    case 'system':
      return { mode: 'system' }
    case 'none':
      return { mode: 'direct' }
    case 'custom':
      return {
        mode: 'fixed_servers',
        proxyRules: buildCustomProxyRules(network.proxyUrl),
        proxyBypassRules: normalizeProxyBypassRules(network.proxyBypassRules)
      }
  }
}

export function buildCustomProxyRules(proxyUrl: string): string {
  const trimmed = proxyUrl.trim()
  if (!trimmed) return 'direct://'

  try {
    const url = new URL(trimmed)
    const host = url.hostname
    const port = url.port || defaultPortForProtocol(url.protocol)
    if (url.protocol === 'socks5:' || url.protocol === 'socks5h:') {
      return `socks5=${host}:${port}`
    }
    if (url.protocol === 'http:') {
      return `http=${host}:${port};https=${host}:${port}`
    }
    if (url.protocol === 'https:') {
      return `https=${host}:${port}`
    }
  } catch {
    if (/^[\w.-]+:\d+$/.test(trimmed)) {
      return `socks5=${trimmed}`
    }
  }

  return 'direct://'
}

export function normalizeProxyBypassRules(value: string): string {
  return value
    .split(/[,\s]+/)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .join(',')
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
