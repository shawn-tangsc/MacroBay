import { maskSecret } from '@platform/ai/providers/providerStore'
import type { SafeModelProvider } from '@platform/ai/providers/modelProviderTypes'

export type ConnectionCheckApiKeyOption = {
  id: string
  label: string
  apiKey?: string
}

export function splitApiKeyDraft(value: string): string[] {
  const seen = new Set<string>()
  return value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => {
      if (!item || seen.has(item)) return false
      seen.add(item)
      return true
    })
}

export function createConnectionCheckApiKeyOptions(
  provider: SafeModelProvider,
  apiKeyDraft: string
): ConnectionCheckApiKeyOption[] {
  const draftKeys = splitApiKeyDraft(apiKeyDraft)
  if (draftKeys.length > 0) {
    return draftKeys.map((apiKey, index) => ({
      id: `draft-${index}`,
      label: maskApiKeyForDisplay(apiKey),
      apiKey
    }))
  }

  if (!provider.hasApiKey) return []
  return [
    {
      id: 'saved',
      label: provider.apiKeyPreview || '********'
    }
  ]
}

export function selectDefaultConnectionCheckModelId(provider: SafeModelProvider): string {
  const defaultModel = provider.models.find((model) => model.id === provider.defaultChatModelId && model.capabilities.chat)
  return defaultModel?.id ?? provider.models.find((model) => model.capabilities.chat)?.id ?? ''
}

// 掩码只有一份实现（platform/ai/providers 的 maskSecret）；这里不再重复。
const maskApiKeyForDisplay = maskSecret
