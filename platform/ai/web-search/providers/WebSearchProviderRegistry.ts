import type { WebSearchProviderPreset } from '../contracts/webSearchContracts'
import type { ResolvedWebSearchProvider, WebSearchProviderDriver } from './WebSearchProviderDriver'
import {
  isImplementedWebSearchProviderId,
  webSearchProviderPresets
} from './webSearchProviderPresets'
import { createFetchWebSearchProvider } from './drivers/FetchWebSearchProvider'
import { createJinaWebSearchProvider } from './drivers/JinaWebSearchProvider'
import { createSearxngWebSearchProvider } from './drivers/SearxngWebSearchProvider'
import { createTavilyWebSearchProvider } from './drivers/TavilyWebSearchProvider'

export type WebSearchProviderRegistry = {
  listPresets: () => readonly WebSearchProviderPreset[]
  getPreset: (providerId: string) => WebSearchProviderPreset | null
  createDriver: (provider: ResolvedWebSearchProvider) => WebSearchProviderDriver
}

export function createWebSearchProviderRegistry(): WebSearchProviderRegistry {
  return {
    listPresets() {
      return webSearchProviderPresets
    },
    getPreset(providerId) {
      return webSearchProviderPresets.find((provider) => provider.id === providerId) ?? null
    },
    createDriver(provider) {
      if (!isImplementedWebSearchProviderId(provider.providerId)) {
        throw new Error(`unsupported_provider: ${provider.providerId}`)
      }
      switch (provider.providerId) {
        case 'tavily':
          return createTavilyWebSearchProvider()
        case 'searxng':
          return createSearxngWebSearchProvider()
        case 'jina':
          return createJinaWebSearchProvider()
        case 'fetch':
          return createFetchWebSearchProvider()
        default:
          throw new Error(`unsupported_provider: ${provider.providerId}`)
      }
    }
  }
}
