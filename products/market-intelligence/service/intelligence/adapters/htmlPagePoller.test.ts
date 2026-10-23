import { readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it, vi } from 'vitest'

import { httpRequest } from '@platform/jobs'

import {
  binanceArticlesToRawRecords,
  buildBinanceListQueryUrl,
  parseBinanceArticleListResponse,
  parseBinanceArticlePayload
} from './binanceAnnouncementsParser'
import { htmlPagePollerAdapter } from './htmlPagePoller'

vi.mock('@platform/jobs', async () => {
  const actual = await vi.importActual<typeof import('@platform/jobs')>('@platform/jobs')
  return {
    ...actual,
    httpRequest: vi.fn()
  }
})

const mockedHttpRequest = vi.mocked(httpRequest)

describe('binanceAnnouncementsParser', () => {
  it('builds a list query url with optional catalog filters', () => {
    expect(
      buildBinanceListQueryUrl({
        sourceId: 'binance-announcements',
        adapterConfig: { pageSize: 15 }
      } as never)
    ).toContain('pageSize=15')

    expect(
      buildBinanceListQueryUrl({
        sourceId: 'binance-api-updates',
        adapterConfig: { catalogId: 51, pageSize: 10 }
      } as never)
    ).toContain('catalogId=51')
  })

  it('flattens catalog articles and dedupes by article code', () => {
    const fixture = loadFixture()
    const articles = parseBinanceArticleListResponse(fixture)
    expect(articles).toHaveLength(3)
    expect(articles.map((article) => article.code)).toEqual([
      'abc123def456',
      'def789ghi012',
      'api111222333'
    ])
  })

  it('maps articles to raw records with stable dedupe keys', () => {
    const articles = parseBinanceArticleListResponse(loadFixture())
    const records = binanceArticlesToRawRecords({
      config: {
        sourceId: 'binance-announcements',
        language: 'en',
        adapterConfig: {}
      } as never,
      runId: 'run-1',
      articles: [articles[0]!]
    })

    expect(records[0]?.sourceDedupeKey).toBe('binance:abc123def456')
    expect(records[0]?.sourceUrl).toContain('/en/support/announcement/abc123def456')
  })

  it('parses a single article payload into a normalized record draft', () => {
    const parsed = parseBinanceArticlePayload({
      code: 'abc123def456',
      title: 'Binance Will List Example Token (ABC)',
      releaseDate: 1717603200000,
      catalogName: 'New Cryptocurrency Listing'
    })

    expect(parsed.title).toContain('Example Token')
    expect(parsed.eventType).toBe('exchange-announcement')
    expect(parsed.publishedAt).toBeTruthy()
  })
})

describe('htmlPagePollerAdapter', () => {
  it('collects binance articles from the public cms api', async () => {
    mockedHttpRequest.mockResolvedValueOnce({
      status: 200,
      headers: {},
      bodyText: loadFixture(),
      byteSize: loadFixture().length
    })

    const records = await htmlPagePollerAdapter.collect({
      config: {
        sourceId: 'binance-announcements',
        language: 'en',
        adapterConfig: {
          pageUrl: 'https://www.binance.com/en/support/announcement',
          pageSize: 20
        }
      } as never,
      runId: 'run-1'
    })

    expect(records).toHaveLength(3)
    expect(records[0]?.sourceDedupeKey).toBe('binance:abc123def456')
    expect(mockedHttpRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          Referer: 'https://www.binance.com/en/support/announcement'
        })
      }),
      expect.any(Object)
    )
  })

  it('normalizes binance announcements into exchange announcement clusters', () => {
    const parsed = parseBinanceArticlePayload({
      code: 'abc123def456',
      title: 'Binance Will List Example Token (ABC)',
      releaseDate: 1717603200000
    })

    const normalized = htmlPagePollerAdapter.normalizeParsedItem({
      config: {
        sourceId: 'binance-announcements',
        category: 'exchange-announcement'
      } as never,
      parsed,
      rawRecordId: 'raw-1',
      detectedAt: '2026-07-05T10:00:00.000Z'
    })

    expect(normalized.clusterType).toBe('announcement')
    expect(normalized.canonicalDedupeKey).toBe('binance:abc123def456')
    expect(normalized.clusterKey).toContain('binance-announcements')
  })

  it('expands list fixtures into per-article raw records', () => {
    const articles = parseBinanceArticleListResponse(loadFixture())
    const records = binanceArticlesToRawRecords({
      config: {
        sourceId: 'binance-announcements',
        language: 'en',
        adapterConfig: {}
      } as never,
      runId: 'run-1',
      articles
    })

    expect(records).toHaveLength(3)
    expect(records[0]?.payloadBody).toContain('abc123def456')
  })

  it('parses stored binance article json payloads', () => {
    const article = parseBinanceArticleListResponse(loadFixture())[0]!
    const parsed = htmlPagePollerAdapter.parseRawRecord({
      config: { sourceId: 'binance-announcements' } as never,
      rawRecord: {
        sourceId: 'binance-announcements',
        runId: 'run-1',
        payloadFormat: 'json',
        payloadRefType: 'inline',
        payloadBody: JSON.stringify(article),
        payloadHash: 'hash',
        sourceDedupeKey: 'binance:abc123def456',
        parserVersion: 'binance-announcements-v1'
      }
    })

    expect(parsed.externalId).toBe('abc123def456')
    expect(parsed.title).toContain('Example Token')
  })
})

function loadFixture(): string {
  return readFileSync(path.join(__dirname, 'fixtures/binance-articles.json'), 'utf8')
}
