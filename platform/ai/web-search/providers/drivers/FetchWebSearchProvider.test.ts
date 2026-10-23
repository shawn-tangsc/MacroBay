import { describe, expect, it } from 'vitest'

import { createFetchWebSearchProvider } from './FetchWebSearchProvider'

describe('Fetch web search provider', () => {
  it('fetches safe HTML URLs and extracts readable text', async () => {
    const driver = createFetchWebSearchProvider()
    const fetch = async () =>
      new Response('<html><head><title>Page Title</title></head><body><h1>Hello</h1><script>ignore()</script><p>World</p></body></html>', {
        headers: { 'content-type': 'text/html; charset=utf-8' }
      })

    await expect(
      driver.fetchUrls?.('https://example.com/page', {
        providerId: 'fetch',
        capability: 'fetchUrls',
        apiHost: '',
        secrets: {},
        maxResults: 5,
        searchWithDate: false,
        fetch: fetch as typeof globalThis.fetch
      })
    ).resolves.toMatchObject({
      providerId: 'fetch',
      results: [
        {
          title: 'Page Title',
          url: 'https://example.com/page',
          content: 'Hello World',
          sourceInput: 'https://example.com/page'
        }
      ]
    })
  })

  it('rejects unsafe URLs before fetch is called', async () => {
    const driver = createFetchWebSearchProvider()
    let called = false
    const fetch = async () => {
      called = true
      return new Response('never')
    }

    await expect(
      driver.fetchUrls?.('http://127.0.0.1/private', {
        providerId: 'fetch',
        capability: 'fetchUrls',
        apiHost: '',
        secrets: {},
        maxResults: 5,
        searchWithDate: false,
        fetch: fetch as typeof globalThis.fetch
      })
    ).rejects.toMatchObject({ code: 'unsafe_url' })
    expect(called).toBe(false)
  })

  it('rejects unsafe redirect targets before following them', async () => {
    const driver = createFetchWebSearchProvider()
    const calls: Array<{ url: string; redirect?: RequestRedirect }> = []
    const fetch = async (url: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(url), redirect: init?.redirect })
      return new Response(null, {
        status: 302,
        headers: { location: 'http://127.0.0.1/private' }
      })
    }

    await expect(
      driver.fetchUrls?.('https://example.com/redirect', {
        providerId: 'fetch',
        capability: 'fetchUrls',
        apiHost: '',
        secrets: {},
        maxResults: 5,
        searchWithDate: false,
        fetch: fetch as typeof globalThis.fetch
      })
    ).rejects.toMatchObject({ code: 'unsafe_url' })
    expect(calls).toEqual([{ url: 'https://example.com/redirect', redirect: 'manual' }])
  })
})
