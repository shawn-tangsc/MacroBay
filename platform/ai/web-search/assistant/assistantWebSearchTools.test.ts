import { describe, expect, it, vi } from 'vitest'

import type { WebSearchResponse } from '../contracts/webSearchContracts'
import { createAssistantWebSearchToolService, toModelSources } from './assistantWebSearchTools'

describe('assistant web search tools', () => {
  it('maps web search responses into model-visible sources without secrets', async () => {
    const service = createAssistantWebSearchToolService({
      listProviderViews: vi.fn(),
      getSettings: vi.fn(),
      updateSettings: vi.fn(),
      updateProvider: vi.fn(),
      checkProvider: vi.fn(),
      revealProviderApiKey: vi.fn(),
      fetchUrls: vi.fn(),
      searchKeywords: vi.fn(async (): Promise<WebSearchResponse> => ({
        providerId: 'tavily',
        capability: 'searchKeywords',
        inputs: ['docs'],
        results: [{ title: 'Docs', url: 'https://example.com', content: 'hello', sourceInput: 'docs' }]
      }))
    })

    const result = await service.execute({ name: 'web_search', argumentsJson: JSON.stringify({ query: 'docs' }) })

    expect(result).toMatchObject({
      name: 'web_search',
      ok: true,
      output: [{ id: 1, title: 'Docs', url: 'https://example.com', content: 'hello' }]
    })
    expect(JSON.stringify(result)).not.toContain('apiKey')
  })

  it('returns a safe error note for malformed tool arguments', async () => {
    const service = createAssistantWebSearchToolService({
      listProviderViews: vi.fn(),
      getSettings: vi.fn(),
      updateSettings: vi.fn(),
      updateProvider: vi.fn(),
      checkProvider: vi.fn(),
      revealProviderApiKey: vi.fn(),
      fetchUrls: vi.fn(),
      searchKeywords: vi.fn()
    })

    const result = await service.execute({ name: 'web_fetch', argumentsJson: JSON.stringify({ urls: 'https://example.com' }) })

    expect(result.ok).toBe(false)
    expect(result.error).toContain('web_fetch requires')
  })

  it('keeps stable source ids for citation mapping', () => {
    expect(
      toModelSources([
        { title: 'A', url: 'https://a.example', content: 'a', sourceInput: 'q' },
        { title: 'B', url: 'https://b.example', content: 'b', sourceInput: 'q' }
      ])
    ).toEqual([
      { id: 1, title: 'A', url: 'https://a.example', content: 'a' },
      { id: 2, title: 'B', url: 'https://b.example', content: 'b' }
    ])
  })
})
