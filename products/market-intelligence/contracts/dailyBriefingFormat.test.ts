import { describe, expect, it } from 'vitest'

import { formatBriefingChange, formatBriefingValue } from './dailyBriefingFormat'

describe('daily briefing formatting', () => {
  it('formats scores, percentages, dollars, flows, yields and levels', () => {
    expect(formatBriefingValue({ number: 48.4, format: 'score' }, '—')).toBe('48')
    expect(formatBriefingValue({ number: -1.1, format: 'percent' }, '—')).toBe('-1.10%')
    expect(formatBriefingValue({ number: 1.1, format: 'percent' }, '—')).toBe('+1.10%')
    expect(formatBriefingValue({ number: 253_033_903_673.4, format: 'usd' }, '—', 'en-US')).toBe('253B USD')
    expect(formatBriefingValue({ number: 252_033_903_673.4, format: 'usd' }, '—', 'zh-CN')).toBe('252B USD')
    expect(formatBriefingValue({ number: 137_300_000, format: 'flow-usd' }, '—', 'zh-CN')).toBe('+137.3M USD')
    expect(formatBriefingValue({ number: 0.0036, format: 'percent' }, '—', 'zh-CN')).toBe('+0.0036%')
    expect(formatBriefingValue({ number: -0.0043, format: 'percent' }, '—', 'zh-CN')).toBe('-0.0043%')
    expect(formatBriefingValue({ number: 110_300_000, format: 'flow-usd' }, '—')).toBe('+110.3M USD')
    expect(formatBriefingValue({ number: 5, format: 'yield' }, '—')).toBe('5.00%')
    expect(formatBriefingValue({ number: 102.24, format: 'level' }, '—')).toBe('102.24')
    expect(formatBriefingValue(null, '—')).toBe('—')
  })

  it('prints a level with grouped thousands and no invented precision', () => {
    // 精度属于读数，不属于格式化器：一位的数不许印成两位，那是替数据多报一位。
    expect(formatBriefingValue({ number: 110_432.1, format: 'level' }, '—', 'en-US')).toBe('110,432.1')
    expect(formatBriefingValue({ number: 110_432.1, format: 'level' }, '—', 'zh-CN')).toBe('110,432.1')
    expect(formatBriefingValue({ number: 3_927.99, format: 'level' }, '—')).toBe('3,927.99')
    expect(formatBriefingValue({ number: 101.81, format: 'level' }, '—')).toBe('101.81')
    // 整数点位仍带一位小数：一位是"这是价格"的标记，不是多余的零。
    expect(formatBriefingValue({ number: 101, format: 'level' }, '—')).toBe('101.0')
    expect(formatBriefingValue({ number: 21_348.7, format: 'level' }, '—')).toBe('21,348.7')
  })

  it('formats pp, percent, bp and dollar changes', () => {
    expect(formatBriefingChange({ value: 0.000751, unit: 'pp' })).toBe('+0.0008pp')
    expect(formatBriefingChange({ value: -0.3324, unit: 'percent' })).toBe('-0.33%')
    expect(formatBriefingChange({ value: 4, unit: 'bp' })).toBe('+4bp')
    expect(formatBriefingChange({ value: -88_600_000, unit: 'usd' })).toBe('-88.6M USD')
    expect(formatBriefingChange(null)).toBe('')
  })
})
