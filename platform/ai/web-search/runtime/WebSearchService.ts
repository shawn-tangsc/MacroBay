import type {
  SafeWebSearchProviderView,
  UpdateWebSearchProviderInput,
  WebSearchCapability,
  WebSearchCheckProviderRequest,
  WebSearchCheckProviderResponse,
  WebSearchFetchUrlsRequest,
  WebSearchProviderId,
  WebSearchResponse,
  WebSearchResult,
  WebSearchRunOptions,
  WebSearchSearchKeywordsRequest,
  WebSearchSettings
} from '../contracts/webSearchContracts'
import { createDefaultWebSearchSettings, normalizeWebSearchSettings } from '../contracts/webSearchSettings'
import { isWebSearchCapability, isWebSearchProviderId, normalizeWebSearchApiHost } from '../contracts/webSearchProviderSchemas'
import { createWebSearchProviderRegistry } from '../providers/WebSearchProviderRegistry'
import { filterWebSearchBlacklist } from './webSearchBlacklist'
import {
  createWebSearchCredentialStore,
  type WebSearchCredentialStore
} from './WebSearchCredentialStore'
import { createWebSearchError, getWebSearchErrorCode, getWebSearchErrorStatus } from './webSearchErrors'
import { normalizeWebSearchKeywords, normalizeWebSearchUrls } from './webSearchInputNormalization'
import { createWebSearchProviderResolver } from './WebSearchProviderResolver'
import { applyWebSearchPostProcessing } from './webSearchPostProcessing'
import { validateWebFetchUrl } from './webSearchUrlSafety'

export type WebSearchServiceDependencies = {
  getSettings?: () => Promise<WebSearchSettings>
  updateSettings?: (settings: WebSearchSettings) => Promise<void>
  credentialStore?: WebSearchCredentialStore
  fetch?: typeof fetch
}

export type WebSearchService = {
  listProviderViews: () => Promise<SafeWebSearchProviderView[]>
  getSettings: () => Promise<WebSearchSettings>
  updateSettings: (patch: Partial<WebSearchSettings>) => Promise<WebSearchSettings>
  updateProvider: (input: UpdateWebSearchProviderInput) => Promise<SafeWebSearchProviderView>
  revealProviderApiKey: (providerId: WebSearchProviderId) => Promise<string | null>
  checkProvider: (input: WebSearchCheckProviderRequest, signal?: AbortSignal) => Promise<WebSearchCheckProviderResponse>
  searchKeywords: (input: WebSearchSearchKeywordsRequest, options?: WebSearchRunOptions) => Promise<WebSearchResponse>
  fetchUrls: (input: WebSearchFetchUrlsRequest, options?: WebSearchRunOptions) => Promise<WebSearchResponse>
}

