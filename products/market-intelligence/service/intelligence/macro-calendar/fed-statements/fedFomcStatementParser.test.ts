import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { getMacroCalendarOfficialSourceDescriptor } from '../macroCalendarOfficialSourceRegistry'
import { parseFedFomcStatements } from './fedFomcStatementParser'

const body = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'fed-press-feed-2026-08-03.xml'), 'utf8')
const descriptor = getMacroCalendarOfficialSourceDescriptor('macro-calendar-fed-statement')!

describe('parseFedFomcStatements', () => {
  it('parses the raw accepted Fed RSS fixture into statement release drafts only', () => {
    const drafts = parseFedFomcStatements({ body, descriptor })

    expect(drafts).toEqual([{
      statementId: 'fed-fomc-statement:2026-07-29T18:00:00.000Z:https://www.federalreserve.gov/newsevents/pressreleases/monetary20260729a.htm',
      releasedAt: '2026-07-29T18:00:00.000Z',
      officialStatementUrl: 'https://www.federalreserve.gov/newsevents/pressreleases/monetary20260729a.htm',
      providerId: 'macro-calendar-fed', descriptorId: 'macro-calendar-fed-statement', parserVersion: 'fed-fomc-statement-v1'
    }])
    expect(JSON.stringify(drafts)).not.toMatch(/description|target range|statement body/i)
  })

  it.each([
    body.replace('Federal Reserve issues FOMC statement', 'Federal Reserve issues a statement'),
    body.replace('<link><![CDATA[https://www.federalreserve.gov/newsevents/pressreleases/monetary20260729a.htm]]></link>', '<link></link>'),
    body.replace('Wed, 29 Jul 2026 18:00:00 GMT', 'not-an-rfc822-date')
  ])('rejects a changed or incomplete FOMC statement item', (mutated) => {
    expect(parseFedFomcStatements({ body: mutated, descriptor })).toEqual([])
  })

  it('rejects a duplicate statement link', () => {
    const item = body.match(/<item>[\s\S]*?Federal Reserve issues FOMC statement[\s\S]*?<\/item>/)?.[0]!
    const duplicateLink = item.replace('Wed, 29 Jul 2026 18:00:00 GMT', 'Thu, 30 Jul 2026 18:00:00 GMT')
    expect(parseFedFomcStatements({ body: body.replace('</channel>', `${duplicateLink}</channel>`), descriptor })).toEqual([])
  })

  it('rejects a duplicate statement publication instant', () => {
    const item = body.match(/<item>[\s\S]*?Federal Reserve issues FOMC statement[\s\S]*?<\/item>/)?.[0]!
    const duplicateInstant = item.replace('monetary20260729a.htm', 'monetary20260729b.htm')
    expect(parseFedFomcStatements({ body: body.replace('</channel>', `${duplicateInstant}</channel>`), descriptor })).toEqual([])
  })

  it('rejects a descriptor or provenance mismatch', () => {
    expect(parseFedFomcStatements({ body, descriptor: { ...descriptor, sourceUrl: 'https://example.test/feed.xml' } })).toEqual([])
    expect(parseFedFomcStatements({ body, descriptor: getMacroCalendarOfficialSourceDescriptor('macro-calendar-fed-schedule')! })).toEqual([])
  })

  it.each([
    'https://user:pass@www.federalreserve.gov/newsevents/pressreleases/monetary20260729a.htm',
    'https://www.federalreserve.gov/newsevents/pressreleases/monetary20260729a.htm#anything',
    'https://www.federalreserve.gov:444/newsevents/pressreleases/monetary20260729a.htm',
    'https://www.federalreserve.gov/newsevents/pressreleases/monetary20260729a.htm?source=rss',
    'https://www.federalreserve.gov/newsevents/pressreleases/monetary20260729a.htm?',
    'https://www.federalreserve.gov/newsevents/pressreleases/monetary20260729a.htm#'
  ])('rejects a noncanonical or credential-bearing official statement link: %s', (link) => {
    const mutated = body.replace('https://www.federalreserve.gov/newsevents/pressreleases/monetary20260729a.htm', link)
    expect(parseFedFomcStatements({ body: mutated, descriptor })).toEqual([])
  })
})
