import type { MacroCalendarScheduleDraft } from '../parsers/verifiedScheduleParserContracts'

export type ManualBlsIcsScheduleDraft = MacroCalendarScheduleDraft

export type ManualBlsIcsParserResult =
  | { state: 'parsed'; totalEvents: number; supportedReleaseGroups: number; generatedEvents: number; unsupportedEvents: number; drafts: ManualBlsIcsScheduleDraft[] }
  | { state: 'failed'; failureCode: 'invalid-file' | 'unsupported-calendar' | 'no-supported-events' }

export const manualBlsIcsParserPolicy = {
  descriptorId: 'macro-calendar-bls-ics-manual',
  maximumBodyBytes: 128 * 1024,
  maximumCalendarEvents: 500,
  legacyTimeZone: 'US-Eastern',
  parserTimeZone: 'America/New_York',
  calendarHeaders: {
    version: '2.0',
    productId: '-//Department of Labor//Bureau of Labor Statistics//EN',
    calendarName: 'BLS.gov Economic News Release Schedule'
  },
  timeZoneTransitions: {
    daylight: {
      offsetFrom: '-0500', offsetTo: '-0400', startsAt: '20070311T020000',
      recurrence: 'FREQ=YEARLY;BYMONTH=3;BYDAY=2SU', name: 'EDT'
    },
    standard: {
      offsetFrom: '-0400', offsetTo: '-0500', startsAt: '20071104T020000',
      recurrence: 'FREQ=YEARLY;BYMONTH=11;BYDAY=1SU', name: 'EST'
    }
  },
  uuidPattern: /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  localDateTimePattern: /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})$/,
  titleMappings: {
    'Consumer Price Index': [
      { eventKeyPrefix: 'US.CPI.RELEASE', eventFamily: 'consumer-price-index', eventNameKey: 'cpi' },
      { eventKeyPrefix: 'US.CORE_CPI.RELEASE', eventFamily: 'consumer-price-index', eventNameKey: 'core-cpi' }
    ],
    'Employment Situation': [
      { eventKeyPrefix: 'US.NONFARM_PAYROLLS.RELEASE', eventFamily: 'employment-situation', eventNameKey: 'nonfarm-payrolls' },
      { eventKeyPrefix: 'US.UNEMPLOYMENT.RELEASE', eventFamily: 'employment-situation', eventNameKey: 'unemployment' },
      { eventKeyPrefix: 'US.AVERAGE_HOURLY_EARNINGS.RELEASE', eventFamily: 'employment-situation', eventNameKey: 'average-hourly-earnings' }
    ]
  },
  caveats: ['official-period-not-published-in-ics', 'manual-ics-import']
} as const
