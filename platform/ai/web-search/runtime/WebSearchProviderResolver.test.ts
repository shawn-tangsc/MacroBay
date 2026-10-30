import { describe, expect, it } from 'vitest'

import { createDefaultWebSearchSettings } from '../contracts/webSearchSettings'
import { createWebSearchProviderResolver } from './WebSearchProviderResolver'

describe('web search provider resolver', () => {
  it('selects enabled default providers by capability', () => {
    const resolver = createWebSearchProviderResolver()
    const settings = {
      ...createDefaultWebSearchSettings(),
      providerOverrides: {
        tavily: { enabled: true },
        fetch: { enabled: true }
      }
    }

    expect(
      resolver.resolve({
        capability: 'searchKeywords',
        settings,
        secrets: { apiKeys: ['tvly-key'] }
      })
    ).toMatchObject({
      ok: true,
      provider: {
        providerId: 'tavily',
        capability: 'searchKeywords'
      }
    })

    expect(
      resolver.resolve({
        capability: 'fetchUrls',
        settings,
        secrets: {}
      })
    ).toMatchObject({
      ok: true,
      provider: {
        providerId: 'fetch',
        capability: 'fetchUrls'
      }
    })
  })

  it('resolves the credential-free fetch provider without an explicit enable', () => {
    const resolver = createWebSearchProviderResolver()

    expect(
      resolver.resolve({
        capability: 'fetchUrls',
        settings: createDefaultWebSearchSettings(),
        secrets: {}
      })
    ).toMatchObject({ ok: true, provider: { providerId: 'fetch', capability: 'fetchUrls' } })

    // Providers that need a key still stay off by default.
    expect(
      resolver.resolve({
        providerId: 'jina',
        capability: 'fetchUrls',
        settings: createDefaultWebSearchSettings(),
        secrets: { apiKeys: ['jina-key'] }
      })
    ).toMatchObject({ ok: false, errorCode: 'provider_disabled' })
  })

  it('keeps an explicitly disabled provider off', () => {
    const resolver = createWebSearchProviderResolver()

    expect(
      resolver.resolve({
        capability: 'fetchUrls',
        settings: { ...createDefaultWebSearchSettings(), providerOverrides: { fetch: { enabled: false } } },
        secrets: {}
      })
    ).toMatchObject({ ok: false, errorCode: 'provider_disabled' })
  })

  it('prefers an explicit provider selection when it supports the capability', () => {
    const resolver = createWebSearchProviderResolver()
    const settings = {
      ...createDefaultWebSearchSettings(),
      providerOverrides: {
        jina: { enabled: true }
      }
    }

    expect(
      resolver.resolve({
        providerId: 'jina',
        capability: 'fetchUrls',
        settings,
        secrets: { apiKeys: ['jina-key'] }
      })
    ).toMatchObject({
      ok: true,
      provider: {
        providerId: 'jina',
        capability: 'fetchUrls'
      }
    })
  })

  it('requires an API key for jina as well as tavily', () => {
    const resolver = createWebSearchProviderResolver()
    const settings = {
      ...createDefaultWebSearchSettings(),
      providerOverrides: { jina: { enabled: true }, searxng: { enabled: true } }
    }

    expect(
      resolver.resolve({ providerId: 'jina', capability: 'searchKeywords', settings, secrets: {} })
    ).toMatchObject({ ok: false, errorCode: 'missing_api_key' })
    expect(
      resolver.resolve({
        providerId: 'jina',
        capability: 'searchKeywords',
        settings,
        secrets: { apiKeys: ['jina-key'] }
      })
    ).toMatchObject({ ok: true })
    // searxng 仍不要求 Key
    expect(
      resolver.resolve({
        providerId: 'searxng',
        capability: 'searchKeywords',
        settings: { ...settings, defaultSearchProviderId: 'searxng' },
        secrets: {}
      })
    ).toMatchObject({ ok: true })
  })

  it('rejects disabled, missing key, and unsupported capability cases', () => {
    const resolver = createWebSearchProviderResolver()
    const settings = {
      ...createDefaultWebSearchSettings(),
      providerOverrides: {
        tavily: { enabled: false },
        fetch: { enabled: true }
      }
    }

    expect(
      resolver.resolve({
        providerId: 'tavily',
        capability: 'searchKeywords',
        settings,
        secrets: { apiKeys: ['tvly-key'] }
      })
    ).toMatchObject({ ok: false, errorCode: 'provider_disabled' })

    expect(
      resolver.resolve({
        providerId: 'tavily',
        capability: 'searchKeywords',
        settings: {
          ...createDefaultWebSearchSettings(),
          providerOverrides: {
            tavily: { enabled: true }
          }
        },
        secrets: {}
      })
    ).toMatchObject({ ok: false, errorCode: 'missing_api_key' })

    expect(
      resolver.resolve({
        providerId: 'fetch',
        capability: 'searchKeywords',
        settings,
        secrets: {}
      })
    ).toMatchObject({ ok: false, errorCode: 'provider_unsupported_capability' })
  })
})
