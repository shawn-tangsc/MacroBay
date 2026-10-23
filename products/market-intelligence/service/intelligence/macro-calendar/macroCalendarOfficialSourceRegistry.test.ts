import { describe, expect, it } from 'vitest'

import {
  getMacroCalendarOfficialSourceDescriptor,
  macroCalendarOfficialSourceRegistry
} from './macroCalendarOfficialSourceRegistry'

describe('macroCalendarOfficialSourceRegistry', () => {
  it('contains the fixed public BEA RSS descriptor and no Calendar BEA API value descriptor', () => {
    expect(macroCalendarOfficialSourceRegistry.map((descriptor) => descriptor.descriptorId)).toEqual([
      'macro-calendar-fed-schedule',
      'macro-calendar-fed-statement',
      'macro-calendar-fed-statement-history',
      'macro-calendar-bls-schedule',
      'macro-calendar-bls-values',
      'macro-calendar-bls-ics-manual',
      'macro-calendar-bea-schedule',
      'macro-calendar-bea-release-rss'
    ])
    expect(new Set(macroCalendarOfficialSourceRegistry.map((descriptor) => descriptor.providerId))).toEqual(new Set([
      'macro-calendar-fed',
      'macro-calendar-bls',
      'macro-calendar-bea'
    ]))
    expect(macroCalendarOfficialSourceRegistry).toEqual(expect.arrayContaining([
      expect.objectContaining({ descriptorId: 'macro-calendar-fed-schedule', authMode: 'none', pollEligibility: 'schedule', evidenceLabel: 'schedule-html' }),
      expect.objectContaining({ descriptorId: 'macro-calendar-fed-statement-history', sourceUrl: 'https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm', payloadFormat: 'html', parserId: 'fed-fomc-statement-history-v1', pollEligibility: 'release-window', evidenceLabel: 'statement-text' }),
      expect.objectContaining({ descriptorId: 'macro-calendar-bea-release-rss', sourceUrl: 'https://apps.bea.gov/rss/rss.xml', payloadFormat: 'text', parserId: 'bea-official-release-rss-v1', authMode: 'none', pollEligibility: 'release-window', evidenceLabel: 'official-release-rss', accessMode: 'http' }),
      expect.objectContaining({
        descriptorId: 'macro-calendar-bls-ics-manual', providerId: 'macro-calendar-bls',
        sourceUrl: 'https://www.bls.gov/schedule/news_release/bls.ics', payloadFormat: 'text',
        parserId: 'bls-manual-ics-v1', eventFamilies: ['consumer-price-index', 'employment-situation'],
        authMode: 'none', pollEligibility: 'schedule', evidenceLabel: 'manual-ics', accessMode: 'manual-upload'
      })
    ]))
    expect(getMacroCalendarOfficialSourceDescriptor('macro-calendar-bea-values')).toBeUndefined()
  })

  it('only resolves a descriptor from the fixed registry', () => {
    expect(getMacroCalendarOfficialSourceDescriptor('macro-calendar-fed-schedule')?.sourceUrl)
      .toBe('https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm')
    expect(getMacroCalendarOfficialSourceDescriptor('https://discovered.invalid/calendar')).toBeUndefined()
  })
})
