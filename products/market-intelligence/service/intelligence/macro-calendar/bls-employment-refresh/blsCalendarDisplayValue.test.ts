import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { formatBlsCalendarValue } from './blsCalendarDisplayValue'

describe('BLS calendar display value formatter', () => {
  it.each([
    ['cpi', 3.364825041479902, '3.4%'],
    ['core-cpi', 2.4782661559973107, '2.5%'],
    ['average-hourly-earnings', 0.05319148936169249, '0.1%'],
    ['average-hourly-earnings', 0.2934115764203771, '0.3%'],
    ['unemployment', 4.1, '4.1%'],
    ['unemployment', 1.15, '1.2%'],
    ['unemployment', -1.15, '-1.2%']
  ] as const)('formats %s percent value %s canonically', (metric, numericValue, displayValue) => {
    expect(formatBlsCalendarValue(metric, numericValue)).toEqual({ numericValue, displayValue, unit: 'percent' })
  })

  it.each([
    [20, '+20K'],
    [-23, '-23K'],
    [0, '0K']
  ] as const)('formats signed nonfarm payroll value %s as %s', (numericValue, displayValue) => {
    expect(formatBlsCalendarValue('nonfarm-payrolls', numericValue)).toEqual({ numericValue, displayValue, unit: 'thousands' })
  })

  it('preserves the full numeric value and normalizes negative zero presentation', () => {
    const numericValue = 0.05319148936169249
    expect(formatBlsCalendarValue('average-hourly-earnings', numericValue)?.numericValue).toBe(numericValue)
    expect(formatBlsCalendarValue('unemployment', -0)).toEqual({ numericValue: -0, displayValue: '0.0%', unit: 'percent' })
  })

  it('rejects unknown, non-finite, fractional payroll, and conflicting stored units', () => {
    expect(formatBlsCalendarValue('unknown' as never, 1)).toBeUndefined()
    expect(formatBlsCalendarValue('cpi', Number.NaN)).toBeUndefined()
    expect(formatBlsCalendarValue('cpi', Number.POSITIVE_INFINITY)).toBeUndefined()
    expect(formatBlsCalendarValue('nonfarm-payrolls', 1.5)).toBeUndefined()
    expect(formatBlsCalendarValue('nonfarm-payrolls', Number.MAX_SAFE_INTEGER + 1)).toBeUndefined()
    expect(formatBlsCalendarValue('cpi', 1.2, 'thousands')).toBeUndefined()
    expect(formatBlsCalendarValue('nonfarm-payrolls', 20, 'percent')).toBeUndefined()
  })

  it('does not use binary-sensitive toFixed formatting', () => {
    const source = readFileSync(new URL('./blsCalendarDisplayValue.ts', import.meta.url), 'utf8')
    expect(source).not.toContain('.toFixed(')
  })
})
