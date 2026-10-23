import { readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { buildRssCanonicalDedupeKey } from '../application/revisionResolver'
import { parseRssFeedToRawRecords, parseRssItems, rssPollerAdapter } from './rssPoller'

describe('rssPollerAdapter', () => {
  it('identifies rss items by guid, then link, then title plus published bucket', () => {
    expect(buildRssCanonicalDedupeKey({ guid: 'abc', title: 'A', publishedAt: '2026-07-05T10:00:00.000Z' })).toBe(
      'rss:guid:abc'
    )
    expect(buildRssCanonicalDedupeKey({ link: 'https://example.test/a', title: 'A' })).toBe(
      'rss:link:https://example.test/a'
    )
    expect(
      buildRssCanonicalDedupeKey({ title: 'Headline', publishedAt: '2026-07-05T10:00:00.000Z' })
    ).toContain('rss:title:2026-07-05')
  })

  it('returns raw records before normalized items', () => {
    const fixture = loadFixture('rss-sample.xml')
    const rawRecords = parseRssFeedToRawRecords({
      config: { sourceId: 'coindesk-rss' },
      runId: 'run-1',
      xml: fixture
    })

    expect(rawRecords).toHaveLength(2)
    expect(rawRecords[0]?.payloadFormat).toBe('rss-item')
    expect(rawRecords[0]?.sourceDedupeKey).toContain('rss:guid:')
  })

  it('normalizes CDATA-wrapped pubDate values during raw record creation', () => {
    const xml = `<?xml version="1.0"?><rss><channel><item><title>Test</title><pubDate><![CDATA[Mon, 05 Jul 2026 10:00:00 GMT]]></pubDate><guid>guid-1</guid></item></channel></rss>`
    const rawRecords = parseRssFeedToRawRecords({
      config: { sourceId: 'coindesk-rss' },
      runId: 'run-1',
      xml
    })

    expect(rawRecords[0]?.publishedAt).toBe('2026-07-05T10:00:00.000Z')
    expect(rawRecords[0]?.publishedAtRaw).toBe('Mon, 05 Jul 2026 10:00:00 GMT')
  })

  it('parses rss fixture content', () => {
    const items = parseRssItems(loadFixture('rss-sample.xml'))
    const parsed = rssPollerAdapter.parseRawRecord({
      config: config(),
      rawRecord: {
        sourceId: 'coindesk-rss',
        runId: 'run-1',
        payloadFormat: 'rss-item',
        payloadRefType: 'inline',
        payloadBody: JSON.stringify(items[0]),
        payloadHash: 'hash',
        sourceDedupeKey: 'dedupe',
        parserVersion: 'rss-v1'
      }
    })

    expect(parsed.title).toContain('Bitcoin')
  })

  it('leaves invalid pubDate undefined instead of creating invalid visible time', () => {
    const xml = `<?xml version="1.0"?><rss><channel><item><title>Test</title><pubDate>not-a-date</pubDate><guid>guid-invalid</guid></item></channel></rss>`
    const rawRecords = parseRssFeedToRawRecords({
      config: { sourceId: 'sec-rss' },
      runId: 'run-1',
      xml
    })
    expect(rawRecords[0]?.publishedAt).toBeUndefined()
    expect(rawRecords[0]?.sourceUrl ?? rawRecords[0]?.externalId).toBeTruthy()
  })
})

function config() {
  return {
    sourceId: 'coindesk-rss',
    sourceName: 'CoinDesk RSS',
    sourceGroup: 'mainstream-news' as const,
    adapterType: 'rss-poller' as const,
    executionMode: 'polling' as const,
    enabled: true,
    category: 'mainstream-news' as const,
    trustLevel: 'medium' as const,
    language: 'en',
    collectionPreset: 'balanced' as const,
    desiredRuntimeState: 'polling' as const,
    parserStrategy: 'rss-v1',
    noisePolicy: 'balanced' as const,
    includeInSentiment: true,
    scopePolicy: 'watchlist-priority' as const,
    rawArchiveEnabled: true,
    retentionMode: 'balanced' as const,
    autoReplayAfterParserUpgrade: true,
    sentimentEligible: true,
    adapterConfig: {}
  }
}

function loadFixture(name: string): string {
  return readFileSync(path.join(__dirname, 'fixtures', name), 'utf8')
}
