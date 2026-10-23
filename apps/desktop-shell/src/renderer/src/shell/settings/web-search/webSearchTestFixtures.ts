import type {
  SafeWebSearchProviderView,
  WebSearchSettings
} from '@platform/ai/web-search/contracts/webSearchContracts'
import { createDefaultWebSearchSettings } from '@platform/ai/web-search/contracts/webSearchSettings'

import { platformText } from '../../../i18n/platformText'

export const zhWebSearch = platformText['zh-CN'].webSearch
export const enWebSearch = platformText['en-US'].webSearch

/** 让 provider 视图与 settings.providerOverrides 保持同一份事实（与真实 service 一致）。 */
export type TestProviderState = {
  tavilyEnabled?: boolean
  tavilyHasApiKey?: boolean
  fetchEnabled?: boolean
}

const tavilyProvider: SafeWebSearchProviderView = {
  id: 'tavily',
  name: 'Tavily',
  type: 'api',
  capabilities: [{ feature: 'searchKeywords', apiHost: 'https://api.tavily.com' }],
  enabled: true,
  apiHostByCapability: { searchKeywords: 'https://api.tavily.com' },
  hasApiKey: true,
  apiKeyPreview: 'tvly**********7890',
  hasBasicAuth: false,
  defaultForCapabilities: ['searchKeywords'],
  phase: 0,
  implemented: true
}

const fetchProvider: SafeWebSearchProviderView = {
  id: 'fetch',
  name: 'Fetch',
  type: 'api',
  capabilities: [{ feature: 'fetchUrls' }],
  enabled: true,
  apiHostByCapability: {},
  hasApiKey: false,
  apiKeyPreview: '',
  hasBasicAuth: false,
  defaultForCapabilities: ['fetchUrls'],
  phase: 0,
  implemented: true
}

const deferredProviders: SafeWebSearchProviderView[] = [
  {
    id: 'exa',
    name: 'Exa',
    type: 'api',
    capabilities: [{ feature: 'searchKeywords', apiHost: 'https://api.exa.ai' }],
    enabled: false,
    apiHostByCapability: { searchKeywords: 'https://api.exa.ai' },
    hasApiKey: false,
    apiKeyPreview: '',
    hasBasicAuth: false,
    defaultForCapabilities: [],
    phase: 1,
    implemented: false
  },
  {
    id: 'bocha',
    name: 'Bocha',
    type: 'api',
    capabilities: [{ feature: 'searchKeywords', apiHost: 'https://api.bochaai.com' }],
    enabled: false,
    apiHostByCapability: { searchKeywords: 'https://api.bochaai.com' },
    hasApiKey: false,
    apiKeyPreview: '',
    hasBasicAuth: false,
    defaultForCapabilities: [],
    phase: 2,
    implemented: false
  }
]

export function createTestProviders(state: TestProviderState = {}): SafeWebSearchProviderView[] {
  return [
    {
      ...tavilyProvider,
      enabled: state.tavilyEnabled ?? true,
      hasApiKey: state.tavilyHasApiKey ?? true
    },
    { ...fetchProvider, enabled: state.fetchEnabled ?? true },
    ...deferredProviders
  ]
}

export function createTestSettings(state: TestProviderState = {}): WebSearchSettings {
  return {
    ...createDefaultWebSearchSettings(),
    providerOverrides: {
      tavily: { enabled: state.tavilyEnabled ?? true },
      fetch: { enabled: state.fetchEnabled ?? true }
    }
  }
}
