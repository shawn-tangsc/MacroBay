import { describe, expect, it } from 'vitest'

import { createDefaultWebSearchSettings, normalizeWebSearchSettings } from './webSearchSettings'

describe('web search settings', () => {
  it('creates platform defaults without raw provider secrets', () => {
    expect(createDefaultWebSearchSettings()).toEqual({
      defaultSearchProviderId: 'tavily',
      defaultFetchProviderId: 'fetch',
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
    })
  })

  it('normalizes result limits and unknown provider defaults', () => {
    expect(
      normalizeWebSearchSettings({
        defaultSearchProviderId: 'unknown-provider',
        defaultFetchProviderId: 'tavily',
        maxResults: 99
      })
    ).toMatchObject({
      defaultSearchProviderId: 'tavily',
      defaultFetchProviderId: 'fetch',
      maxResults: 20
    })

    expect(normalizeWebSearchSettings({ maxResults: 0.2 })).toMatchObject({
      maxResults: 1
    })
  })

  it('normalizes blacklist domains without protocol, path, duplicates, or invalid values', () => {
    expect(
      normalizeWebSearchSettings({
        excludeDomains: [
          ' HTTPS://Example.COM/news?q=1 ',
          'example.com',
          '*.Sub.Example.com/',
          'not a domain',
          'ftp://ignored.test/path'
        ]
      }).excludeDomains
    ).toEqual(['example.com', '*.sub.example.com', 'ignored.test'])
  })

  it('falls back inactive rag compression to none and keeps cutoff bounded', () => {
    expect(
      normalizeWebSearchSettings({
        compression: {
          method: 'rag',
          cutoffLimit: 100_000,
          cutoffUnit: 'invalid'
        }
      }).compression
    ).toEqual({
      method: 'none',
      cutoffLimit: 20_000,
      cutoffUnit: 'token'
    })
  })

  it('drops raw secrets and unknown provider override fields', () => {
    expect(
      normalizeWebSearchSettings({
        providerOverrides: {
          tavily: {
            enabled: true,
            apiKeys: ['raw-secret'],
            basicAuthPassword: 'raw-password',
            capabilities: {
              searchKeywords: {
                apiHost: ' https://proxy.example.test '
              }
            },
            unexpected: 'ignored'
          }
        }
      }).providerOverrides
    ).toEqual({
      tavily: {
        enabled: true,
        capabilities: {
          searchKeywords: {
            apiHost: 'https://proxy.example.test'
          }
        }
      }
    })
  })
})
