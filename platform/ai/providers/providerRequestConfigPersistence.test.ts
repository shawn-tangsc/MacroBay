import { describe, expect, it } from 'vitest'

import type { ModelProvider } from './modelProviderTypes'
import { normalizeProviderState, toSafeProvider } from './providerStore'

function provider(overrides: Partial<ModelProvider> = {}): ModelProvider {
  return {
    id: 'custom',
    name: 'Custom',
    endpoints: [
      { protocol: 'chat-completions', baseUrl: 'https://example.com' }
    ],
    enabled: true,
    baseUrl: 'https://example.com',
    models: [],
    ...overrides
  }
}

describe('PLAT-62 provider request configuration persistence', () => {
  it('round-trips chat endpoints, image endpoints and custom headers', () => {
    const state = normalizeProviderState({
      providers: [provider({
        endpoints: [
          { protocol: 'chat-completions', baseUrl: 'https://example.com' },
          { protocol: 'responses', baseUrl: 'https://responses.example.com' },
          { protocol: 'messages', baseUrl: 'https://anthropic.example.com' }
        ],
        imageEndpoints: { generation: 'https://image.example.com' },
        customHeaders: [{ name: 'X-Test', value: 'super-secret-header' }]
      })]
    })

    // 端点只有一份事实源：`endpoints`（顺序即优先级）+ `imageEndpoints`。
    expect(state.providers[0].endpoints).toEqual([
      { protocol: 'chat-completions', baseUrl: 'https://example.com' },
      { protocol: 'responses', baseUrl: 'https://responses.example.com' },
      { protocol: 'messages', baseUrl: 'https://anthropic.example.com' }
    ])
    expect(state.providers[0].imageEndpoints).toEqual({ generation: 'https://image.example.com' })
    expect(state.providers[0].customHeaders).toEqual([{ name: 'X-Test', value: 'super-secret-header' }])
  })

  it('masks custom header values in the safe view and never leaks plaintext', () => {
    const safe = toSafeProvider(provider({
      customHeaders: [{ name: 'X-Test', value: 'super-secret-header' }]
    }))
    expect(safe.customHeaders).toEqual([{ name: 'X-Test', value: '••••', hasValue: true }])
    expect(JSON.stringify(safe)).not.toContain('super-secret-header')
  })
})
