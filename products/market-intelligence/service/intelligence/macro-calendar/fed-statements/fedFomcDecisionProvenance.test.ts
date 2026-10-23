import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { fedFomcDecisionFixtureProvenance } from './fedFomcDecisionProvenance'

describe('fedFomcDecisionFixtureProvenance', () => {
  it('binds the raw RSS-derived official FOMC decision body to its captured bytes', () => {
    const body = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'fixtures', fedFomcDecisionFixtureProvenance.fixtureFile))

    expect(fedFomcDecisionFixtureProvenance).toEqual({
      canonicalUrl: 'https://www.federalreserve.gov/newsevents/pressreleases/monetary20260729a.htm',
      capturedAt: '2026-01-01T00:00:00.000Z',
      contentType: 'text/html',
      payloadBytes: 1141,
      sha256: 'c5f265609ae2e40c7044ae5d5c742a8379fab7d2eeee42787754e0a0dab81b0e',
      fixtureFile: 'fed-fomc-decision-2026-07-29.html',
      rssReleasedAt: '2026-07-29T18:00:00.000Z'
    })
    expect(body.byteLength).toBe(fedFomcDecisionFixtureProvenance.payloadBytes)
    expect(createHash('sha256').update(body).digest('hex')).toBe(fedFomcDecisionFixtureProvenance.sha256)
  })

  it('uses the one exact current decision URL in the accepted raw RSS fixture and no invented prior URL', () => {
    const rss = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'fed-press-feed-2026-08-03.xml'), 'utf8')
    const entries = [...rss.matchAll(/<item>[\s\S]*?<title>Federal Reserve issues FOMC statement<\/title>[\s\S]*?<link><!\[CDATA\[(https:\/\/www\.federalreserve\.gov\/[^\]]+)\]\]><\/link>[\s\S]*?<pubDate><!\[CDATA\[([^\]]+)\]\]><\/pubDate>[\s\S]*?<\/item>/g)]

    expect(entries).toHaveLength(1)
    expect(entries[0]!.slice(1)).toEqual([
      fedFomcDecisionFixtureProvenance.canonicalUrl,
      'Wed, 29 Jul 2026 18:00:00 GMT'
    ])
  })
})
