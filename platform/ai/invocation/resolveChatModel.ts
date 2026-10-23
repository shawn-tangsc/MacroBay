import type { ProviderState, ProviderStateAccessor } from '../providers/modelProviderTypes'
import { isProviderConnectionReady } from '../providers/providerStore'

export type ResolvedChatModel = {
  providerId: string
  modelId: string
  providerName: string
  modelName: string
  baseUrl: string
  apiKey: string
}

export type ResolveChatModelResult =
  | { ok: true; model: ResolvedChatModel }
  | { ok: false; errorCode: 'model-not-ready' | 'provider-disabled' | 'missing-api-key' }

export type ResolvedChatModelMetadata = Omit<ResolvedChatModel, 'apiKey'>

export type ResolveChatModelMetadataResult =
  | { ok: true; model: ResolvedChatModelMetadata }
  | { ok: false; errorCode: 'model-not-ready' | 'provider-disabled' | 'missing-api-key' }

export function resolveChatModel(
  providerState: ProviderState,
  providerId?: string,
  modelId?: string
): ResolveChatModelResult {
  if (providerId) {
    const provider = providerState.providers.find((entry) => entry.id === providerId)
    if (!provider) {
      return { ok: false, errorCode: 'model-not-ready' }
    }
    return resolveProviderChatModel(provider, modelId)
  }

  const readyProvider = providerState.providers.find(
    (entry) => entry.enabled && isProviderConnectionReady(entry)
  )
  if (readyProvider) {
    return resolveProviderChatModel(readyProvider, modelId)
  }

  const enabledProvider = providerState.providers.find((entry) => entry.enabled)
  if (enabledProvider) {
    return resolveProviderChatModel(enabledProvider, modelId)
  }

  return { ok: false, errorCode: 'model-not-ready' }
}

export function resolveChatModelMetadata(
  providerState: ProviderState,
  providerId?: string,
  modelId?: string
): ResolveChatModelMetadataResult {
  const provider = providerId
    ? providerState.providers.find((entry) => entry.id === providerId)
    : providerState.providers.find((entry) => entry.enabled && isProviderConnectionReady(entry))
      ?? providerState.providers.find((entry) => entry.enabled)
  if (!provider) return { ok: false, errorCode: 'model-not-ready' }
  if (!provider.enabled) return { ok: false, errorCode: 'provider-disabled' }
  if (!provider.apiKey?.trim() && !provider.apiKeyRef) return { ok: false, errorCode: 'missing-api-key' }
  if (!provider.baseUrl.trim()) return { ok: false, errorCode: 'model-not-ready' }

  const model = modelId
    ? provider.models.find((entry) => entry.id === modelId && entry.capabilities.chat)
    : (provider.defaultChatModelId
      ? provider.models.find((entry) => entry.id === provider.defaultChatModelId && entry.capabilities.chat)
      : undefined) ??
      provider.models.find((entry) => entry.capabilities.chat)
  if (!model) return { ok: false, errorCode: 'model-not-ready' }

  return {
    ok: true,
    model: {
      providerId: provider.id,
      modelId: model.id,
      providerName: provider.name,
      modelName: model.name,
      baseUrl: provider.baseUrl
    }
  }
}

export async function resolveChatModelForRuntime(
  getProviderState: ProviderStateAccessor,
  providerId?: string,
  modelId?: string
): Promise<ResolveChatModelResult> {
  const providerState = await getProviderState()
  const metadata = resolveChatModelMetadata(providerState, providerId, modelId)
  if (!metadata.ok) return metadata
  const runtimeProvider = await getProviderState.resolveRuntimeProvider?.(metadata.model.providerId)
  if (getProviderState.resolveRuntimeProvider && !runtimeProvider?.apiKey?.trim()) {
    return { ok: false, errorCode: 'missing-api-key' }
  }
  if (!runtimeProvider) return resolveChatModel(providerState, metadata.model.providerId, modelId)
  return resolveChatModel({
    providers: providerState.providers.map((provider) => provider.id === runtimeProvider.id ? runtimeProvider : provider)
  }, metadata.model.providerId, modelId)
}

function resolveProviderChatModel(
  provider: ProviderState['providers'][number],
  modelId?: string
): ResolveChatModelResult {
  if (!provider.enabled) {
    return { ok: false, errorCode: 'provider-disabled' }
  }

  const apiKey = provider.apiKey?.trim() ?? ''
  if (!apiKey) {
    return { ok: false, errorCode: 'missing-api-key' }
  }

  if (!provider.baseUrl.trim()) {
    return { ok: false, errorCode: 'model-not-ready' }
  }

  const model = modelId
    ? provider.models.find((entry) => entry.id === modelId && entry.capabilities.chat)
    : (provider.defaultChatModelId
      ? provider.models.find((entry) => entry.id === provider.defaultChatModelId && entry.capabilities.chat)
      : undefined) ??
      provider.models.find((entry) => entry.capabilities.chat)

  if (!model) {
    return { ok: false, errorCode: 'model-not-ready' }
  }

  return {
    ok: true,
    model: {
      providerId: provider.id,
      modelId: model.id,
      providerName: provider.name,
      modelName: model.name,
      baseUrl: provider.baseUrl,
      apiKey
    }
  }
}

export function resolveSafeModelLabelsFromState(
  providerState: ProviderState,
  providerId?: string,
  modelId?: string
): { providerLabel?: string; modelLabel?: string } {
  const resolved = resolveChatModelMetadata(providerState, providerId, modelId)
  if (!resolved.ok) return {}
  return {
    providerLabel: resolved.model.providerName,
    modelLabel: resolved.model.modelName
  }
}
