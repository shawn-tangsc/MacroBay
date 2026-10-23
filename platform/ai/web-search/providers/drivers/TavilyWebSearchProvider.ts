import type { WebSearchProviderDriver } from '../WebSearchProviderDriver'
import { createProviderHttpStatusError, createWebSearchError } from '../../runtime/webSearchErrors'

export function createTavilyWebSearchProvider(): WebSearchProviderDriver {
  return {
    providerId: 'tavily',
    async searchKeywords(keyword, config, signal) {
      const apiKey = config.secrets.apiKeys?.find((value) => value.trim())
      if (!apiKey) {
        throw createWebSearchError('missing_api_key', 'Tavily API key is required.')
      }

      const response = await config.fetch(`${config.apiHost}/search`, {
        method: 'POST',
        signal,
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          query: keyword,
          max_results: config.maxResults,
          include_answer: false,
          search_depth: 'basic'
        })
      })
      if (!response.ok) {
        throw createProviderHttpStatusError('Tavily', response.status)
      }

      const json = (await response.json()) as {
        results?: Array<{
          title?: string
          url?: string
          content?: string
          score?: number
          published_date?: string
        }>
      }
      if (!Array.isArray(json.results)) {
        throw createWebSearchError('provider_response_invalid', 'Tavily returned an invalid response.')
      }

      return {
        query: keyword,
        providerId: 'tavily',
        capability: 'searchKeywords',
        inputs: [keyword],
        results: json.results.slice(0, config.maxResults).flatMap((result) => {
          if (!result.title || !result.url || !result.content) return []
          return [
            {
              title: result.title,
              url: result.url,
              content: result.content,
              sourceInput: keyword,
              score: result.score,
              publishedAt: result.published_date
            }
          ]
        })
      }
    }
  }
}
