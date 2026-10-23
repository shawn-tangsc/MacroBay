import { describe, expect, it } from 'vitest'

import { createSearxngWebSearchProvider } from './SearxngWebSearchProvider'

describe('Searxng web search provider', () => {
  it('maps Searxng search results into the platform response shape', async () => {
    const driver = createSearxngWebSearchProvider()
    const fetch = async () =>
      Response.json({
        results: [
          {
            title: 'Searx Result',
            url: 'https://example.org/page',
            content: 'Searx snippet',
            score: 2
          }
        ]
      })

    await expect(
      driver.searchKeywords?.('open source search', {
        providerId: 'searxng',
        capability: 'searchKeywords',
        apiHost: 'http://localhost:8080',
        secrets: {},
        maxResults: 5,
        searchWithDate: false,
        fetch: fetch as typeof globalThis.fetch
      })
    ).resolves.toMatchObject({
      query: 'open source search',
      providerId: 'searxng',
      results: [
        {
          title: 'Searx Result',
          url: 'https://example.org/page',
          content: 'Searx snippet',
          sourceInput: 'open source search',
          score: 2
        }
      ]
    })
  })
})
