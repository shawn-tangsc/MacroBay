import { expect, it } from 'vitest'
import { assembleMacroCalendarEventContext, coverageOf, isMacroCalendarEventContextQuery, macroCalendarEventContextPolicy } from './macroCalendarEventContextQuery'

it('accepts an event key, its month and an instant, and nothing else', () => {
  expect(isMacroCalendarEventContextQuery({ eventKey: 'US.CPI', month: '2026-10', asOf: '2026-10-11T09:00:00.000Z' })).toBe(true)
  // A 0xRouter key carries no month, so a query without one cannot be scoped — it is rejected.
  expect(isMacroCalendarEventContextQuery({ eventKey: 'market-observation-1', asOf: '2026-10-11T09:00:00.000Z' })).toBe(false)
  expect(isMacroCalendarEventContextQuery({ eventKey: 'US.CPI', month: '2026-10', asOf: '2026-10-11T09:00:00.000Z', extra: 1 })).toBe(false)
  expect(isMacroCalendarEventContextQuery({ eventKey: '', month: '2026-10', asOf: '2026-10-11T09:00:00.000Z' })).toBe(false)
  expect(isMacroCalendarEventContextQuery({ eventKey: 'US.CPI', month: 'October', asOf: '2026-10-11T09:00:00.000Z' })).toBe(false)
  expect(isMacroCalendarEventContextQuery({ eventKey: 'US.CPI', month: '2026-10', asOf: 'not-a-date' })).toBe(false)
  expect(isMacroCalendarEventContextQuery(null)).toBe(false)
})

it('says unavailable rather than empty when nothing is held', () => {
  // An empty fact list dressed up as a context lets the model narrate a silence as a finding.
  expect(coverageOf({ factCount: 0, eventValuesPresent: false })).toBe('unavailable')
  expect(coverageOf({ factCount: 0, eventValuesPresent: true })).toBe('unavailable')
})

it('says partial when there is something but not enough to reason from', () => {
  expect(coverageOf({ factCount: macroCalendarEventContextPolicy.minimumFacts - 1, eventValuesPresent: true })).toBe('partial')
})

it('says partial when the event has no published values, however many other facts there are', () => {
  // The gap a model is most likely to fill with the expectation instead of the result.
  expect(coverageOf({ factCount: 20, eventValuesPresent: false })).toBe('partial')
})

it('says available only when the facts are there and the event itself has values', () => {
  expect(coverageOf({ factCount: macroCalendarEventContextPolicy.minimumFacts, eventValuesPresent: true })).toBe('available')
})

it('names why a context is incomplete, in the words the agent is given', () => {
  const fact = { factId: 'market-observation-1', metric: 'actual', value: '0.3%' }
  // Nothing held: the agent is told we hold nothing, not handed an empty list to interpret.
  expect(assembleMacroCalendarEventContext({ facts: [], evidenceRefs: [], eventValuesPresent: false }))
    .toMatchObject({ coverage: 'unavailable', caveats: ['no-facts-held'] })
  // Something, but too little to reason from.
  expect(assembleMacroCalendarEventContext({ facts: [fact], evidenceRefs: ['r-1'], eventValuesPresent: true }))
    .toMatchObject({ coverage: 'partial', caveats: ['insufficient-facts'] })
  // Plenty of facts, but not the one that matters: the event's own published value.
  expect(assembleMacroCalendarEventContext({ facts: [fact, fact, fact], evidenceRefs: ['r-1'], eventValuesPresent: false }))
    .toMatchObject({ coverage: 'partial', caveats: ['event-values-missing'] })
  // Complete: no caveat, because there is nothing to warn about.
  expect(assembleMacroCalendarEventContext({ facts: [fact, fact, fact], evidenceRefs: ['r-1', 'r-2'], eventValuesPresent: true }))
    .toMatchObject({ coverage: 'available', caveats: [], evidenceRefs: ['r-1', 'r-2'] })
})
