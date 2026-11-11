import { describe, expect, it } from 'vitest'

import type { SafeModelProvider } from './modelProviderTypes'
import { isModelServiceConfigured } from './modelServiceReadiness'

function provider(overrides: Partial<SafeModelProvider> = {}): SafeModelProvider {
  return {
    id: 'silicon',
    name: 'Silicon',
    endpoints: [{ protocol: 'messages', baseUrl: 'https://silicon.example.test' }],
    enabled: true,
    baseUrl: 'https://silicon.example.test',
    hasApiKey: true,
    apiKeyPreview: 'sk-**********7890',
    models: [],
    isSystem: false,
    ...overrides
  } as unknown as SafeModelProvider
}

describe('isModelServiceConfigured', () => {
  it('reports configured when one provider has enabled, endpoint and API key', () => {
    expect(isModelServiceConfigured([provider()])).toBe(true)
  })

  it('reports unconfigured when no provider is ready, and never guesses', () => {
    expect(isModelServiceConfigured([])).toBe(false)
    expect(isModelServiceConfigured([provider({ hasApiKey: false })])).toBe(false)
    expect(isModelServiceConfigured([provider({ enabled: false })])).toBe(false)
    expect(isModelServiceConfigured([provider({ baseUrl: '  ' })])).toBe(false)
  })
})
