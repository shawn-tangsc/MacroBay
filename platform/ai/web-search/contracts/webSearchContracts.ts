export const webSearchProviderTypes = ['api', 'mcp', 'local'] as const
export type WebSearchProviderType = (typeof webSearchProviderTypes)[number]

export const webSearchCapabilities = ['searchKeywords', 'fetchUrls'] as const
export type WebSearchCapability = (typeof webSearchCapabilities)[number]

export const webSearchProviderIds = [
  'tavily',
  'searxng',
  'jina',
  'fetch',
  'exa',
  'exa-mcp',
  'bocha',
  'zhipu',
  'querit',
  'local-google',
  'local-bing',
  'local-baidu'
] as const
export type WebSearchProviderId = (typeof webSearchProviderIds)[number]

export type WebSearchProviderPhase = 0 | 1 | 2 | 3

export type WebSearchProviderCapabilityPreset = {
  feature: WebSearchCapability
  apiHost?: string
}

export type WebSearchProviderPreset = {
  id: WebSearchProviderId
  name: string
  type: WebSearchProviderType
  capabilities: WebSearchProviderCapabilityPreset[]
  /** Enabled before the user touches any setting, for providers that work without credentials. */
  enabledByDefault?: boolean
  websites?: {
    apiKey?: string
    docs?: string
    /** 供应商控制台/申请 API Key 的地址；本地或没有控制台的供应商留空。 */
    console?: string
  }
  phase: WebSearchProviderPhase
}

export type WebSearchProviderCapabilityOverride = {
  apiHost?: string
}

export type WebSearchProviderOverride = {
  enabled?: boolean
  apiKeys?: string[]
  capabilities?: Partial<Record<WebSearchCapability, WebSearchProviderCapabilityOverride>>
  engines?: string[]
  basicAuthUsername?: string
  basicAuthPassword?: string
}

export type SafeWebSearchProviderView = {
  id: WebSearchProviderId
  name: string
  type: WebSearchProviderType
  capabilities: WebSearchProviderCapabilityPreset[]
  enabled: boolean
  apiHostByCapability: Partial<Record<WebSearchCapability, string>>
  hasApiKey: boolean
  apiKeyPreview: string
  /** 已保存 Key 的字符数（只给数字，绝不给内容）；没有 Key 时为 0。 */
  apiKeyLength?: number
  hasBasicAuth: boolean
  defaultForCapabilities: WebSearchCapability[]
  phase: WebSearchProviderPhase
  implemented: boolean
}

export type WebSearchCompressionMethod = 'none' | 'cutoff' | 'rag'
export type WebSearchActiveCompressionMethod = Exclude<WebSearchCompressionMethod, 'rag'>

export type WebSearchCompressionConfig = {
  method: WebSearchCompressionMethod
  cutoffLimit: number
  cutoffUnit: 'char' | 'token'
  embeddingModelId?: string
  embeddingDimensions?: number
  documentCount?: number
  rerankModelId?: string
}

export type WebSearchSubscribeSource = {
  id: string
  name: string
  url: string
  enabled: boolean
  lastSyncedAt?: string
  lastError?: string
  blacklist?: string[]
}

export type WebSearchSettings = {
  defaultSearchProviderId: WebSearchProviderId
  defaultFetchProviderId: WebSearchProviderId
  searchWithDate: boolean
  maxResults: number
  excludeDomains: string[]
  subscribeSources: WebSearchSubscribeSource[]
  compression: WebSearchCompressionConfig
  providerOverrides: Partial<Record<WebSearchProviderId, WebSearchSafeProviderOverride>>
}

export type WebSearchSafeProviderOverride = Omit<WebSearchProviderOverride, 'apiKeys' | 'basicAuthPassword'>

export type WebSearchResult = {
  title: string
  content: string
  url: string
  sourceInput: string
  publishedAt?: string
  score?: number
}

export type WebSearchStatus = {
  phase: 'default' | 'fetch_complete' | 'partial_failure' | 'cutoff' | 'blacklist_filtered'
  countBefore?: number
  countAfter?: number
  message?: string
}

export type WebSearchResponse = {
  query?: string
  providerId: WebSearchProviderId
  capability: WebSearchCapability
  inputs: string[]
  results: WebSearchResult[]
  status?: WebSearchStatus[]
}

export type WebSearchSearchKeywordsRequest = {
  providerId?: WebSearchProviderId
  keywords: string[]
}

export type WebSearchFetchUrlsRequest = {
  providerId?: WebSearchProviderId
  urls: string[]
}

export type WebSearchCheckProviderRequest = {
  providerId: WebSearchProviderId
  draft?: {
    enabled?: boolean
    apiKeys?: string[]
    apiHostByCapability?: Partial<Record<WebSearchCapability, string>>
    engines?: string[]
    basicAuthUsername?: string
    basicAuthPassword?: string
  }
  capability?: WebSearchCapability
}

export type UpdateWebSearchProviderInput = {
  providerId: WebSearchProviderId
  enabled?: boolean
  apiKeys?: string[]
  apiHostByCapability?: Partial<Record<WebSearchCapability, string>>
  engines?: string[]
  basicAuthUsername?: string
  basicAuthPassword?: string
  defaultForCapabilities?: WebSearchCapability[]
}

export type WebSearchCheckProviderResponse = {
  valid: boolean
  errorCode?: WebSearchErrorCode
  message?: string
  /** HTTP status when the failure came from an upstream response (e.g. 401/403). */
  status?: number
}

export type WebSearchRunOptions = {
  signal?: AbortSignal
  consumer?: {
    kind: 'assistant' | 'agent' | 'product' | 'settings'
    id?: string
    sessionId?: string
  }
}

export type WebSearchErrorCode =
  | 'provider_not_configured'
  | 'provider_disabled'
  | 'provider_unsupported_capability'
  | 'unsupported_provider'
  | 'missing_api_key'
  | 'invalid_api_host'
  | 'invalid_input'
  | 'unsafe_url'
  | 'timeout'
  | 'abort'
  | 'provider_http_error'
  | 'provider_unauthorized'
  | 'provider_response_invalid'
  | 'network_error'
  | 'partial_failure'
  | 'unknown'
