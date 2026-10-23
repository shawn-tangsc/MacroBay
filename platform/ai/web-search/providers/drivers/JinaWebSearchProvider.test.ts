import { describe, expect, it } from 'vitest'

import { createJinaWebSearchProvider } from './JinaWebSearchProvider'

describe('Jina web search provider', () => {
  it('maps Jina search JSON results into the platform response shape and sends the API key', async () => {
    const driver = createJinaWebSearchProvider()
    const requests: Array<{ url: string; init?: RequestInit }> = []
    const fetch = async (url: RequestInfo | URL, init?: RequestInit) => {
      requests.push({ url: String(url), init })
      return Response.json({
        data: [
          {
            title: 'Jina Result',
            url: 'https://example.com/jina',
            content: 'Jina snippet'
          }
        ]
      })
    }

    await expect(
      driver.searchKeywords?.('reader search', {
        providerId: 'jina',
        capability: 'searchKeywords',
        apiHost: 'https://s.jina.ai',
        secrets: { apiKeys: ['jina-key'] },
        maxResults: 5,
        searchWithDate: false,
        fetch: fetch as typeof globalThis.fetch
      })
    ).resolves.toMatchObject({
      query: 'reader search',
      providerId: 'jina',
      results: [
        {
          title: 'Jina Result',
          url: 'https://example.com/jina',
          content: 'Jina snippet',
          sourceInput: 'reader search'
        }
      ]
    })
    expect(requests[0].url).toBe('https://s.jina.ai/?q=reader+search')
    expect((requests[0].init?.headers as Record<string, string>).authorization).toBe('Bearer jina-key')
    expect((requests[0].init?.headers as Record<string, string>).accept).toBe('application/json')
  })

  it('fails closed without an API key and never calls Jina', async () => {
    const driver = createJinaWebSearchProvider()
    let called = false
    const fetch = async () => {
      called = true
      return Response.json({ data: [] })
    }

    await expect(
      driver.searchKeywords?.('docs', {
        providerId: 'jina',
        capability: 'searchKeywords',
        apiHost: 'https://s.jina.ai',
        secrets: {},
        maxResults: 5,
        searchWithDate: false,
        fetch: fetch as typeof globalThis.fetch
      })
    ).rejects.toMatchObject({ code: 'missing_api_key' })
    expect(called).toBe(false)
  })

  it('maps non-JSON search responses to provider_response_invalid without leaking SyntaxError', async () => {
    const driver = createJinaWebSearchProvider()
    const fetch = async () => new Response('Title: x\nURL Source: https://example.com')

    await expect(
      driver.searchKeywords?.('docs', {
        providerId: 'jina',
        capability: 'searchKeywords',
        apiHost: 'https://s.jina.ai',
        secrets: { apiKeys: ['jina-key'] },
        maxResults: 5,
        searchWithDate: false,
        fetch: fetch as typeof globalThis.fetch
      })
    ).rejects.toMatchObject({ code: 'provider_response_invalid' })
    await expect(
      driver.searchKeywords?.('docs', {
        providerId: 'jina',
        capability: 'searchKeywords',
        apiHost: 'https://s.jina.ai',
        secrets: { apiKeys: ['jina-key'] },
        maxResults: 5,
        searchWithDate: false,
        fetch: fetch as typeof globalThis.fetch
      })
    ).rejects.not.toMatchObject({ message: expect.stringContaining('Unexpected non-whitespace') })
  })

  it('maps 401 responses to provider_unauthorized with the status', async () => {
    const driver = createJinaWebSearchProvider()
    const fetch = async () => new Response('unauthorized', { status: 401 })

    await expect(
      driver.searchKeywords?.('docs', {
        providerId: 'jina',
        capability: 'searchKeywords',
        apiHost: 'https://s.jina.ai',
        secrets: { apiKeys: ['jina-key'] },
        maxResults: 5,
        searchWithDate: false,
        fetch: fetch as typeof globalThis.fetch
      })
    ).rejects.toMatchObject({ code: 'provider_unauthorized', status: 401 })
  })

  it('maps Jina readable text fetch into one result', async () => {
    const driver = createJinaWebSearchProvider()
    const fetch = async () =>
      new Response('Title: Example Title\nURL Source: https://example.com/article\nMarkdown Content:\nReadable content here')

    await expect(
      driver.fetchUrls?.('https://example.com/article', {
        providerId: 'jina',
        capability: 'fetchUrls',
        apiHost: 'https://r.jina.ai',
        secrets: { apiKeys: ['jina-key'] },
        maxResults: 5,
        searchWithDate: false,
        fetch: fetch as typeof globalThis.fetch
      })
    ).resolves.toMatchObject({
      providerId: 'jina',
      capability: 'fetchUrls',
      inputs: ['https://example.com/article'],
      results: [
        {
          title: 'Example Title',
          url: 'https://example.com/article',
          content: 'Readable content here',
          sourceInput: 'https://example.com/article'
        }
      ]
    })
  })

  it('rejects unsafe readable fetch URLs before calling Jina', async () => {
    const driver = createJinaWebSearchProvider()
    let called = false
    const fetch = async () => {
      called = true
      return new Response('never')
    }

    await expect(
      driver.fetchUrls?.('http://127.0.0.1/private', {
        providerId: 'jina',
        capability: 'fetchUrls',
        apiHost: 'https://r.jina.ai',
        secrets: { apiKeys: ['jina-key'] },
        maxResults: 5,
        searchWithDate: false,
        fetch: fetch as typeof globalThis.fetch
      })
    ).rejects.toMatchObject({ code: 'unsafe_url' })
    expect(called).toBe(false)
  })
})
