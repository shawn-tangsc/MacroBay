import { readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  parseBinanceArticleListResponse,
  parseBinanceArticlePayload,
  selectRecentBinanceArticles
} from './binanceAnnouncementsParser'

describe('binanceAnnouncementsParser', () => {
  it('parses listing fixture articles', () => {
    const articles = parseBinanceArticleListResponse(loadFixture('binance-articles.json'))
    expect(articles.some((article) => /will list/i.test(article.title))).toBe(true)
    const parsed = parseBinanceArticlePayload(articles[0]!)
    expect(parsed.title).toContain('Will List')
  })

  it('parses delisting fixture articles', () => {
    const articles = parseBinanceArticleListResponse(loadFixture('binance-delisting-articles.json'))
    expect(articles.some((article) => /delist/i.test(article.title))).toBe(true)
  })

  it('parses API update fixture articles', () => {
    const articles = parseBinanceArticleListResponse(loadFixture('binance-articles.json'))
    const apiArticle = articles.find((article) => /api update/i.test(article.title))
    expect(apiArticle).toBeTruthy()
  })

  it('keeps only articles inside the freshness window', () => {
    const nowMs = Date.parse('2026-10-24T12:00:00.000Z')
    const day = 86_400_000
    const articles = [
      { code: 'recent', title: 'recent', releaseDate: nowMs - day },
      { code: 'old', title: 'old', releaseDate: nowMs - 8 * day },
      { code: 'undated', title: 'undated' }
    ]

    expect(selectRecentBinanceArticles(articles, { nowMs }).map((entry) => entry.code)).toEqual(['recent'])
    expect(selectRecentBinanceArticles(articles, { nowMs, maxAgeDays: 0 })).toHaveLength(3)
  })

  it('rejects unsupported payload shape', () => {
    expect(() => parseBinanceArticleListResponse('{"code":"999999","data":{}}')).toThrow()
  })
})

function loadFixture(name: string): string {
  return readFileSync(path.join(__dirname, 'fixtures', name), 'utf8')
}
