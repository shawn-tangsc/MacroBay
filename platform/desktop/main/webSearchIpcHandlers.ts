import type {
  UpdateWebSearchProviderInput,
  WebSearchCheckProviderRequest,
  WebSearchFetchUrlsRequest,
  WebSearchSearchKeywordsRequest,
  WebSearchSettings
} from '../../ai/web-search/contracts/webSearchContracts'
import { isWebSearchCapability, isWebSearchProviderId } from '../../ai/web-search/contracts/webSearchProviderSchemas'
import type { WebSearchService } from '../../ai/web-search/runtime/WebSearchService'

export function createWebSearchIpcHandlers(service: WebSearchService) {
  return {
    listProviders: () => service.listProviderViews(),
    getSettings: () => service.getSettings(),
    updateSettings: async (patch: unknown) =>
      service.updateSettings(assertObject(patch, 'settings patch') as Partial<WebSearchSettings>),
    updateProvider: async (input: unknown) => service.updateProvider(parseUpdateProviderInput(input)),
    revealProviderApiKey: async (providerId: unknown) => ({
      apiKey: await service.revealProviderApiKey(requiredProviderId(providerId))
    }),
    checkProvider: async (input: unknown) => service.checkProvider(parseCheckProviderInput(input)),
    searchKeywords: async (input: unknown) => service.searchKeywords(parseSearchKeywordsInput(input)),
    fetchUrls: async (input: unknown) => service.fetchUrls(parseFetchUrlsInput(input))
  }
}

export type WebSearchIpcHandlers = ReturnType<typeof createWebSearchIpcHandlers>

function parseSearchKeywordsInput(value: unknown): WebSearchSearchKeywordsRequest {
  const input = assertObject(value, 'search request')
  const keywords = assertStringArray(input.keywords, 'keywords')
  return {
    providerId: optionalProviderId(input.providerId),
    keywords
  }
}

function parseFetchUrlsInput(value: unknown): WebSearchFetchUrlsRequest {
  const input = assertObject(value, 'fetch request')
  const urls = assertStringArray(input.urls, 'urls')
  return {
    providerId: optionalProviderId(input.providerId),
    urls
  }
}

function parseCheckProviderInput(value: unknown): WebSearchCheckProviderRequest {
  const input = assertObject(value, 'provider check request')
  const providerId = requiredProviderId(input.providerId)
  const capability =
    input.capability === undefined ? undefined : isWebSearchCapability(input.capability) ? input.capability : fail('capability')
  return {
    providerId,
    capability,
    draft: input.draft === undefined ? undefined : parseProviderDraft(input.draft)
  }
}

function parseUpdateProviderInput(value: unknown): UpdateWebSearchProviderInput {
  const input = assertObject(value, 'provider update request')
  return {
    providerId: requiredProviderId(input.providerId),
    enabled: optionalBoolean(input.enabled, 'enabled'),
    apiKeys: input.apiKeys === undefined ? undefined : assertStringArray(input.apiKeys, 'apiKeys'),
    apiHostByCapability:
      input.apiHostByCapability === undefined
        ? undefined
        : parseCapabilityStringRecord(input.apiHostByCapability, 'apiHostByCapability'),
    engines: input.engines === undefined ? undefined : assertStringArray(input.engines, 'engines'),
    basicAuthUsername: optionalString(input.basicAuthUsername, 'basicAuthUsername'),
    basicAuthPassword: optionalString(input.basicAuthPassword, 'basicAuthPassword'),
    defaultForCapabilities:
      input.defaultForCapabilities === undefined
        ? undefined
        : assertCapabilityArray(input.defaultForCapabilities, 'defaultForCapabilities')
  }
}

function parseProviderDraft(value: unknown): NonNullable<WebSearchCheckProviderRequest['draft']> {
  const draft = assertObject(value, 'provider check draft')
  return {
    enabled: optionalBoolean(draft.enabled, 'enabled'),
    apiKeys: draft.apiKeys === undefined ? undefined : assertStringArray(draft.apiKeys, 'apiKeys'),
    apiHostByCapability:
      draft.apiHostByCapability === undefined
        ? undefined
        : parseCapabilityStringRecord(draft.apiHostByCapability, 'apiHostByCapability'),
    engines: draft.engines === undefined ? undefined : assertStringArray(draft.engines, 'engines'),
    basicAuthUsername: optionalString(draft.basicAuthUsername, 'basicAuthUsername'),
    basicAuthPassword: optionalString(draft.basicAuthPassword, 'basicAuthPassword')
  }
}

function assertObject(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Invalid Web Search ${label}.`)
  }
  return value as Record<string, unknown>
}

function assertStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new Error(`Invalid Web Search ${label}.`)
  }
  return value
}

function assertCapabilityArray(value: unknown, label: string) {
  if (!Array.isArray(value) || value.some((item) => !isWebSearchCapability(item))) {
    throw new Error(`Invalid Web Search ${label}.`)
  }
  return value
}

function parseCapabilityStringRecord(value: unknown, label: string) {
  const input = assertObject(value, label)
  const normalized: Record<string, string> = {}
  for (const [capability, item] of Object.entries(input)) {
    if (!isWebSearchCapability(capability) || typeof item !== 'string') {
      throw new Error(`Invalid Web Search ${label}.`)
    }
    normalized[capability] = item
  }
  return normalized
}

function requiredProviderId(value: unknown) {
  if (!isWebSearchProviderId(value)) fail('providerId')
  return value
}

function optionalProviderId(value: unknown) {
  if (value === undefined) return undefined
  return requiredProviderId(value)
}

function optionalBoolean(value: unknown, label: string): boolean | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'boolean') fail(label)
  return value
}

function optionalString(value: unknown, label: string): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string') fail(label)
  return value
}

function fail(label: string): never {
  throw new Error(`Invalid Web Search ${label}.`)
}
