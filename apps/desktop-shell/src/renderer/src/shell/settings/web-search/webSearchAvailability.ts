import type {
  SafeWebSearchProviderView,
  WebSearchCapability,
  WebSearchProviderId,
  WebSearchSettings
} from '@platform/ai/web-search/contracts/webSearchContracts'
import { createWebSearchProviderResolver } from '@platform/ai/web-search/runtime/WebSearchProviderResolver'
import type { PlatformText } from '../../../i18n/platformText'

/**
 * 生效摘要的可用性判定。
 *
 * 直接调用真实的 `WebSearchProviderResolver`（enabled + 需要 Key 的供应商必须有 Key），
 * 渲染层只补上它已知的 `hasApiKey` 事实，不另写一套供应商规则、不新增 IPC。
 */
export type WebSearchAvailability =
  | { available: true }
  | { available: false; providerId: WebSearchProviderId; message: string }

const resolver = createWebSearchProviderResolver()

export function resolveWebSearchAvailability(
  labels: PlatformText['webSearch'],
  settings: WebSearchSettings,
  providers: SafeWebSearchProviderView[],
  capability: WebSearchCapability
): WebSearchAvailability {
  const providerId =
    capability === 'searchKeywords' ? settings.defaultSearchProviderId : settings.defaultFetchProviderId
  const provider = providers.find((item) => item.id === providerId)
  const result = resolver.resolve({
    providerId,
    capability,
    settings,
    // 只告诉 resolver「有没有 Key」这个渲染层已知的事实，不接触真实密钥。
    secrets: { apiKeys: provider?.hasApiKey ? ['configured'] : undefined }
  })
  if (result.ok) return { available: true }

  const messages =
    capability === 'searchKeywords'
      ? { disabled: labels.searchUnavailableDisabled, missingKey: labels.searchUnavailableMissingKey }
      : { disabled: labels.fetchUnavailableDisabled, missingKey: labels.fetchUnavailableMissingKey }

  if (result.errorCode === 'provider_disabled') {
    return { available: false, providerId, message: messages.disabled }
  }
  if (result.errorCode === 'missing_api_key') {
    return { available: false, providerId, message: messages.missingKey }
  }
  // 能力不支持等其它情况不是「状态警告」，保持正常摘要，避免误导。
  return { available: true }
}

export type WebSearchProviderOptionReason = 'deferred' | 'disabled' | 'missingKey' | 'unsupported'

export type WebSearchProviderOptionState =
  | { selectable: true; reason: null }
  | { selectable: false; reason: WebSearchProviderOptionReason }

/**
 * PLAT-60：策略页「默认供应商」下拉的可选性。
 *
 * 复用同一个 resolver（enabled + 需要 Key 的供应商必须有 Key），不另写一套规则；
 * 未接入 / 未启用 / 缺 Key 的供应商置灰并给出原因，避免选出跑不起来的默认值。
 */
export function resolveWebSearchProviderOption(
  settings: WebSearchSettings,
  provider: SafeWebSearchProviderView,
  capability: WebSearchCapability
): WebSearchProviderOptionState {
  if (!provider.implemented) return { selectable: false, reason: 'deferred' }
  if (!provider.capabilities.some((item) => item.feature === capability)) {
    return { selectable: false, reason: 'unsupported' }
  }
  const result = resolver.resolve({
    providerId: provider.id,
    capability,
    settings,
    secrets: { apiKeys: provider.hasApiKey ? ['configured'] : undefined }
  })
  if (result.ok) return { selectable: true, reason: null }
  if (result.errorCode === 'provider_disabled') return { selectable: false, reason: 'disabled' }
  if (result.errorCode === 'missing_api_key') return { selectable: false, reason: 'missingKey' }
  return { selectable: false, reason: 'unsupported' }
}
