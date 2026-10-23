import { describe, expect, it } from 'vitest'

import { createWebSearchCredentialStore } from './WebSearchCredentialStore'

describe('web search credential store', () => {
  it('masks safe views without returning raw secrets', async () => {
    const store = createWebSearchCredentialStore()

    await store.updateProviderSecrets('tavily', {
      apiKeys: ['tvly-secret-1234567890'],
      basicAuthPassword: 'basic-password'
    })

    const safeView = await store.toSafeView('tavily')
    expect(safeView).toEqual({
      hasApiKey: true,
      apiKeyPreview: 'tvly**********7890',
      apiKeyLength: 22,
      hasBasicAuth: true
    })
    expect(JSON.stringify(safeView)).not.toContain('tvly-secret')
    expect(JSON.stringify(safeView)).not.toContain('basic-password')
  })

  it('preserves, replaces, and clears provider secrets', async () => {
    const writes: unknown[] = []
    const store = createWebSearchCredentialStore({
      read: async () => undefined,
      write: async (value) => {
        writes.push(value)
      }
    })

    await store.updateProviderSecrets('tavily', { apiKeys: ['first', 'second'] })
    await expect(store.getProviderSecrets('tavily')).resolves.toEqual({
      apiKeys: ['first', 'second']
    })

    await store.updateProviderSecrets('tavily', { preserveExisting: true })
    await expect(store.getProviderSecrets('tavily')).resolves.toEqual({
      apiKeys: ['first', 'second']
    })

    await store.updateProviderSecrets('tavily', { apiKeys: [] })
    await expect(store.getProviderSecrets('tavily')).resolves.toEqual({
      apiKeys: []
    })

    await store.clearProviderSecrets('tavily')
    await expect(store.toSafeView('tavily')).resolves.toEqual({
      hasApiKey: false,
      apiKeyPreview: '',
      apiKeyLength: 0,
      hasBasicAuth: false
    })
    expect(writes.length).toBeGreaterThan(0)
  })

  it('reveals only the first non-empty key on demand, or null when absent', async () => {
    const store = createWebSearchCredentialStore()

    await expect(store.getProviderApiKey('tavily')).resolves.toBeNull()
    await store.updateProviderSecrets('tavily', { apiKeys: ['', '  tvly-secret-1234567890  '] })
    await expect(store.getProviderApiKey('tavily')).resolves.toBe('tvly-secret-1234567890')
  })
})
