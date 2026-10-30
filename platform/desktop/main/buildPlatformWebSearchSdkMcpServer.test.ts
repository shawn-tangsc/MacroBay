import { describe, expect, it, vi } from 'vitest'

import type { WebSearchResponse } from '../../ai/web-search/contracts/webSearchContracts'
import { buildPlatformWebSearchSdkMcpServer, platformWebSearchMaxCalls } from './buildPlatformWebSearchSdkMcpServer'

type Handler = (args: Record<string, unknown>) => Promise<{ content: Array<{ type: 'text'; text: string }> }>

function fakeSdk() {
  let handler: Handler | undefined
  return {
    handler: () => handler!,
    module: {
      tool: (_name: string, _description: string, _schema: unknown, h: Handler) => {
        handler = h
        return { name: 'web_search' }
      },
      createSdkMcpServer: (input: { name: string }) => ({ server: input.name })
    }
  }
}

function response(results: WebSearchResponse['results']): WebSearchResponse {
  return {
    providerId: 'tavily',
    capability: 'searchKeywords',
    inputs: ['q'],
    results
  }
}

function parsed(result: { content: Array<{ type: 'text'; text: string }> }) {
  return JSON.parse(result.content[0]!.text) as Record<string, unknown>
}

describe('platform web_search MCP tool', () => {
  it('returns source-backed results and drops ones published after the edition cutoff', async () => {
    const sdk = fakeSdk()
    const search = vi.fn(async () => response([
      { title: 'before', url: 'https://a.test', content: 'a', sourceInput: 'a', publishedAt: '2026-10-30T00:00:00.000Z' },
      { title: 'after', url: 'https://b.test', content: 'b', sourceInput: 'b', publishedAt: '2026-10-31T00:00:00.000Z' },
      { title: 'undated', url: 'https://c.test', content: 'c', sourceInput: 'c' }
    ]))
    const built = await buildPlatformWebSearchSdkMcpServer({
      bridge: { search },
      loadSdkHelpers: async () => sdk.module as never
    })

    expect(built?.name).toBe('macrobay_web')
    const result = await sdk.handler()({ query: 'eth etf flows', asOf: '2026-10-30T12:00:00.000Z', maxResults: 99 })

    expect(search).toHaveBeenCalledWith({ query: 'eth etf flows', maxResults: 5 }, { signal: expect.any(AbortSignal) })
    expect(parsed(result)).toMatchObject({
      state: 'available',
      query: 'eth etf flows',
      asOf: '2026-10-30T12:00:00.000Z',
      providerId: 'tavily'
    })
    expect((parsed(result).results as Array<{ title: string }>).map((item) => item.title)).toEqual(['before', 'undated'])
  })

  it('caps one run at three searches and never calls the service beyond the budget', async () => {
    const sdk = fakeSdk()
    const search = vi.fn(async () => response([]))
    await buildPlatformWebSearchSdkMcpServer({
      bridge: { search },
      loadSdkHelpers: async () => sdk.module as never
    })

    for (let index = 0; index < platformWebSearchMaxCalls; index += 1) {
      expect(parsed(await sdk.handler()({ query: `q${index}` })).state).toBe('available')
    }
    expect(parsed(await sdk.handler()({ query: 'over budget' }))).toEqual({
      state: 'unavailable',
      reason: 'budget-exhausted'
    })
    expect(search).toHaveBeenCalledTimes(platformWebSearchMaxCalls)
  })

  it('fails closed when the platform search provider is not ready or the query is empty', async () => {
    const sdk = fakeSdk()
    const search = vi.fn(async () => response([]))
    await buildPlatformWebSearchSdkMcpServer({
      bridge: { search, isReady: async () => false },
      loadSdkHelpers: async () => sdk.module as never
    })

    expect(parsed(await sdk.handler()({ query: 'x' }))).toEqual({
      state: 'unavailable',
      reason: 'provider-not-ready'
    })
    expect(search).not.toHaveBeenCalled()
  })

  it('returns a typed failure instead of throwing when the search service rejects', async () => {
    const sdk = fakeSdk()
    await buildPlatformWebSearchSdkMcpServer({
      bridge: { search: async () => { throw new Error('boom') } },
      loadSdkHelpers: async () => sdk.module as never
    })

    expect(parsed(await sdk.handler()({ query: 'x' }))).toEqual({
      state: 'unavailable',
      reason: 'search-failed'
    })
  })
})
