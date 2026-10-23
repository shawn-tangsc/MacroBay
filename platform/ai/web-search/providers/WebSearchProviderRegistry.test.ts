import { describe, expect, it } from 'vitest'

import { createWebSearchProviderRegistry } from './WebSearchProviderRegistry'
import { webSearchProviderPresets } from './webSearchProviderPresets'

describe('web search provider registry', () => {
  it('keeps preset ids unique and declares phase-zero provider capabilities', () => {
    const ids = webSearchProviderPresets.map((provider) => provider.id)

    expect(new Set(ids).size).toBe(ids.length)
    expect(webSearchProviderPresets.find((provider) => provider.id === 'tavily')).toMatchObject({
      phase: 0,
      capabilities: [{ feature: 'searchKeywords', apiHost: 'https://api.tavily.com' }]
    })
    expect(webSearchProviderPresets.find((provider) => provider.id === 'fetch')).toMatchObject({
      phase: 0,
      capabilities: [{ feature: 'fetchUrls' }]
    })
  })

  it('creates drivers only for implemented providers', () => {
    const registry = createWebSearchProviderRegistry()

    expect(registry.createDriver({ providerId: 'fetch', capability: 'fetchUrls', apiHost: '', secrets: {} })).toMatchObject({
      providerId: 'fetch'
    })
    expect(() =>
      registry.createDriver({ providerId: 'exa', capability: 'searchKeywords', apiHost: 'https://api.exa.ai', secrets: {} })
    ).toThrow(/unsupported_provider/)
  })
})
