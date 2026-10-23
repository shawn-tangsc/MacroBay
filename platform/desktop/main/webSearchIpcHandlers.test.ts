import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import { createWebSearchIpcHandlers } from './webSearchIpcHandlers'
import { createDefaultWebSearchSettings } from '../../ai/web-search/contracts/webSearchSettings'

describe('web search IPC handlers', () => {
  it('returns safe provider views without raw credentials', async () => {
    const handlers = createWebSearchIpcHandlers({
      listProviderViews: async () => [
        {
          id: 'tavily',
          name: 'Tavily',
          type: 'api',
          capabilities: [{ feature: 'searchKeywords', apiHost: 'https://api.tavily.com' }],
          enabled: true,
          apiHostByCapability: { searchKeywords: 'https://api.tavily.com' },
          hasApiKey: true,
          apiKeyPreview: 'tvly...7890',
          hasBasicAuth: false,
          defaultForCapabilities: ['searchKeywords'],
          phase: 0,
          implemented: true
        }
      ],
      getSettings: async () => createDefaultWebSearchSettings(),
      updateSettings: async () => createDefaultWebSearchSettings(),
      updateProvider: async () => {
        throw new Error('not used')
      },
      revealProviderApiKey: async () => null,
      checkProvider: async () => ({ valid: true }),
      searchKeywords: async () => ({
        providerId: 'tavily',
        capability: 'searchKeywords',
        inputs: ['docs'],
        results: []
      }),
      fetchUrls: async () => ({
        providerId: 'fetch',
        capability: 'fetchUrls',
        inputs: ['https://example.com'],
        results: []
      })
    })

    const providers = await handlers.listProviders()
    expect(providers[0]).toMatchObject({
      hasApiKey: true,
      apiKeyPreview: 'tvly...7890'
    })
    expect(JSON.stringify(providers)).not.toContain('apiKeys')
    expect(JSON.stringify(providers)).not.toContain('basicAuthPassword')
  })

  it('reveals a saved key only for a whitelisted provider id', async () => {
    const revealed: string[] = []
    const handlers = createWebSearchIpcHandlers({
      listProviderViews: async () => [],
      getSettings: async () => createDefaultWebSearchSettings(),
      updateSettings: async () => createDefaultWebSearchSettings(),
      updateProvider: async () => {
        throw new Error('not used')
      },
      revealProviderApiKey: async (providerId) => {
        revealed.push(providerId)
        return 'tvly-secret-1234567890'
      },
      checkProvider: async () => ({ valid: true }),
      searchKeywords: async () => {
        throw new Error('not used')
      },
      fetchUrls: async () => {
        throw new Error('not used')
      }
    })

    await expect(handlers.revealProviderApiKey('tavily')).resolves.toEqual({ apiKey: 'tvly-secret-1234567890' })
    await expect(handlers.revealProviderApiKey('not-a-provider')).rejects.toThrow(/providerId/)
    expect(revealed).toEqual(['tavily'])
  })

  it('never logs a revealed key from the handler module (static guard)', () => {
    const source = readFileSync(resolve(__dirname, 'webSearchIpcHandlers.ts'), 'utf8')
    expect(source).not.toMatch(/console\.[a-z]+\([\s\S]{0,80}(apiKey|revealProviderApiKey)/i)
  })

  it('validates malformed search and fetch payloads before calling the service', async () => {
    const handlers = createWebSearchIpcHandlers({
      listProviderViews: async () => [],
      getSettings: async () => createDefaultWebSearchSettings(),
      updateSettings: async () => createDefaultWebSearchSettings(),
      updateProvider: async () => {
        throw new Error('not used')
      },
      revealProviderApiKey: async () => null,
      checkProvider: async () => ({ valid: true }),
      searchKeywords: async () => {
        throw new Error('search should not be called')
      },
      fetchUrls: async () => {
        throw new Error('fetch should not be called')
      }
    })

    await expect(handlers.searchKeywords({ keywords: 'docs' })).rejects.toThrow(/keywords/)
    await expect(handlers.fetchUrls({ urls: 'https:\/\/example.com' })).rejects.toThrow(/urls/)
  })
})
