import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { parseManualBlsIcs } from './blsManualIcsParser'

const fixture = () => readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'bls-release-schedule.ics'), 'utf8')

describe('parseManualBlsIcs', () => {
  it('maps an exact Consumer Price Index release into CPI and core CPI schedule drafts', () => {
    const result = parseManualBlsIcs(calendarWithEvent({
      uid: '11111111-1111-4111-8111-111111111111',
      summary: 'Consumer Price Index',
      startsAt: '20250715T083000'
    }))

    expect(result).toMatchObject({
      state: 'parsed',
      totalEvents: 1,
      supportedReleaseGroups: 1,
      generatedEvents: 2,
      unsupportedEvents: 0,
      drafts: [
        expect.objectContaining({
          eventKey: 'US.CPI.RELEASE.11111111-1111-4111-8111-111111111111',
          releaseGroupKey: 'US.BLS.RELEASE.11111111-1111-4111-8111-111111111111',
          eventFamily: 'consumer-price-index',
          eventNameKey: 'cpi',
          periodKey: 'release-2025-07-15',
          scheduledDate: '2025-07-15',
          scheduledAt: '2025-07-15T12:30:00.000Z'
        }),
        expect.objectContaining({
          eventKey: 'US.CORE_CPI.RELEASE.11111111-1111-4111-8111-111111111111',
          eventFamily: 'consumer-price-index',
          eventNameKey: 'core-cpi'
        })
      ]
    })
  })

  it('parses the synthetic calendar with exact mapping counts and winter/summer instants', () => {
    const body = fixture()
    const result = parseManualBlsIcs(body)

    expect(result).toMatchObject({
      state: 'parsed', totalEvents: 313, supportedReleaseGroups: 46, generatedEvents: 115, unsupportedEvents: 267
    })
    expect(result.state === 'parsed' && result.drafts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        eventKey: 'US.CPI.RELEASE.00001000-0000-4000-8000-000000001000',
        scheduledDate: '2025-01-15', scheduledAt: '2025-01-15T13:30:00.000Z'
      }),
      expect.objectContaining({
        eventKey: 'US.CPI.RELEASE.00001001-0000-4000-8000-000000001001',
        scheduledDate: '2025-07-15', scheduledAt: '2025-07-15T12:30:00.000Z'
      }),
      expect.objectContaining({
        eventKey: 'US.AVERAGE_HOURLY_EARNINGS.RELEASE.00002000-0000-4000-8000-000000002000',
        eventFamily: 'employment-situation', eventNameKey: 'average-hourly-earnings'
      })
    ]))
  })

  it.each([
    ['wrong producer', (body: string) => body.replace('Bureau of Labor Statistics', 'Not BLS')],
    ['wrong calendar name', (body: string) => body.replace('BLS.gov Economic News Release Schedule', 'Other schedule')],
    ['wrong timezone', (body: string) => body.replaceAll('US-Eastern', 'America/Chicago')],
    ['invalid daylight-saving rule', (body: string) => body.replace('TZOFFSETTO:-0400', 'TZOFFSETTO:-0500')]
  ])('rejects an unsupported calendar %s', (_label, mutate) => {
    expect(parseManualBlsIcs(mutate(calendarWithEvent({
      uid: '11111111-1111-4111-8111-111111111111', summary: 'Consumer Price Index', startsAt: '20250715T083000'
    })))).toEqual({ state: 'failed', failureCode: 'unsupported-calendar' })
  })

  it('rejects content outside the calendar boundary', () => {
    const body = `X-UNTRUSTED:before-calendar\r\n${calendarWithEvent({
      uid: '11111111-1111-4111-8111-111111111111', summary: 'Consumer Price Index', startsAt: '20250715T083000'
    })}`

    expect(parseManualBlsIcs(body)).toEqual({ state: 'failed', failureCode: 'invalid-file' })
  })

  it.each([
    ['missing supported UID', (body: string) => body.replace('UID:11111111-1111-4111-8111-111111111111\r\n', '')],
    ['noncanonical supported UID', (body: string) => body.replace('11111111-1111-4111-8111-111111111111', 'not-a-uuid')],
    ['unsupported DTSTART timezone', (body: string) => body.replace('DTSTART;TZID=US-Eastern:', 'DTSTART;TZID=America/New_York:')],
    ['all-day supported DTSTART', (body: string) => body.replace('DTSTART;TZID=US-Eastern:20250715T083000', 'DTSTART;VALUE=DATE:20250715')]
  ])('rejects a malformed supported event: %s', (_label, mutate) => {
    expect(parseManualBlsIcs(mutate(calendarWithEvent({
      uid: '11111111-1111-4111-8111-111111111111', summary: 'Consumer Price Index', startsAt: '20250715T083000'
    })))).toEqual({ state: 'failed', failureCode: 'invalid-file' })
  })

  it('rejects duplicate UIDs before it accepts a partial supported schedule', () => {
    const first = event({ uid: '11111111-1111-4111-8111-111111111111', summary: 'Consumer Price Index', startsAt: '20250715T083000' })
    const duplicateUnsupported = event({ uid: '11111111-1111-4111-8111-111111111111', summary: 'Producer Price Index', startsAt: '20250716T083000' })

    expect(parseManualBlsIcs(calendar([first, duplicateUnsupported]))).toEqual({ state: 'failed', failureCode: 'invalid-file' })
  })

  it('returns no-supported-events for a structurally valid BLS calendar outside the exact title map', () => {
    expect(parseManualBlsIcs(calendar([event({
      uid: '11111111-1111-4111-8111-111111111111', summary: 'Producer Price Index', startsAt: '20250715T083000'
    })]))).toEqual({ state: 'failed', failureCode: 'no-supported-events' })
  })

  it('ignores a valid unsupported event without a UID', () => {
    const unsupported = event({
      uid: '11111111-1111-4111-8111-111111111111', summary: 'Producer Price Index', startsAt: '20250715T083000'
    }).replace('UID:11111111-1111-4111-8111-111111111111\r\n', '')

    expect(parseManualBlsIcs(calendar([unsupported]))).toEqual({ state: 'failed', failureCode: 'no-supported-events' })
  })

  it('rejects more than the manual file event limit', () => {
    const events = Array.from({ length: 501 }, (_, index) => event({
      uid: `11111111-1111-4111-8111-${String(index).padStart(12, '0')}`,
      summary: 'Producer Price Index', startsAt: '20250715T083000'
    }))

    expect(parseManualBlsIcs(calendar(events))).toEqual({ state: 'failed', failureCode: 'invalid-file' })
  })

  it('rejects a file above the manual UTF-8 byte limit', () => {
    const oversized = `${calendarWithEvent({
      uid: '11111111-1111-4111-8111-111111111111', summary: 'Consumer Price Index', startsAt: '20250715T083000'
    })}${'x'.repeat(128 * 1024)}`

    expect(parseManualBlsIcs(oversized)).toEqual({ state: 'failed', failureCode: 'invalid-file' })
  })
})

