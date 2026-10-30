import { describe, expect, it } from 'vitest'

import { createDefaultWebSearchSettings } from '../contracts/webSearchSettings'
import type { WebSearchSettings } from '../contracts/webSearchContracts'
import { createWebSearchCredentialStore } from './WebSearchCredentialStore'
import { createWebSearchService } from './WebSearchService'

describe('WebSearchService', () => {
  it('searches keywords successfully and applies blacklist plus cutoff', async () => {
    const credentialStore = createWebSearchCredentialStore()
    await credentialStore.updateProviderSecrets('tavily', { apiKeys: ['tvly-secret'] })
    const service = createWebSearchService({
      credentialStore,
      getSettings: async () => ({
        ...createDefaultWebSearchSettings(),
        providerOverrides: { tavily: { enabled: true } },
        excludeDomains: ['blocked.example.com'],
        compression: { method: 'cutoff', cutoffLimit: 8, cutoffUnit: 'char' }
      }),
      fetch: (async () =>
        Response.json({
          results: [
            { title: 'Allowed', url: 'https://allowed.example.com', content: 'abcdefghij' },
            { title: 'Blocked', url: 'https://blocked.example.com', content: 'blocked' }
          ]
        })) as typeof globalThis.fetch
    })

    await expect(service.searchKeywords({ keywords: [' docs '] })).resolves.toMatchObject({
      providerId: 'tavily',
      capability: 'searchKeywords',
      inputs: ['docs'],
      results: [{ title: 'Allowed', content: 'abcdefgh' }],
      status: [
        { phase: 'blacklist_filtered', countBefore: 2, countAfter: 1 },
        { phase: 'cutoff', countBefore: 10, countAfter: 8 }
      ]
    })
    await expect(service.searchKeywords({ keywords: ['docs'] })).resolves.not.toHaveProperty('apiKeys')
  })

  it('fetches URLs successfully with the default fetch provider', async () => {
    const service = createWebSearchService({
      credentialStore: createWebSearchCredentialStore(),
      getSettings: async () => createDefaultWebSearchSettings(),
      fetch: (async () => new Response('plain text body', { headers: { 'content-type': 'text/plain' } })) as typeof globalThis.fetch
    })

    await expect(service.fetchUrls({ urls: ['https://example.com/page'] })).resolves.toMatchObject({
      providerId: 'fetch',
      capability: 'fetchUrls',
      inputs: ['https://example.com/page'],
      results: [{ title: 'https://example.com/page', content: 'plain text body' }]
    })
  })

  it('returns partial failure when at least one input succeeds', async () => {
    const service = createWebSearchService({
      credentialStore: createWebSearchCredentialStore(),
      getSettings: async () => ({
        ...createDefaultWebSearchSettings(),
        providerOverrides: { fetch: { enabled: true } }
      }),
      fetch: (async (url: RequestInfo | URL) => {
        if (String(url).includes('fail.example.com')) {
          throw new Error('network down')
        }
        return new Response('ok', { headers: { 'content-type': 'text/plain' } })
      }) as typeof globalThis.fetch
    })

    await expect(
      service.fetchUrls({ urls: ['https://ok.example.com', 'https://fail.example.com'] })
    ).resolves.toMatchObject({
      providerId: 'fetch',
      status: [{ phase: 'partial_failure', countBefore: 2, countAfter: 1 }]
    })
  })

  it('throws a normalized partial failure when all inputs fail', async () => {
    const service = createWebSearchService({
      credentialStore: createWebSearchCredentialStore(),
      getSettings: async () => ({
        ...createDefaultWebSearchSettings(),
        providerOverrides: { fetch: { enabled: true } }
      }),
      fetch: (async () => {
        throw new Error('network down')
      }) as typeof globalThis.fetch
    })

    await expect(service.fetchUrls({ urls: ['https://fail.example.com'] })).rejects.toMatchObject({
      code: 'partial_failure'
    })
  })

  it('propagates abort before running providers', async () => {
    const abortController = new AbortController()
    abortController.abort()
    const service = createWebSearchService({
      credentialStore: createWebSearchCredentialStore(),
      getSettings: async () => createDefaultWebSearchSettings(),
      fetch: (async () => new Response('never')) as typeof globalThis.fetch
    })

    await expect(
      service.fetchUrls({ urls: ['https://example.com'] }, { signal: abortController.signal })
    ).rejects.toMatchObject({
      code: 'abort'
    })
  })

  it('does not execute a provider that is explicitly disabled', async () => {
    let called = false
    const service = createWebSearchService({
      credentialStore: createWebSearchCredentialStore(),
      getSettings: async () => ({
        ...createDefaultWebSearchSettings(),
        providerOverrides: { fetch: { enabled: false } }
      }),
      fetch: (async () => {
        called = true
        return new Response('never')
      }) as typeof globalThis.fetch
    })

    await expect(service.fetchUrls({ urls: ['https://example.com'] })).rejects.toMatchObject({
      code: 'provider_disabled'
    })
    expect(called).toBe(false)
  })

  it('lists the credential-free fetch provider as enabled by default', async () => {
    const service = createWebSearchService({
      credentialStore: createWebSearchCredentialStore(),
      getSettings: async () => createDefaultWebSearchSettings()
    })

    const views = await service.listProviderViews()

    expect(views.find((view) => view.id === 'fetch')).toMatchObject({ enabled: true })
    expect(views.find((view) => view.id === 'tavily')).toMatchObject({ enabled: false })
  })

  it('rejects unsafe fetch URLs before dispatching to any provider driver', async () => {
    let calledUrl = ''
    const service = createWebSearchService({
      credentialStore: createWebSearchCredentialStore(),
      getSettings: async () => ({
        ...createDefaultWebSearchSettings(),
        defaultFetchProviderId: 'jina',
        providerOverrides: { jina: { enabled: true } }
      }),
      fetch: (async (url: RequestInfo | URL) => {
        calledUrl = String(url)
        return new Response('never')
      }) as typeof globalThis.fetch
    })

    await expect(service.fetchUrls({ urls: ['http://127.0.0.1/private'] })).rejects.toMatchObject({
      code: 'unsafe_url'
    })
    expect(calledUrl).toBe('')
  })

  it('checks providers by executing a real platform-backed probe with draft settings', async () => {
    const credentialStore = createWebSearchCredentialStore()
    const calls: string[] = []
    const service = createWebSearchService({
      credentialStore,
      getSettings: async () => createDefaultWebSearchSettings(),
      fetch: (async (url: RequestInfo | URL) => {
        calls.push(String(url))
        return new Response('probe ok', { headers: { 'content-type': 'text/plain' } })
      }) as typeof globalThis.fetch
    })

    await expect(
      service.checkProvider({
        providerId: 'fetch',
        capability: 'fetchUrls',
        draft: { enabled: true }
      })
    ).resolves.toMatchObject({ valid: true })
    expect(calls).toEqual(['https://example.com/'])
  })

  it('updates provider settings and stores raw secrets only in the credential store', async () => {
    const credentialStore = createWebSearchCredentialStore()
    let savedSettings: WebSearchSettings = createDefaultWebSearchSettings()
    const service = createWebSearchService({
      credentialStore,
      getSettings: async () => savedSettings,
      updateSettings: async (settings) => {
        savedSettings = settings
      }
    })

    const provider = await service.updateProvider({
      providerId: 'tavily',
      enabled: true,
      apiKeys: ['tvly-secret-1234567890'],
      apiHostByCapability: { searchKeywords: 'https://api.tavily.com/' },
      defaultForCapabilities: ['searchKeywords']
    })

    expect(provider).toMatchObject({
      id: 'tavily',
      enabled: true,
      hasApiKey: true,
      apiKeyPreview: 'tvly**********7890',
      defaultForCapabilities: ['searchKeywords']
    })
    expect((savedSettings as unknown as Record<string, unknown>).webSearch).toBeUndefined()
    expect(savedSettings.providerOverrides.tavily).toEqual({
      enabled: true,
      capabilities: {
        searchKeywords: {
          apiHost: 'https://api.tavily.com'
        }
      }
    })
    expect(await credentialStore.getProviderSecrets('tavily')).toEqual({
      apiKeys: ['tvly-secret-1234567890']
    })
    expect(JSON.stringify(provider)).not.toContain('tvly-secret')
    expect(JSON.stringify(savedSettings)).not.toContain('tvly-secret')
  })

  it('requires an injected platform fetch adapter before provider execution', async () => {
    const service = createWebSearchService({
      credentialStore: createWebSearchCredentialStore(),
      getSettings: async () => ({
        ...createDefaultWebSearchSettings(),
        providerOverrides: { fetch: { enabled: true } }
      })
    })

    await expect(service.fetchUrls({ urls: ['https://example.com'] })).rejects.toMatchObject({
      code: 'provider_not_configured'
    })
  })
})
