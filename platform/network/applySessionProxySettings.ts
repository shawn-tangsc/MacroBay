import { session } from 'electron'

import type { NetworkSettings } from '../settings/schema/appSettings'

import { buildSessionProxyConfig, resolveCustomProxyRules, type ProxySettingsRejectionReason } from './proxyConfig'

export const SESSION_PROXY_APPLY_POLICY = {
  owner: 'platform/network/applySessionProxySettings',
  source: 'SessionProxyApplyPolicy',
  steps: ['setProxy', 'forceReloadProxyConfig', 'closeAllConnections'],
  failure: 'propagate-and-stop-desktop-startup',
  testBoundary: 'platform/network/applySessionProxySettings.test.ts'
} as const

export type ApplySessionProxyOptions = {
  /**
   * 历史遗留的非法代理地址（保存路径已经拒绝新的）会让这次应用退回直连；
   * 调用方必须把它记下来或告诉用户，别让「没走代理」看起来像「走了代理」。
   */
  onRejectedProxyConfig?: (reason: ProxySettingsRejectionReason) => void
}

export async function applySessionProxySettings(
  network: NetworkSettings,
  options: ApplySessionProxyOptions = {}
): Promise<void> {
  if (network.proxyMode === 'custom') {
    const resolution = resolveCustomProxyRules(network.proxyUrl)
    if (!resolution.ok) options.onRejectedProxyConfig?.(resolution.reason)
  }
  await session.defaultSession.setProxy(buildSessionProxyConfig(network))
  await session.defaultSession.forceReloadProxyConfig()
  await session.defaultSession.closeAllConnections()
}
