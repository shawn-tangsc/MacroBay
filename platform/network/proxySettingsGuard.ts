import { supportedProxyModes, type AppSettingsPatch, type NetworkSettings } from '../settings/schema/appSettings'

import { validateNetworkSettings, type ProxySettingsRejectionReason } from './proxyConfig'

/**
 * 保存前拒绝非法代理设置。错误信息里带稳定前缀 + 原因码，渲染层按码出人话；
 * 这里抛错即表示**这次不落盘**，调用方必须在 `settingsStore.update` 之前调用。
 */
export const PROXY_SETTINGS_REJECTED_PREFIX = 'proxy_settings_rejected'

export function assertProxySettingsPatchAccepted(
  patch: AppSettingsPatch,
  current: NetworkSettings
): void {
  // 只有 patch 真的带了 network 才校验：改语言/主题不能被一条历史网络数据挡住。
  if (!hasNetworkField(patch)) return
  const validation = validateNetworkSettings(mergeNetworkSettingsPatch(patch, current))
  if (!validation.ok) {
    throw new Error(`${PROXY_SETTINGS_REJECTED_PREFIX}:${validation.reason}`)
  }
}

/** 补丁里只有已知形状的字段才参与校验，其余保持当前值。 */
function hasNetworkField(patch: AppSettingsPatch): boolean {
  return Object.prototype.hasOwnProperty.call(patch, 'network') && patch.network !== undefined
}

export function mergeNetworkSettingsPatch(
  patch: AppSettingsPatch,
  current: NetworkSettings
): NetworkSettings {
  const raw = patch.network
  if (!raw || typeof raw !== 'object') return current
  const value = raw as Partial<Record<keyof NetworkSettings, unknown>>
  const proxyMode = value.proxyMode
  return {
    proxyMode: supportedProxyModes.includes(proxyMode as NetworkSettings['proxyMode'])
      ? (proxyMode as NetworkSettings['proxyMode'])
      : current.proxyMode,
    proxyUrl: typeof value.proxyUrl === 'string' ? value.proxyUrl : current.proxyUrl,
    proxyBypassRules:
      typeof value.proxyBypassRules === 'string' ? value.proxyBypassRules : current.proxyBypassRules
  }
}

export function readProxyRejectionReason(error: unknown): ProxySettingsRejectionReason | null {
  const message = error instanceof Error ? error.message : ''
  const match = new RegExp(`${PROXY_SETTINGS_REJECTED_PREFIX}:([a-z-]+)`).exec(message)
  const reason = match?.[1]
  if (
    reason === 'empty' ||
    reason === 'unsupported-protocol' ||
    reason === 'unparsable' ||
    reason === 'bypass-rule-unsupported'
  ) {
    return reason
  }
  return null
}
