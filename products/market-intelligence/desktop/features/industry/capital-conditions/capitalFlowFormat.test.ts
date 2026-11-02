import { describe, expect, it } from 'vitest'

import { formatFlowUsd } from './capitalFlowFormat'

describe('formatFlowUsd', () => {
  it('keeps one scale: millions with a currency sign and an ASCII minus', () => {
    expect(formatFlowUsd(402_600_000)).toBe('+$402.6M')
    expect(formatFlowUsd(-318_400_000)).toBe('-$318.4M')
  })

  it('never keeps a trailing .0 on a whole number', () => {
    expect(formatFlowUsd(151_000_000)).toBe('+$151M')
    expect(formatFlowUsd(1_250_000_000)).toBe('+$1250M')
  })

  it('stays in millions instead of switching to billions', () => {
    expect(formatFlowUsd(2_500_000_000)).toBe('+$2500M')
  })

  it('drops the sign when the axis asks for a magnitude', () => {
    expect(formatFlowUsd(402_600_000, { signed: false })).toBe('$402.6M')
    expect(formatFlowUsd(-402_600_000, { signed: false })).toBe('-$402.6M')
  })

  it('writes zero without a unit', () => {
    expect(formatFlowUsd(0)).toBe('$0')
    expect(formatFlowUsd(-0)).toBe('$0')
  })

  it('refuses values a reader could not be shown', () => {
    expect(formatFlowUsd(Number.NaN)).toBe('')
    expect(formatFlowUsd(Number.POSITIVE_INFINITY)).toBe('')
  })
})
