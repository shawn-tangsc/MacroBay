import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { getMacroCalendarOfficialSourceDescriptor } from '../macroCalendarOfficialSourceRegistry'
import { parseFedFomcStatementHistory } from './fedFomcStatementHistoryParser'

const descriptor = getMacroCalendarOfficialSourceDescriptor('macro-calendar-fed-statement-history')!
const body = readFileSync(join(process.cwd(), 'products/market-intelligence/service/intelligence/macro-calendar/fixtures/fed-fomc-schedule-2026-08-03.html'), 'utf8')
const rowsFixture = readFileSync(join(process.cwd(), 'products/market-intelligence/service/intelligence/macro-calendar/fed-statements/fixtures/fed-fomc-statement-history-2026.html'), 'utf8')

describe('parseFedFomcStatementHistory', () => {
  it('discovers exact official FOMC statement links from the official history rows only', () => {
    const statements = parseFedFomcStatementHistory({ descriptor, body })
    const dates = statements.filter((statement) => statement.decisionDate >= '2026-06-01').map((statement) => [statement.decisionDate, statement.officialStatementUrl])

    expect(dates).toEqual([
      ['2026-06-17', 'https://www.federalreserve.gov/newsevents/pressreleases/monetary20260617a.htm'],
      ['2026-07-29', 'https://www.federalreserve.gov/newsevents/pressreleases/monetary20260729a.htm']
    ])
    expect(JSON.stringify(statements)).not.toMatch(/minutes|implementation note|pdf|fomcpressconf/i)
  })

  it.each([
    ['a nonofficial link', rowsFixture.replace('/newsevents/pressreleases/monetary20260617a.htm', 'https://example.test/monetary20260617a.htm'), ['2026-07-29']],
    ['a missing statement', rowsFixture.replace('<strong>Statement:</strong>', '<strong>Minutes:</strong>'), ['2026-07-29']],
    ['a duplicate statement link', rowsFixture.replace('monetary20260617a.htm', 'monetary20260729a.htm'), []]
  ])('rejects prior discovery from a minimal frozen history fixture with %s', (_label, mutated, expectedDates) => {
    expect(parseFedFomcStatementHistory({ descriptor, body: mutated }).map((entry) => entry.decisionDate)).toEqual(expectedDates)
  })
})
