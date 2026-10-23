import type { WebSearchProviderPreset } from '../contracts/webSearchContracts'

export const implementedWebSearchProviderIds = ['tavily', 'searxng', 'jina', 'fetch'] as const

export const webSearchProviderPresets: WebSearchProviderPreset[] = [
  {
    id: 'tavily',
    name: 'Tavily',
    type: 'api',
    phase: 0,
    capabilities: [{ feature: 'searchKeywords', apiHost: 'https://api.tavily.com' }],
    websites: {
      apiKey: 'https://app.tavily.com/home',
      docs: 'https://docs.tavily.com',
      console: 'https://app.tavily.com/'
    }
  },
  {
    id: 'searxng',
    name: 'Searxng',
    type: 'api',
    phase: 0,
    capabilities: [{ feature: 'searchKeywords', apiHost: 'http://localhost:8080' }],
    websites: {
      docs: 'https://docs.searxng.org'
    }
  },
  {
    id: 'jina',
    name: 'Jina',
    type: 'api',
    phase: 0,
    capabilities: [
      { feature: 'searchKeywords', apiHost: 'https://s.jina.ai' },
      { feature: 'fetchUrls', apiHost: 'https://r.jina.ai' }
    ],
    websites: {
      apiKey: 'https://jina.ai',
      docs: 'https://jina.ai/reader',
      console: 'https://jina.ai/api-dashboard/'
    }
  },
  {
    id: 'fetch',
    name: 'Fetch',
    type: 'api',
    phase: 0,
    capabilities: [{ feature: 'fetchUrls' }]
  },
  {
    id: 'exa',
    name: 'Exa',
    type: 'api',
    phase: 1,
    capabilities: [{ feature: 'searchKeywords', apiHost: 'https://api.exa.ai' }]
  },
  {
    id: 'exa-mcp',
    name: 'Exa MCP',
    type: 'mcp',
    phase: 2,
    capabilities: [{ feature: 'searchKeywords' }]
  },
  {
    id: 'bocha',
    name: 'Bocha',
    type: 'api',
    phase: 1,
    capabilities: [{ feature: 'searchKeywords', apiHost: 'https://api.bochaai.com' }]
  },
  {
    id: 'zhipu',
    name: 'Zhipu',
    type: 'api',
    phase: 1,
    capabilities: [{ feature: 'searchKeywords', apiHost: 'https://open.bigmodel.cn' }]
  },
  {
    id: 'querit',
    name: 'Querit',
    type: 'api',
    phase: 1,
    capabilities: [{ feature: 'searchKeywords' }]
  },
  {
    id: 'local-google',
    name: 'Local Google',
    type: 'local',
    phase: 3,
    capabilities: [{ feature: 'searchKeywords' }]
  },
  {
    id: 'local-bing',
    name: 'Local Bing',
    type: 'local',
    phase: 3,
    capabilities: [{ feature: 'searchKeywords' }]
  },
  {
    id: 'local-baidu',
    name: 'Local Baidu',
    type: 'local',
    phase: 3,
    capabilities: [{ feature: 'searchKeywords' }]
  }
]

export function isImplementedWebSearchProviderId(providerId: string): boolean {
  return implementedWebSearchProviderIds.includes(providerId as (typeof implementedWebSearchProviderIds)[number])
}