export function createWebSearchService(dependencies: WebSearchServiceDependencies = {}): WebSearchService {
  const registry = createWebSearchProviderRegistry()
  const resolver = createWebSearchProviderResolver()
  const credentialStore = dependencies.credentialStore ?? createWebSearchCredentialStore()
  let settingsState = createDefaultWebSearchSettings()

  async function getSettings(): Promise<WebSearchSettings> {
    const next = dependencies.getSettings ? await dependencies.getSettings() : settingsState
    settingsState = normalizeWebSearchSettings(next)
    return settingsState
  }

  async function listProviderViews(): Promise<SafeWebSearchProviderView[]> {
    const settings = await getSettings()
    const views = await Promise.all(
      registry.listPresets().map(async (preset) => {
        const safeSecrets = await credentialStore.toSafeView(preset.id)
        const override = settings.providerOverrides[preset.id]
        return {
          id: preset.id,
          name: preset.name,
          type: preset.type,
          capabilities: preset.capabilities,
          enabled: override?.enabled ?? false,
          apiHostByCapability: Object.fromEntries(
            preset.capabilities.map((capability) => [
              capability.feature,
              override?.capabilities?.[capability.feature]?.apiHost ?? capability.apiHost ?? ''
            ])
          ),
          hasApiKey: safeSecrets.hasApiKey,
          apiKeyPreview: safeSecrets.apiKeyPreview,
          apiKeyLength: safeSecrets.apiKeyLength,
          hasBasicAuth: safeSecrets.hasBasicAuth,
          defaultForCapabilities: [
            ...(settings.defaultSearchProviderId === preset.id ? (['searchKeywords'] as const) : []),
            ...(settings.defaultFetchProviderId === preset.id ? (['fetchUrls'] as const) : [])
          ],
          phase: preset.phase,
          implemented: preset.phase === 0
        }
      })
    )
    return views
  }

  async function updateSettings(patch: Partial<WebSearchSettings>): Promise<WebSearchSettings> {
    const next = normalizeWebSearchSettings({ ...(await getSettings()), ...patch })
    settingsState = next
    await dependencies.updateSettings?.(next)
    return next
  }

  async function revealProviderApiKey(providerId: WebSearchProviderId): Promise<string | null> {
    return credentialStore.getProviderApiKey(providerId)
  }

  async function updateProvider(input: UpdateWebSearchProviderInput): Promise<SafeWebSearchProviderView> {
    if (!isWebSearchProviderId(input.providerId)) {
      throw createWebSearchError('provider_not_configured', 'Web Search provider is not configured.')
    }

    const preset = registry.getPreset(input.providerId)
    if (!preset) {
      throw createWebSearchError('provider_not_configured', 'Web Search provider is not configured.')
    }

    const currentSettings = await getSettings()
    const existingOverride = currentSettings.providerOverrides[input.providerId] ?? {}
    const nextOverride = {
      ...existingOverride,
      ...(typeof input.enabled === 'boolean' ? { enabled: input.enabled } : {})
    }

    const capabilities = normalizeProviderCapabilityHosts(input.apiHostByCapability)
    if (Object.keys(capabilities).length > 0) {
      nextOverride.capabilities = {
        ...(existingOverride.capabilities ?? {}),
        ...capabilities
      }
    }

    if (Array.isArray(input.engines)) {
      const engines = normalizeStringList(input.engines)
      if (engines.length > 0) nextOverride.engines = engines
      else delete nextOverride.engines
    }

    if (typeof input.basicAuthUsername === 'string') {
      const username = input.basicAuthUsername.trim()
      if (username) nextOverride.basicAuthUsername = username
      else delete nextOverride.basicAuthUsername
    }

    const defaultPatch = normalizeDefaultProviderPatch(input, currentSettings)
    const nextSettings = await updateSettings({
      ...defaultPatch,
      providerOverrides: {
        ...currentSettings.providerOverrides,
        [input.providerId]: nextOverride
      }
    })

    if (input.apiKeys !== undefined || input.basicAuthPassword !== undefined) {
      await credentialStore.updateProviderSecrets(input.providerId, {
        apiKeys: input.apiKeys,
        basicAuthPassword: input.basicAuthPassword,
        preserveExisting: true
      })
    }

    const safeSecrets = await credentialStore.toSafeView(input.providerId)
    return createProviderView(preset, nextSettings, safeSecrets)
  }

  async function checkProvider(input: WebSearchCheckProviderRequest, signal?: AbortSignal): Promise<WebSearchCheckProviderResponse> {
    if (signal?.aborted) {
      throw createWebSearchError('abort', 'Web Search request was aborted.')
    }
    if (!dependencies.fetch) {
      return {
        valid: false,
        errorCode: 'provider_not_configured',
        message: 'Web Search requires a platform fetch adapter.'
      }
    }

    const settings = await getSettings()
    const currentSecrets = await credentialStore.getProviderSecrets(input.providerId)
    const draftSettings = normalizeWebSearchSettings({
      ...settings,
      providerOverrides: {
        ...settings.providerOverrides,
        [input.providerId]: {
          ...(settings.providerOverrides[input.providerId] ?? {}),
          ...(typeof input.draft?.enabled === 'boolean' ? { enabled: input.draft.enabled } : {}),
          ...(input.draft?.apiHostByCapability
            ? { capabilities: normalizeProviderCapabilityHosts(input.draft.apiHostByCapability) }
            : {}),
          ...(input.draft?.engines ? { engines: normalizeStringList(input.draft.engines) } : {}),
          ...(typeof input.draft?.basicAuthUsername === 'string' && input.draft.basicAuthUsername.trim()
            ? { basicAuthUsername: input.draft.basicAuthUsername.trim() }
            : {})
        }
      }
    })
    const capability = input.capability ?? 'searchKeywords'
    const resolution = resolver.resolve({
      providerId: input.providerId,
      capability,
      settings: draftSettings,
      secrets: {
        apiKeys: input.draft?.apiKeys ?? currentSecrets.apiKeys,
        basicAuthPassword: input.draft?.basicAuthPassword ?? currentSecrets.basicAuthPassword
      }
    })
    if (!resolution.ok) {
      return { valid: false, errorCode: resolution.errorCode, message: resolution.message }
    }

    try {
      const driver = registry.createDriver(resolution.provider)
      const runner = capability === 'searchKeywords' ? driver.searchKeywords : driver.fetchUrls
      if (!runner) {
        return {
          valid: false,
          errorCode: 'provider_unsupported_capability',
          message: 'Web Search provider does not support this capability.'
        }
      }
      await runner(getProviderCheckProbeInput(capability), {
        ...resolution.provider,
        maxResults: 1,
        searchWithDate: false,
        fetch: dependencies.fetch
      }, signal)
      return { valid: true }
    } catch (error) {
      return {
        valid: false,
        errorCode: getWebSearchErrorCode(error),
        message: error instanceof Error ? error.message : 'Web Search provider check failed.',
        status: getWebSearchErrorStatus(error)
      }
    }
  }

  async function runSearch(
    capability: WebSearchCapability,
    inputs: string[],
    providerId: WebSearchSearchKeywordsRequest['providerId'] | WebSearchFetchUrlsRequest['providerId'],
    options?: WebSearchRunOptions
  ): Promise<WebSearchResponse> {
    if (options?.signal?.aborted) {
      throw createWebSearchError('abort', 'Web Search request was aborted.')
    }

    const settings = await getSettings()
    const normalizedInputs =
      capability === 'searchKeywords'
        ? normalizeWebSearchKeywords(inputs, settings.maxResults)
        : normalizeWebSearchUrls(inputs, settings.maxResults)
    if (capability === 'fetchUrls') {
      validateWebFetchInputs(normalizedInputs)
    }
    const effectiveProviderId = providerId ?? (capability === 'searchKeywords' ? settings.defaultSearchProviderId : settings.defaultFetchProviderId)
    const secrets = await credentialStore.getProviderSecrets(effectiveProviderId)
    const resolution = resolver.resolve({
      providerId: effectiveProviderId,
      capability,
      settings,
      secrets
    })
    if (!resolution.ok) {
      throw createWebSearchError(resolution.errorCode, resolution.message)
    }

    const driver = registry.createDriver(resolution.provider)
    const runner = capability === 'searchKeywords' ? driver.searchKeywords : driver.fetchUrls
    if (!runner) {
      throw createWebSearchError('provider_unsupported_capability', 'Web Search provider does not support this capability.')
    }
    if (!dependencies.fetch) {
      throw createWebSearchError('provider_not_configured', 'Web Search requires a platform fetch adapter.')
    }
    const platformFetch = dependencies.fetch

    const settled = await Promise.allSettled(
      normalizedInputs.map((input) =>
        runner(input, {
          ...resolution.provider,
          maxResults: settings.maxResults,
          searchWithDate: settings.searchWithDate,
          fetch: platformFetch
        }, options?.signal)
      )
    )

    const successes = settled
      .filter((result): result is PromiseFulfilledResult<WebSearchResponse> => result.status === 'fulfilled')
      .map((result) => result.value)
    if (successes.length === 0) {
      const firstError = settled.find((result): result is PromiseRejectedResult => result.status === 'rejected')
      const errorCode = firstError && getWebSearchErrorCode(firstError.reason) === 'abort' ? 'abort' : 'partial_failure'
      throw createWebSearchError(errorCode, 'Web Search failed.', firstError?.reason)
    }

    const merged: WebSearchResponse = {
      query: capability === 'searchKeywords' ? normalizedInputs.join(' ') : undefined,
      providerId: resolution.provider.providerId,
      capability,
      inputs: normalizedInputs,
      results: successes.flatMap((response) => response.results),
      status:
        successes.length === normalizedInputs.length
          ? []
          : [
              {
                phase: 'partial_failure',
                countBefore: normalizedInputs.length,
                countAfter: successes.length
              }
            ]
    }

    const blacklistFiltered = filterWebSearchBlacklist(merged.results, settings.excludeDomains)
    const withBlacklist = {
      ...merged,
      results: blacklistFiltered.results,
      status: [...(merged.status ?? []), ...(blacklistFiltered.status ? [blacklistFiltered.status] : [])]
    }
    return applyWebSearchPostProcessing(withBlacklist, settings.compression)
  }

  return {
    listProviderViews,
    getSettings,
    updateSettings,
    updateProvider,
    revealProviderApiKey,
    checkProvider,
    searchKeywords(input, options) {
      return runSearch('searchKeywords', input.keywords, input.providerId, options)
    },
    fetchUrls(input, options) {
      return runSearch('fetchUrls', input.urls, input.providerId, options)
    }
  }
}

