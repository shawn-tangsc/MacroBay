import type { WebSearchProviderDriver } from '../WebSearchProviderDriver'
import { createProviderHttpStatusError, createWebSearchError } from '../../runtime/webSearchErrors'

export function createSearxngWebSearchProvider(): WebSearchProviderDriver {
  return {
    providerId: 'searxng',
    async searchKeywords(keyword, config, signal) {
      const url = new URL('/search', `${config.apiHost}/`)
      url.searchParams.set('q', keyword)
      url.searchParams.set('format', 'json')
      if (config.engines?.length) {
        url.searchParams.set('engines', config.engines.join(','))
      }

      const headers: Record<string, string> = {}
      const password = config.secrets.basicAuthPassword?.trim()
      if (config.basicAuthUsername && password) {
        headers.authorization = `Basic ${Buffer.from(`${config.basicAuthUsername}:${password}`).toString('base64')}`
      }

      const response = await config.fetch(url, { signal, headers })
      if (!response.ok) {
        throw createProviderHttpStatusError('Searxng', response.status)
      }

      const json = (await response.json()) as {
        results?: Array<{
          title?: string
          url?: string
          content?: string
          score?: number
        }>
      }
      if (!Array.isArray(json.results)) {
        throw createWebSearchError('provider_response_invalid', 'Searxng returned an invalid response.')
      }

      return {
        query: keyword,
        providerId: 'searxng',
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
              score: result.score
            }
          ]
        })
      }
    }
  }
}
