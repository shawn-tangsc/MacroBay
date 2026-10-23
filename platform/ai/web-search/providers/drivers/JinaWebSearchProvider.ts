import type { WebSearchProviderDriver } from '../WebSearchProviderDriver'
import { createProviderHttpStatusError, createWebSearchError } from '../../runtime/webSearchErrors'
import { validateWebFetchUrl } from '../../runtime/webSearchUrlSafety'

export function createJinaWebSearchProvider(): WebSearchProviderDriver {
  return {
    providerId: 'jina',
    async searchKeywords(keyword, config, signal) {
      const apiKey = config.secrets.apiKeys?.find((value) => value.trim())
      if (!apiKey) {
        throw createWebSearchError('missing_api_key', 'Jina API key is required.')
      }
      const url = new URL(config.apiHost)
      url.searchParams.set('q', keyword)
      const response = await config.fetch(url, {
        signal,
        headers: { authorization: `Bearer ${apiKey}`, accept: 'application/json' }
      })
      if (!response.ok) {
        throw createProviderHttpStatusError('Jina', response.status)
      }
      let json: { data?: Array<{ title?: string; url?: string; content?: string }> }
      try {
        json = (await response.json()) as typeof json
      } catch (error) {
        // 原始解析异常只作为 cause 保留；UI 只看到可读的 provider_response_invalid。
        throw createWebSearchError(
          'provider_response_invalid',
          'Jina search returned a non-JSON response.',
          error
        )
      }
      if (!Array.isArray(json.data)) {
        throw createWebSearchError('provider_response_invalid', 'Jina search returned an invalid response.')
      }

      return {
        query: keyword,
        providerId: 'jina',
        capability: 'searchKeywords',
        inputs: [keyword],
        results: json.data.slice(0, config.maxResults).flatMap((result) => {
          if (!result.title || !result.url || !result.content) return []
          return [
            {
              title: result.title,
              url: result.url,
              content: result.content,
              sourceInput: keyword
            }
          ]
        })
      }
    },
    async fetchUrls(url, config, signal) {
      const safety = validateWebFetchUrl(url)
      if (!safety.ok) {
        throw createWebSearchError(safety.code, safety.message)
      }

      const apiKey = config.secrets.apiKeys?.find((value) => value.trim())
      if (!apiKey) {
        throw createWebSearchError('missing_api_key', 'Jina API key is required.')
      }
      const encodedUrl = `${config.apiHost}/${safety.url.toString()}`
      const response = await config.fetch(encodedUrl, { signal, headers: { authorization: `Bearer ${apiKey}` } })
      if (!response.ok) {
        throw createProviderHttpStatusError('Jina', response.status)
      }
      const text = await response.text()
      const parsed = parseJinaReadableText(text, url)
      return {
        providerId: 'jina',
        capability: 'fetchUrls',
        inputs: [url],
        results: [parsed]
      }
    }
  }
}

function parseJinaReadableText(text: string, sourceUrl: string) {
  const titleMatch = text.match(/^Title:\s*(.+)$/m)
  const sourceMatch = text.match(/^URL Source:\s*(.+)$/m)
  const contentMatch = text.match(/Markdown Content:\s*([\s\S]*)$/m)
  return {
    title: titleMatch?.[1]?.trim() || sourceUrl,
    url: sourceMatch?.[1]?.trim() || sourceUrl,
    content: contentMatch?.[1]?.trim() || text.trim(),
    sourceInput: sourceUrl
  }
}
