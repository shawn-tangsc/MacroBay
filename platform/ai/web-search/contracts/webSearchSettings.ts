import {
  webSearchCapabilities,
  type WebSearchCapability,
  type WebSearchCompressionConfig,
  type WebSearchProviderId,
  type WebSearchSafeProviderOverride,
  type WebSearchSettings,
  type WebSearchSubscribeSource
} from './webSearchContracts'
import {
  isWebSearchProviderId,
  normalizeWebSearchApiHost,
  providerSupportsWebSearchCapability
} from './webSearchProviderSchemas'

const defaultSearchProviderId: WebSearchProviderId = 'tavily'
const defaultFetchProviderId: WebSearchProviderId = 'fetch'

export type { WebSearchSettings } from './webSearchContracts'

export function createDefaultWebSearchSettings(): WebSearchSettings {
  return {
    defaultSearchProviderId,
    defaultFetchProviderId,
    searchWithDate: true,
    maxResults: 5,
    excludeDomains: [],
    subscribeSources: [],
    compression: {
      method: 'none',
      cutoffLimit: 2000,
      cutoffUnit: 'token'
    },
    providerOverrides: {}
  }
}

export function normalizeWebSearchSettings(
  value: unknown,
  defaults: WebSearchSettings = createDefaultWebSearchSettings()
): WebSearchSettings {
  if (!value || typeof value !== 'object') return defaults
  const candidate = value as Partial<WebSearchSettings>

  return {
    defaultSearchProviderId: normalizeDefaultProviderId(
      candidate.defaultSearchProviderId,
      'searchKeywords',
      defaults.defaultSearchProviderId
    ),
    defaultFetchProviderId: normalizeDefaultProviderId(
      candidate.defaultFetchProviderId,
      'fetchUrls',
      defaults.defaultFetchProviderId
    ),
    searchWithDate: typeof candidate.searchWithDate === 'boolean' ? candidate.searchWithDate : defaults.searchWithDate,
    maxResults: normalizeMaxResults(candidate.maxResults, defaults.maxResults),
    excludeDomains: normalizeBlacklistDomains(candidate.excludeDomains, defaults.excludeDomains),
    subscribeSources: normalizeSubscribeSources(candidate.subscribeSources, defaults.subscribeSources),
    compression: normalizeCompression(candidate.compression, defaults.compression),
    providerOverrides: normalizeProviderOverrides(candidate.providerOverrides, defaults.providerOverrides)
  }
}

export function normalizeBlacklistDomains(value: unknown, defaults: string[] = []): string[] {
  if (!Array.isArray(value)) return defaults
  return dedupe(value.flatMap((item) => normalizeBlacklistDomainPattern(item) ?? []))
}

export function normalizeBlacklistDomainPattern(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim().toLowerCase()
  if (!trimmed) return undefined

  const wildcard = trimmed.startsWith('*.')
  const withoutWildcard = wildcard ? trimmed.slice(2) : trimmed
  const host = extractDomainHost(withoutWildcard)
  if (!host || !isValidDomain(host)) return undefined
  return wildcard ? `*.${host}` : host
}

function normalizeDefaultProviderId(
  value: unknown,
  capability: WebSearchCapability,
  fallback: WebSearchProviderId
): WebSearchProviderId {
  return isWebSearchProviderId(value) && providerSupportsWebSearchCapability(value, capability) ? value : fallback
}

function normalizeMaxResults(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return clamp(Math.round(value), 1, 20)
}

function normalizeCompression(value: unknown, defaults: WebSearchCompressionConfig): WebSearchCompressionConfig {
  if (!value || typeof value !== 'object') return defaults
  const candidate = value as Partial<WebSearchCompressionConfig>
  const method = candidate.method === 'cutoff' || candidate.method === 'none' ? candidate.method : 'none'
  return {
    method,
    cutoffLimit:
      typeof candidate.cutoffLimit === 'number' && Number.isFinite(candidate.cutoffLimit)
        ? clamp(Math.round(candidate.cutoffLimit), 1, 20_000)
        : defaults.cutoffLimit,
    cutoffUnit: candidate.cutoffUnit === 'char' || candidate.cutoffUnit === 'token' ? candidate.cutoffUnit : defaults.cutoffUnit
  }
}

