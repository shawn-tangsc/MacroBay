import { useState } from 'react'

import type { SafeModelProvider } from '@platform/ai/providers/modelProviderTypes'
import type { AppSettings } from '@platform/settings/schema/appSettings'

import type { PlatformText } from '../i18n/platformText'
import { sanitizeProxyAddressForDisplay } from './proxyAddressDisplay'
import { describeProxySelfTest, PROXY_SELF_TEST_PROBE_URL, type ProxySelfTestResult } from './proxySelfTestDisplay'
import { resolveProviderHost } from './model-service/ModelServiceBrandBlock'

/**
 * 代理自检（从 `AppShell.tsx` 原样搬出）：通过既有 testConnection 通道的 additive 参数
 * `proxyProbeUrl`，主进程用 Electron `net.fetch`（当前 session 代理）发**无鉴权 GET**；只显示归类与耗时。
 */
export type ProxySelfTestParams = {
  settings: AppSettings
  t: PlatformText
}

export function useProxySelfTest(params: ProxySelfTestParams) {
  const { settings, t } = params
  const [proxySelfTest, setProxySelfTest] = useState<{ running: boolean; result: ProxySelfTestResult | null }>({
    running: false,
    result: null
  })

  const proxySelfTestView =
    proxySelfTest.result === null
      ? null
      : describeProxySelfTest(proxySelfTest.result, t, {
          expectsProxy: settings.network.proxyMode === 'custom',
          fallbackProxyLabel: resolveProxyDisplayLabel()
        })

  function resolveProxyDisplayLabel(): string {
    if (settings.network.proxyMode === 'custom') {
      return sanitizeProxyAddressForDisplay(settings.network.proxyUrl) ?? t.preferences.proxyCustom
    }
    return settings.network.proxyMode === 'system' ? t.preferences.proxySystem : t.preferences.proxyNone
  }

  /**
   * PLAT-61 代理自检：通过既有 testConnection 通道的 additive 参数 `proxyProbeUrl`，
   * 主进程用 Electron `net.fetch`（当前 session 代理）发**无鉴权 GET**；只显示归类与耗时。
   */
  async function runProxySelfTest(): Promise<void> {
    // 目标固定为 Google 的 204 端点：自检只回答「代理通不通」，与选哪个供应商无关。
    const target = PROXY_SELF_TEST_PROBE_URL
    setProxySelfTest({ running: true, result: null })
    try {
      const result = (await window.platform.modelProviders.testConnection('', {
        proxyProbeUrl: target
      })) as ProxySelfTestResult
      setProxySelfTest({
        running: false,
        result: {
          ok: result?.ok === true,
          status: typeof result?.status === 'number' ? result.status : null,
          durationMs: typeof result?.durationMs === 'number' ? result.durationMs : 0,
          reasonCode: typeof result?.reasonCode === 'string' ? result.reasonCode : null,
          targetHost: typeof result?.targetHost === 'string' ? result.targetHost : resolveProviderHost(target),
          resolvedProxy: typeof result?.resolvedProxy === 'string' ? result.resolvedProxy : undefined,
          proxied: typeof result?.proxied === 'boolean' ? result.proxied : undefined,
          endpointReachable: typeof result?.endpointReachable === 'boolean' ? result.endpointReachable : null,
          proxyEndpoint: typeof result?.proxyEndpoint === 'string' ? result.proxyEndpoint : null,
          proxyEndpointLoopback: typeof result?.proxyEndpointLoopback === 'boolean' ? result.proxyEndpointLoopback : null,
          directProbeReachable: typeof result?.directProbeReachable === 'boolean' ? result.directProbeReachable : null,
          directProbeEndpoint: typeof result?.directProbeEndpoint === 'string' ? result.directProbeEndpoint : null
        }
      })
    } catch {
      setProxySelfTest({
        running: false,
        result: { ok: false, status: null, durationMs: 0, reasonCode: 'unknown', targetHost: resolveProviderHost(target) }
      })
    }
  }

  /** PLAT-61：网关未启用时可在抽屉里就地开启（复用既有 agents.setModelGatewayEnabled），成功后重跑一次。 */

  return { proxySelfTest, proxySelfTestView, runProxySelfTest }
}
