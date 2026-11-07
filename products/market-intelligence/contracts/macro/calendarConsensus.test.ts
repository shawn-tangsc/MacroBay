import { describe, expect, it } from 'vitest'

import { resolveCalendarConsensus } from './calendarConsensus'

describe('resolving which consensus a calendar event is judged against', () => {
  it('uses the official consensus first and names it as official', () => {
    expect(resolveCalendarConsensus({ displayValue: '6.5万' }, { displayValue: '6.1万' }))
      .toEqual({ state: 'value', value: '6.5万', source: 'official' })
  })

  it('falls back to the market consensus when the official side has none, and says so', () => {
    // The official sources publish no consensus at all; the market observation is the only place an
    // expectation can come from, and the reader has to be able to see that.
    expect(resolveCalendarConsensus(undefined, { displayValue: '6.5万' }))
      .toEqual({ state: 'value', value: '6.5万', source: 'market' })
    expect(resolveCalendarConsensus(null, { displayValue: '6.5万' }))
      .toEqual({ state: 'value', value: '6.5万', source: 'market' })
  })

  it('says "no observation" only when neither side has one', () => {
    expect(resolveCalendarConsensus(undefined, undefined)).toEqual({ state: 'missing' })
    // A blank display value on an existing observation is still an unreadable value, not "missing".
    expect(resolveCalendarConsensus(undefined, { displayValue: '  ' }))
      .toEqual({ state: 'unreadable', source: 'market' })
  })

  it('keeps "we could not read it" apart from "there is nothing to read"', () => {
    // `null` is an observation whose field is empty; `undefined` is no observation at all. Merging
    // them is how "could not read" gets written as "there is none".
    expect(resolveCalendarConsensus(undefined, null)).toEqual({ state: 'unreadable', source: 'market' })
    expect(resolveCalendarConsensus(null, undefined)).toEqual({ state: 'unreadable', source: 'official' })
    expect(resolveCalendarConsensus(undefined, null)).not.toEqual(resolveCalendarConsensus(undefined, undefined))
  })

  it('keeps the number and the source in one answer, so they cannot be crossed', () => {
    const resolved = resolveCalendarConsensus(undefined, { displayValue: '6.5万' })
    expect(resolved.state === 'value' && resolved.value).toBe('6.5万')
    expect(resolved.state === 'value' && resolved.source).toBe('market')
  })
})