function createProviderView(
  preset: ReturnType<ReturnType<typeof createWebSearchProviderRegistry>['getPreset']> extends infer T ? NonNullable<T> : never,
  settings: WebSearchSettings,
  safeSecrets: Awaited<ReturnType<WebSearchCredentialStore['toSafeView']>>
): SafeWebSearchProviderView {
  const override = settings.providerOverrides[preset.id]
  return {
    id: preset.id,
    name: preset.name,
    type: preset.type,
    capabilities: preset.capabilities,
    enabled: override?.enabled ?? false,
    apiHostByCapability: Object.fromEntries(
      preset.capabilities.map((capability) => [
        capability.feature,
        override?.capabilities?.[capability.feature]?.apiHost ?? capability.apiHost ?? ''
      ])
    ),
    hasApiKey: safeSecrets.hasApiKey,
    apiKeyPreview: safeSecrets.apiKeyPreview,
    apiKeyLength: safeSecrets.apiKeyLength,
    hasBasicAuth: safeSecrets.hasBasicAuth,
    defaultForCapabilities: [
      ...(settings.defaultSearchProviderId === preset.id ? (['searchKeywords'] as const) : []),
      ...(settings.defaultFetchProviderId === preset.id ? (['fetchUrls'] as const) : [])
    ],
    phase: preset.phase,
    implemented: preset.phase === 0
  }
}

