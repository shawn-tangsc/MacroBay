import type {
  WebSearchCapability,
  WebSearchProviderId,
  WebSearchResponse
} from '../contracts/webSearchContracts'

export type WebSearchProviderSecrets = {
  apiKeys?: string[]
  basicAuthPassword?: string
}

export type ResolvedWebSearchProvider = {
  providerId: WebSearchProviderId
  capability: WebSearchCapability
  apiHost: string
  secrets: WebSearchProviderSecrets
  engines?: string[]
  basicAuthUsername?: string
}

export type WebSearchExecutionConfig = ResolvedWebSearchProvider & {
  maxResults: number
  searchWithDate: boolean
  fetch: typeof fetch
}

export type WebSearchProviderDriver = {
  providerId: WebSearchProviderId
  searchKeywords?: (
    keyword: string,
    config: WebSearchExecutionConfig,
    signal?: AbortSignal
  ) => Promise<WebSearchResponse>
  fetchUrls?: (url: string, config: WebSearchExecutionConfig, signal?: AbortSignal) => Promise<WebSearchResponse>
}
