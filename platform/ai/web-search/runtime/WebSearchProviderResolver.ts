import type {
  WebSearchCapability,
  WebSearchErrorCode,
  WebSearchProviderId,
  WebSearchSettings
} from '../contracts/webSearchContracts'
import { isWebSearchProviderId } from '../contracts/webSearchProviderSchemas'
import { webSearchProviderPresets } from '../providers/webSearchProviderPresets'
import type { ResolvedWebSearchProvider, WebSearchProviderSecrets } from '../providers/WebSearchProviderDriver'

export type WebSearchProviderResolverInput = {
  providerId?: WebSearchProviderId
  capability: WebSearchCapability
  settings: WebSearchSettings
  secrets: WebSearchProviderSecrets
}

export type WebSearchProviderResolverResult =
  | { ok: true; provider: ResolvedWebSearchProvider }
  | { ok: false; errorCode: WebSearchErrorCode; message: string }

export type WebSearchProviderResolver = {
  resolve: (input: WebSearchProviderResolverInput) => WebSearchProviderResolverResult
}

const providersRequiringApiKey = new Set<WebSearchProviderId>(['tavily', 'jina'])

export function createWebSearchProviderResolver(): WebSearchProviderResolver {
  return {
    resolve(input) {
      const providerId =
        input.providerId ??
        (input.capability === 'searchKeywords'
          ? input.settings.defaultSearchProviderId
          : input.settings.defaultFetchProviderId)
      if (!isWebSearchProviderId(providerId)) {
        return error('provider_not_configured', 'Web Search provider is not configured.')
      }

      const preset = webSearchProviderPresets.find((provider) => provider.id === providerId)
      if (!preset) {
        return error('provider_not_configured', 'Web Search provider is not configured.')
      }

      const capabilityPreset = preset.capabilities.find((capability) => capability.feature === input.capability)
      if (!capabilityPreset) {
        return error('provider_unsupported_capability', 'Web Search provider does not support this capability.')
      }

      const override = input.settings.providerOverrides[providerId]
      if (override?.enabled !== true) {
        return error('provider_disabled', 'Web Search provider is disabled.')
      }

      if (providersRequiringApiKey.has(providerId) && !input.secrets.apiKeys?.some((key) => key.trim())) {
        return error('missing_api_key', 'Web Search provider is missing an API key.')
      }

      const apiHost = override?.capabilities?.[input.capability]?.apiHost ?? capabilityPreset.apiHost ?? ''
      return {
        ok: true,
        provider: {
          providerId,
          capability: input.capability,
          apiHost,
          secrets: input.secrets,
          engines: override?.engines,
          basicAuthUsername: override?.basicAuthUsername
        }
      }
    }
  }
}

function error(errorCode: WebSearchErrorCode, message: string): WebSearchProviderResolverResult {
  return { ok: false, errorCode, message }
}