function normalizeProviderCapabilityHosts(
  apiHostByCapability: UpdateWebSearchProviderInput['apiHostByCapability']
): NonNullable<NonNullable<WebSearchSettings['providerOverrides'][WebSearchProviderId]>['capabilities']> {
  if (!apiHostByCapability || typeof apiHostByCapability !== 'object') return {}
  const normalized: NonNullable<NonNullable<WebSearchSettings['providerOverrides'][WebSearchProviderId]>['capabilities']> = {}
  for (const [capability, apiHost] of Object.entries(apiHostByCapability)) {
    if (!isWebSearchCapability(capability)) continue
    const normalizedApiHost = normalizeWebSearchApiHost(apiHost)
    if (normalizedApiHost) normalized[capability] = { apiHost: normalizedApiHost }
  }
  return normalized
}

function normalizeDefaultProviderPatch(
  input: UpdateWebSearchProviderInput,
  settings: WebSearchSettings
): Partial<WebSearchSettings> {
  if (!Array.isArray(input.defaultForCapabilities)) return {}
  const patch: Partial<WebSearchSettings> = {}
  if (input.defaultForCapabilities.includes('searchKeywords')) {
    patch.defaultSearchProviderId = input.providerId
  } else if (settings.defaultSearchProviderId === input.providerId) {
    patch.defaultSearchProviderId = createDefaultWebSearchSettings().defaultSearchProviderId
  }

  if (input.defaultForCapabilities.includes('fetchUrls')) {
    patch.defaultFetchProviderId = input.providerId
  } else if (settings.defaultFetchProviderId === input.providerId) {
    patch.defaultFetchProviderId = createDefaultWebSearchSettings().defaultFetchProviderId
  }

  return patch
}

function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return Array.from(new Set(value.flatMap((item) => (typeof item === 'string' && item.trim() ? [item.trim()] : []))))
}

function getProviderCheckProbeInput(capability: WebSearchCapability): string {
  return capability === 'searchKeywords' ? 'web search check' : 'https://example.com'
}

function validateWebFetchInputs(inputs: string[]): void {
  for (const input of inputs) {
    const safety = validateWebFetchUrl(input)
    if (!safety.ok) {
      throw createWebSearchError(safety.code, safety.message)
    }
  }
}
