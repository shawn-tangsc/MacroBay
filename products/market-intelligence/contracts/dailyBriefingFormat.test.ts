import { describe, expect, it } from 'vitest'

import { formatBriefingChange, formatBriefingValue } from './dailyBriefingFormat'

describe('daily briefing formatting', () => {
  it('formats scores, percentages, dollars, flows, yields and levels', () => {
    expect(formatBriefingValue({ number: 48.4, format: 'score' }, '—')).toBe('48')
    expect(formatBriefingValue({ number: -1.1, format: 'percent' }, '—')).toBe('-1.10%')
    expect(formatBriefingValue({ number: 1.1, format: 'percent' }, '—')).toBe('+1.10%')
    expect(formatBriefingValue({ number: 253_033_903_673.4, format: 'usd' }, '—', 'en-US')).toBe('253B USD')
    expect(formatBriefingValue({ number: 110_300_000, format: 'flow-usd' }, '—')).toBe('+110.3M USD')
    expect(formatBriefingValue({ number: 5, format: 'yield' }, '—')).toBe('5.00%')
    expect(formatBriefingValue({ number: 102.24, format: 'level' }, '—')).toBe('102.24')
    expect(formatBriefingValue(null, '—')).toBe('—')
  })

  it('formats pp, percent, bp and dollar changes', () => {
    expect(formatBriefingChange({ value: 0.000751, unit: 'pp' })).toBe('+0.0008pp')
    expect(formatBriefingChange({ value: -0.3324, unit: 'percent' })).toBe('-0.33%')
    expect(formatBriefingChange({ value: 4, unit: 'bp' })).toBe('+4bp')
    expect(formatBriefingChange({ value: -88_600_000, unit: 'usd' })).toBe('-88.6M USD')
    expect(formatBriefingChange(null)).toBe('')
  })
})
