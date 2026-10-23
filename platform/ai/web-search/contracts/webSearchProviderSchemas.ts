import {
  webSearchCapabilities,
  webSearchProviderIds,
  type WebSearchCapability,
  type WebSearchProviderId
} from './webSearchContracts'

const phaseZeroCapabilities: Record<WebSearchProviderId, WebSearchCapability[]> = {
  tavily: ['searchKeywords'],
  searxng: ['searchKeywords'],
  jina: ['searchKeywords', 'fetchUrls'],
  fetch: ['fetchUrls'],
  exa: ['searchKeywords'],
  'exa-mcp': ['searchKeywords'],
  bocha: ['searchKeywords'],
  zhipu: ['searchKeywords'],
  querit: ['searchKeywords'],
  'local-google': ['searchKeywords'],
  'local-bing': ['searchKeywords'],
  'local-baidu': ['searchKeywords']
}

export function isWebSearchProviderId(value: unknown): value is WebSearchProviderId {
  return webSearchProviderIds.includes(value as WebSearchProviderId)
}

export function isWebSearchCapability(value: unknown): value is WebSearchCapability {
  return webSearchCapabilities.includes(value as WebSearchCapability)
}

export function providerSupportsWebSearchCapability(
  providerId: WebSearchProviderId,
  capability: WebSearchCapability
): boolean {
  return phaseZeroCapabilities[providerId].includes(capability)
}

export function normalizeWebSearchApiHost(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (!trimmed) return undefined

  try {
    const url = new URL(trimmed)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined
    url.hash = ''
    return url.toString().replace(/\/$/, '')
  } catch {
    return undefined
  }
}