function normalizeSubscribeSources(value: unknown, defaults: WebSearchSubscribeSource[]): WebSearchSubscribeSource[] {
  if (!Array.isArray(value)) return defaults
  return value.flatMap((item) => normalizeSubscribeSource(item) ?? [])
}

function normalizeSubscribeSource(value: unknown): WebSearchSubscribeSource | undefined {
  if (!value || typeof value !== 'object') return undefined
  const candidate = value as Partial<WebSearchSubscribeSource>
  const id = typeof candidate.id === 'string' ? candidate.id.trim() : ''
  const name = typeof candidate.name === 'string' ? candidate.name.trim() : ''
  if (!id || !name || typeof candidate.url !== 'string') return undefined

  try {
    const url = new URL(candidate.url.trim())
    if (url.protocol !== 'https:') return undefined
    return {
      id,
      name,
      url: url.toString(),
      enabled: Boolean(candidate.enabled),
      lastSyncedAt: typeof candidate.lastSyncedAt === 'string' ? candidate.lastSyncedAt : undefined,
      lastError: typeof candidate.lastError === 'string' ? candidate.lastError : undefined,
      blacklist: normalizeBlacklistDomains(candidate.blacklist, [])
    }
  } catch {
    return undefined
  }
}

function normalizeProviderOverrides(
  value: unknown,
  defaults: WebSearchSettings['providerOverrides']
): WebSearchSettings['providerOverrides'] {
  if (!value || typeof value !== 'object') return defaults
  const candidate = value as Record<string, unknown>
  const normalized: WebSearchSettings['providerOverrides'] = {}

  for (const [providerId, override] of Object.entries(candidate)) {
    if (!isWebSearchProviderId(providerId)) continue
    const safeOverride = normalizeProviderOverride(override)
    if (safeOverride) {
      normalized[providerId] = safeOverride
    }
  }

  return normalized
}

function normalizeProviderOverride(value: unknown): WebSearchSafeProviderOverride | undefined {
  if (!value || typeof value !== 'object') return undefined
  const candidate = value as Record<string, unknown>
  const normalized: WebSearchSafeProviderOverride = {}

  if (typeof candidate.enabled === 'boolean') {
    normalized.enabled = candidate.enabled
  }

  const capabilities = normalizeCapabilityOverrides(candidate.capabilities)
  if (Object.keys(capabilities).length > 0) {
    normalized.capabilities = capabilities
  }

  const engines = normalizeStringList(candidate.engines)
  if (engines.length > 0) {
    normalized.engines = engines
  }

  if (typeof candidate.basicAuthUsername === 'string' && candidate.basicAuthUsername.trim()) {
    normalized.basicAuthUsername = candidate.basicAuthUsername.trim()
  }

  return Object.keys(normalized).length > 0 ? normalized : undefined
}

function normalizeCapabilityOverrides(
  value: unknown
): NonNullable<WebSearchSafeProviderOverride['capabilities']> {
  if (!value || typeof value !== 'object') return {}
  const candidate = value as Record<string, unknown>
  const normalized: NonNullable<WebSearchSafeProviderOverride['capabilities']> = {}

  for (const capability of webSearchCapabilities) {
    const override = candidate[capability]
    if (!override || typeof override !== 'object') continue
    const apiHost = normalizeWebSearchApiHost((override as { apiHost?: unknown }).apiHost)
    if (apiHost) {
      normalized[capability] = { apiHost }
    }
  }

  return normalized
}

function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return dedupe(value.flatMap((item) => (typeof item === 'string' && item.trim() ? [item.trim()] : [])))
}

function extractDomainHost(value: string): string {
  try {
    return new URL(value.includes('://') ? value : `https://${value}`).hostname.replace(/\.$/, '')
  } catch {
    return value.split(/[/?#]/, 1)[0]?.replace(/\.$/, '') ?? ''
  }
}

function isValidDomain(value: string): boolean {
  const labels = value.split('.')
  return (
    labels.length >= 2 &&
    labels.every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)) &&
    /^[a-z][a-z0-9-]{1,62}$/.test(labels[labels.length - 1])
  )
}

function dedupe(values: string[]): string[] {
  return Array.from(new Set(values))
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