function calendarWithEvent(input: { uid: string; summary: string; startsAt: string }): string {
  return calendar([event(input)])
}

function calendar(events: readonly string[]): string {
  return [
    'BEGIN:VCALENDAR',
    'PRODID:-//Department of Labor//Bureau of Labor Statistics//EN',
    'VERSION:2.0',
    'X-WR-CALNAME:BLS.gov Economic News Release Schedule',
    'X-WR-TIMEZONE:US-Eastern',
    'BEGIN:VTIMEZONE',
    'TZID:US-Eastern',
    'BEGIN:DAYLIGHT',
    'TZOFFSETFROM:-0500',
    'TZOFFSETTO:-0400',
    'DTSTART:20070311T020000',
    'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU',
    'TZNAME:EDT',
    'END:DAYLIGHT',
    'BEGIN:STANDARD',
    'TZOFFSETFROM:-0400',
    'TZOFFSETTO:-0500',
    'DTSTART:20071104T020000',
    'RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU',
    'TZNAME:EST',
    'END:STANDARD',
    'END:VTIMEZONE',
    ...events,
    'END:VCALENDAR',
    ''
  ].join('\r\n')
}

function event(input: { uid: string; summary: string; startsAt: string }): string {
  return [
    'BEGIN:VEVENT',
    `UID:${input.uid}`,
    `DTSTART;TZID=US-Eastern:${input.startsAt}`,
    `SUMMARY:${input.summary}`,
    'END:VEVENT'
  ].join('\r\n')
}
