import { session } from 'electron'

import type { NetworkSettings } from '../settings/schema/appSettings'

import { buildSessionProxyConfig } from './proxyConfig'

export const SESSION_PROXY_APPLY_POLICY = {
  owner: 'platform/network/applySessionProxySettings',
  source: 'SessionProxyApplyPolicy',
  steps: ['setProxy', 'forceReloadProxyConfig', 'closeAllConnections'],
  failure: 'propagate-and-stop-desktop-startup',
  testBoundary: 'platform/network/applySessionProxySettings.test.ts'
} as const

export async function applySessionProxySettings(network: NetworkSettings): Promise<void> {
  await session.defaultSession.setProxy(buildSessionProxyConfig(network))
  await session.defaultSession.forceReloadProxyConfig()
  await session.defaultSession.closeAllConnections()
}
