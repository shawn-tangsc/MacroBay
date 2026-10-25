import { describe, expect, it, vi } from 'vitest'

import { httpRequest } from '@platform/jobs'

import { applySourceCredential, createIntelligenceFetchText, executeIntelligenceFetchTarget } from './intelligenceHttpFetch'

vi.mock('@platform/jobs', async () => {
  const actual = await vi.importActual<typeof import('@platform/jobs')>('@platform/jobs')
  return {
    ...actual,
    httpRequest: vi.fn()
  }
})

const mockedHttpRequest = vi.mocked(httpRequest)

describe('createIntelligenceFetchText', () => {
  it('uses the platform http client and rejects empty bodies', async () => {
    mockedHttpRequest.mockResolvedValueOnce({
      status: 200,
      bodyText: '<rss></rss>'
    })

    const fetchText = createIntelligenceFetchText({
      profileStore: {
        resolveProfile: async () => ({
          profileId: 'profile-1',
          sourceId: 'coindesk-rss',
          enabled: true,
          collectionPreset: 'balanced',
          includeInSentiment: true,
          scopePolicy: 'watchlist-priority',
          rawArchiveEnabled: false,
          retentionMode: 'balanced',
          autoReplayAfterParserUpgrade: false,
          updatedAt: '2026-07-05T10:00:00.000Z'
        })
      }
    })

    await expect(fetchText('https://example.com/feed.xml', 'coindesk-rss')).resolves.toBe('<rss></rss>')
    expect(mockedHttpRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'https://example.com/feed.xml',
        method: 'GET',
        timeoutMs: 30_000
      }),
      expect.objectContaining({
        retryPolicy: expect.objectContaining({ maxAttempts: 3 })
      })
    )
  })

  it('declares a contact in the default user agent', async () => {
    mockedHttpRequest.mockResolvedValueOnce({ status: 200, bodyText: 'ok' })
    const fetchText = createIntelligenceFetchText({
      profileStore: {
        resolveProfile: async () => ({
          profileId: 'profile-1',
          sourceId: 'coindesk-rss',
          enabled: true,
          collectionPreset: 'balanced',
          includeInSentiment: true,
          scopePolicy: 'watchlist-priority',
          rawArchiveEnabled: false,
          retentionMode: 'balanced',
          autoReplayAfterParserUpgrade: false,
          updatedAt: '2026-07-05T10:00:00.000Z'
        })
      }
    })

    await fetchText('https://example.com/feed.xml', 'coindesk-rss')
    const request = mockedHttpRequest.mock.calls.at(-1)?.[0]
    expect(request?.headers?.['User-Agent']).toMatch(/\+https?:\/\//)
  })

  it('throws when the provider returns an error status', async () => {
    mockedHttpRequest.mockResolvedValueOnce({
      status: 503,
      bodyText: 'unavailable'
    })

    const fetchText = createIntelligenceFetchText({
      profileStore: {
        resolveProfile: async () => ({
          profileId: 'profile-1',
          sourceId: 'coindesk-rss',
          enabled: true,
          collectionPreset: 'balanced',
          includeInSentiment: true,
          scopePolicy: 'watchlist-priority',
          rawArchiveEnabled: false,
          retentionMode: 'balanced',
          autoReplayAfterParserUpgrade: false,
          updatedAt: '2026-07-05T10:00:00.000Z'
        })
      }
    })

    await expect(fetchText('https://example.com/feed.xml', 'coindesk-rss')).rejects.toThrow('HTTP 503')
  })
})

describe('applySourceCredential', () => {
  it('appends api_key for fred-rates-liquidity', () => {
    const applied = applySourceCredential({
      sourceId: 'fred-rates-liquidity',
      apiKey: 'fred-key',
      url: 'https://api.stlouisfed.org/fred/series/observations?series_id=DGS2&file_type=json'
    })
    expect(applied.url).toContain('api_key=fred-key')
  })

  it('appends UserID for bea-economic-series', () => {
    const applied = applySourceCredential({
      sourceId: 'bea-economic-series',
      apiKey: 'bea-user',
      url: 'https://apps.bea.gov/api/data/?method=GetData'
    })
    expect(applied.url).toContain('UserID=bea-user')
  })

  it('injects registrationkey into BLS POST body when configured', () => {
    const applied = applySourceCredential({
      sourceId: 'bls-economic-series',
      apiKey: 'bls-key',
      url: 'https://api.bls.gov/publicAPI/v2/timeseries/data/',
      method: 'POST',
      body: JSON.stringify({ seriesid: ['CUSR0000SA0'] })
    })
    expect(JSON.parse(applied.body ?? '{}')).toMatchObject({
      seriesid: ['CUSR0000SA0'],
      registrationkey: 'bls-key'
    })
  })

  it('does not use legacy fred credential handling', () => {
    const applied = applySourceCredential({
      sourceId: 'fred',
      apiKey: 'legacy-key',
      url: 'https://api.stlouisfed.org/fred/series/observations?series_id=DGS2'
    })
    expect(applied.url).not.toContain('api_key=legacy-key')
  })
})

describe('executeIntelligenceFetchTarget', () => {
  it('executes POST macro targets with JSON body', async () => {
    mockedHttpRequest.mockResolvedValueOnce({ status: 200, bodyText: '{"Results":{}}' })

    await executeIntelligenceFetchTarget(
      {
        url: 'https://api.bls.gov/publicAPI/v2/timeseries/data/',
        method: 'POST',
        body: JSON.stringify({ seriesid: ['CUSR0000SA0'] }),
        headers: { 'Content-Type': 'application/json' }
      },
      'bls-economic-series',
      {
        profileStore: {
          resolveProfile: async () => ({
            profileId: 'profile-1',
            sourceId: 'bls-economic-series',
            enabled: true,
            collectionPreset: 'balanced',
            includeInSentiment: true,
            scopePolicy: 'all',
            rawArchiveEnabled: true,
            retentionMode: 'balanced',
            autoReplayAfterParserUpgrade: true,
            updatedAt: '2026-07-05T10:00:00.000Z'
          })
        }
      }
    )

    expect(mockedHttpRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('CUSR0000SA0')
      }),
      expect.any(Object)
    )
  })
})
