import { describe, expect, it } from 'vitest'

import { createTavilyWebSearchProvider } from './TavilyWebSearchProvider'

describe('Tavily web search provider', () => {
  it('maps search API results into the platform response shape', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = []
    const driver = createTavilyWebSearchProvider()
    const fetch = async (url: RequestInfo | URL, init?: RequestInit) => {
      requests.push({ url: String(url), init })
      return Response.json({
        results: [
          {
            title: 'Result One',
            url: 'https://example.com/one',
            content: 'Snippet one',
            score: 0.9,
            published_date: '2026-07-11'
          }
        ]
      })
    }

    const result = await driver.searchKeywords?.('current docs', {
      providerId: 'tavily',
      capability: 'searchKeywords',
      apiHost: 'https://api.tavily.com',
      secrets: { apiKeys: ['tvly-key'] },
      maxResults: 3,
      searchWithDate: true,
      fetch: fetch as typeof globalThis.fetch
    })

    expect(result).toEqual({
      query: 'current docs',
      providerId: 'tavily',
      capability: 'searchKeywords',
      inputs: ['current docs'],
      results: [
        {
          title: 'Result One',
          url: 'https://example.com/one',
          content: 'Snippet one',
          sourceInput: 'current docs',
          score: 0.9,
          publishedAt: '2026-07-11'
        }
      ]
    })
    expect(requests[0].url).toBe('https://api.tavily.com/search')
    expect(JSON.stringify(result)).not.toContain('tvly-key')
  })

  it('maps 401 responses to provider_unauthorized with the status', async () => {
    const driver = createTavilyWebSearchProvider()
    const fetch = async () => new Response('unauthorized', { status: 401 })

    await expect(
      driver.searchKeywords?.('docs', {
        providerId: 'tavily',
        capability: 'searchKeywords',
        apiHost: 'https://api.tavily.com',
        secrets: { apiKeys: ['tvly-key'] },
        maxResults: 3,
        searchWithDate: false,
        fetch: fetch as typeof globalThis.fetch
      })
    ).rejects.toMatchObject({ code: 'provider_unauthorized', status: 401 })
  })
})
