import { describe, expect, it } from 'vitest'

import {
  briefingDisplayNumbers,
  formatBriefingChangeDisplay,
  formatBriefingValueDisplay,
  formatPercentDisplay
} from './dailyBriefingFactDisplay'

describe('daily briefing fact display', () => {
  it('keeps percentages at two decimals and never exposes the raw precision', () => {
    expect(formatPercentDisplay(-0.834502697447248)).toBe('-0.83%')
    expect(formatPercentDisplay(1.2)).toBe('+1.20%')
    expect(formatPercentDisplay(-1.1)).toBe('-1.10%')
    expect(formatBriefingValueDisplay({ number: -0.834502697447248, format: 'percent' }, 'zh-CN')).toBe('-0.83%')
  })

  it('scales USD flows to 亿 in Chinese, preserving the sign and two decimals', () => {
    expect(formatBriefingValueDisplay({ number: -643_200_000, format: 'flow-usd' }, 'zh-CN')).toBe('-6.43 亿美元')
    expect(formatBriefingValueDisplay({ number: 643_200_000, format: 'flow-usd' }, 'zh-CN')).toBe('+6.43 亿美元')
    expect(formatBriefingValueDisplay({ number: 253_033_903_673.4, format: 'usd' }, 'zh-CN')).toBe('2530.34 亿美元')
  })

  it('scales USD to $-prefixed B/M in English, never a suffix currency word', () => {
    expect(formatBriefingValueDisplay({ number: -643_200_000, format: 'flow-usd' }, 'en-US')).toBe('-$643.2M')
    expect(formatBriefingValueDisplay({ number: 643_200_000, format: 'flow-usd' }, 'en-US')).toBe('+$643.2M')
    expect(formatBriefingValueDisplay({ number: 253_033_903_673.4, format: 'usd' }, 'en-US')).toBe('$253.03B')
  })

  it('formats a row change with the same locale rule', () => {
    expect(formatBriefingChangeDisplay({ value: -643_200_000, unit: 'usd', window: '24h' }, 'zh-CN')).toBe('-6.43 亿美元')
    expect(formatBriefingChangeDisplay({ value: -643_200_000, unit: 'usd', window: '24h' }, 'en-US')).toBe('-$643.2M')
    expect(formatBriefingChangeDisplay({ value: 0.12, unit: 'percent', window: '24h' }, 'zh-CN')).toBe('+0.12%')
  })

  it('exposes the scaled display number as a legal fact spelling', () => {
    expect(briefingDisplayNumbers('-6.43 亿美元')).toEqual(expect.arrayContaining(['-6.43', '6.43']))
    expect(briefingDisplayNumbers('-$643.2M')).toEqual(expect.arrayContaining(['-643.2', '643.2']))
  })
})
