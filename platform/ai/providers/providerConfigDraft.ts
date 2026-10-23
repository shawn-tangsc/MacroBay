import type { ModelProviderInput, SafeModelProvider } from './modelProviderTypes'
import { ProviderConnectionTestPolicy } from './providerConnection'

export type ProviderConfigDraft = {
  enabled: boolean
  apiKey: string
}

export function buildProviderInputFromDraft(provider: SafeModelProvider, draft: ProviderConfigDraft): ModelProviderInput {
  const apiKey = draft.apiKey.trim()
  const shouldPreserveSavedApiKey = !apiKey || apiKey === provider.apiKeyPreview
  return {
    id: provider.id,
    name: provider.name,
    enabled: draft.enabled,
    endpoints: provider.endpoints,
    ...(provider.imageEndpoints ? { imageEndpoints: provider.imageEndpoints } : {}),
    apiKey: shouldPreserveSavedApiKey ? undefined : apiKey,
    models: provider.models,
    defaultChatModelId: provider.defaultChatModelId
  }
}

export function isProviderDraftConnectionReady(provider: SafeModelProvider, draft: ProviderConfigDraft): boolean {
  return Boolean(draft.enabled && provider.baseUrl.trim() && (draft.apiKey.trim() || provider.hasApiKey))
}

export function isProviderDraftConnectionTestable(provider: SafeModelProvider, draft: ProviderConfigDraft): boolean {
  return ProviderConnectionTestPolicy.isTestable({
    baseUrl: provider.baseUrl,
    hasApiKey: Boolean(draft.apiKey.trim() || provider.hasApiKey)
  })
}
