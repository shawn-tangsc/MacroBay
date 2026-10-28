import { describe, expect, it } from 'vitest'

import {
  assessMarketCalendarSurprise,
  exceedsSurpriseTrigger,
  marketCalendarSurprisePolicy,
  toCalendarSurpriseView
} from './marketCalendarSurprise'

const value = (displayValue: string) => ({ displayValue })
const assess = (actual: string, consensus: string) => assessMarketCalendarSurprise(value(actual), value(consensus))

describe('market calendar surprise', () => {
  it('compares percentage values in percentage points', () => {
    const beat = assess('3.4%', '3.1%')
    expect(beat).toMatchObject({
      direction: 'beat', presentation: { unit: 'pp' }, reason: null
    })
    expect(beat.presentation?.value).toBeCloseTo(0.3, 10)
    expect(beat.absoluteDifference).toBeCloseTo(0.3, 10)
    expect(beat.relativeDifferencePercent).toBeCloseTo(9.67741935483871, 10)
    expect(toCalendarSurpriseView(beat)).toBe('beat')
    expect(exceedsSurpriseTrigger(beat)).toBe(true)

    expect(assess('3.0%', '3.1%')).toMatchObject({ direction: 'miss', presentation: { unit: 'pp' } })
    expect(assess('3.1%', '3.1%')).toMatchObject({ direction: 'inline', presentation: { unit: 'pp', value: 0 } })
    expect(exceedsSurpriseTrigger(assess('3.1%', '3.1%'))).toBe(false)
  })

  it('compares bare numbers as a relative deviation from the expectation', () => {
    const beat = assess('165', '150')
    expect(beat).toMatchObject({ direction: 'beat', presentation: { unit: 'relative-percent' }, reason: null })
    expect(beat.presentation?.value).toBeCloseTo(10, 10)
    expect(exceedsSurpriseTrigger(beat)).toBe(true)

    expect(assess('135', '150')).toMatchObject({ direction: 'miss', presentation: { unit: 'relative-percent' } })
    expect(assess('135', '150').presentation?.value).toBeCloseTo(-10, 10)
    expect(assess('157.5', '150')).toMatchObject({ direction: 'beat', presentation: { unit: 'relative-percent' } })
    expect(exceedsSurpriseTrigger(assess('157.5', '150'))).toBe(true)
    expect(exceedsSurpriseTrigger(assess('157.4', '150'))).toBe(false)
  })

  it('keeps the direction when a bare expectation of zero leaves no relative denominator', () => {
    const zero = assess('3', '0')
    expect(zero).toMatchObject({ direction: 'beat', relativeDifferencePercent: null, presentation: null, reason: null })
    expect(toCalendarSurpriseView(zero)).toBe('beat')
    // No magnitude means no trigger: the policy has nothing to compare.
    expect(exceedsSurpriseTrigger(zero)).toBe(false)
  })

  it('refuses values whose unit form was never admitted', () => {
    for (const [actual, consensus] of [['250K', '240K'], ['1.2M', '1200000'], ['3.2-3.4', '3.1'], ['', '3.1']]) {
      const result = assess(actual, consensus)
      expect(result).toMatchObject({
        direction: 'not-comparable', absoluteDifference: null, relativeDifferencePercent: null, presentation: null, reason: 'non-numeric'
      })
      expect(toCalendarSurpriseView(result)).toBe('consensus-unavailable')
      expect(exceedsSurpriseTrigger(result)).toBe(false)
    }
  })

  it('names a unit mismatch separately from an unparseable value', () => {
    expect(assess('3.2%', '3.1')).toMatchObject({ direction: 'not-comparable', reason: 'unit-mismatch' })
    expect(assess('3.2', '3.1%')).toMatchObject({ direction: 'not-comparable', reason: 'unit-mismatch' })
  })

  it('names which side is missing instead of treating it as zero', () => {
    expect(assessMarketCalendarSurprise(undefined, value('3.1'))).toMatchObject({ reason: 'missing-actual', direction: 'not-comparable' })
    expect(assessMarketCalendarSurprise(value('3.2'), null)).toMatchObject({ reason: 'missing-consensus', direction: 'not-comparable' })
    expect(assessMarketCalendarSurprise(undefined, null)).toMatchObject({ reason: 'missing-actual' })
  })

  it('keeps the trigger at the contract threshold', () => {
    expect(marketCalendarSurprisePolicy.trigger).toEqual({ percentPoints: 0.2, relativeFraction: 0.05 })
    // 0.19pp is below, 0.21pp is above; a changed constant turns one of these red.
    expect(exceedsSurpriseTrigger(assess('3.39%', '3.2%'))).toBe(false)
    expect(exceedsSurpriseTrigger(assess('3.41%', '3.2%'))).toBe(true)
  })

  it('accepts signs, leading dots and surrounding whitespace', () => {
    expect(assess(' -1.5 ', ' -1.2 ')).toMatchObject({ direction: 'miss' })
    expect(assess('.5', '0.4')).toMatchObject({ direction: 'beat' })
    expect(assess('+3.4%', '+3.1%')).toMatchObject({ direction: 'beat' })
  })
})
