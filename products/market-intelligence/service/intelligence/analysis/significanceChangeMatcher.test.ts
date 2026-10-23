import { expect, it } from 'vitest'
import type { MacroEconomicCalendarEventView } from '../../../contracts/macro/economicCalendarQueryContracts'
import {
  diffSignificance, eventKeyOfEvidenceRef, semanticKeyOf, type SignificanceBaseline
} from './significanceChangeMatcher'

const previousAsOf = '2026-10-09T00:00:00.000Z'

function official(overrides: Partial<MacroEconomicCalendarEventView> = {}): MacroEconomicCalendarEventView {
  return {
    eventKey: 'US.CPI.RELEASE.2026-M09', releaseGroupKey: 'US.BLS.RELEASE.1', eventFamily: 'consumer-price-index',
    titleKey: 'cpi', countryCode: 'US', importance: 'high', periodKey: 'release-2026-10-13', lifecycleState: 'released',
    coverage: 'available', scheduledDate: '2026-10-13', scheduledAt: '2026-10-13T12:30:00.000Z',
    detectedAt: '2026-10-09T06:00:00.000Z', actual: { displayValue: '3.2%' }, previous: { displayValue: '3.1%' },
    ...overrides
  } as MacroEconomicCalendarEventView
}

const baseline = (official_: readonly MacroEconomicCalendarEventView[]): SignificanceBaseline =>
  ({ official: official_, provider: [], months: ['2026-09', '2026-10'], asOf: '2026-10-09T12:00:00.000Z' })

/** The previous side as the snapshot rebuilds it: semantic key -> display value. */
function baselineOf(entries: readonly (readonly [string, string | null])[]): Map<string, string | null> {
  return new Map(entries.map(([key, value]) => [key, value]))
}

const key = (metric: string, eventKey = 'US.CPI.RELEASE.2026-M09') => semanticKeyOf('macro', 'consumer-price-index', metric, eventKey)

it('reports a high-importance release the snapshot never carried, while it is still news', () => {
  // The reader's case: the 09:30 CPI printed while the previous snapshot's admission had dropped the
  // event, so no `actual-changed` could be derived and the "upcoming catalyst" branch did not apply
  // either — the release existed in the store and the analysis never heard about it.
  const released = official({
    eventKey: 'CN.CPI.RELEASE.2026-M09', eventFamily: 'consumer-price-index', importance: 'high',
    scheduledAt: '2026-10-14T01:30:00.000Z', actual: { displayValue: '0.9%' }, detectedAt: '2026-10-14T02:00:00.000Z'
  })
  const current: SignificanceBaseline = { official: [released], provider: [], months: ['2026-10'], asOf: '2026-10-14T04:00:00.000Z' }

  expect(diffSignificance(baselineOf([]), current, previousAsOf)).toEqual([
    { kind: 'actual-changed', eventKey: 'CN.CPI.RELEASE.2026-M09', titleKey: 'cpi', metric: 'actual', importance: 'high', previousValue: null, value: '0.9%' }
  ])
})

it('does not replay history: only recent, high-importance, actually-released additions count', () => {
  const current = (overrides: Partial<MacroEconomicCalendarEventView>): SignificanceBaseline =>
    ({ official: [official(overrides)], provider: [], months: ['2026-10'], asOf: '2026-10-14T04:00:00.000Z' })
  const base = { eventKey: 'CN.CPI.RELEASE.2026-M09', scheduledAt: '2026-10-14T01:30:00.000Z', detectedAt: '2026-10-14T02:00:00.000Z' }

  // Three days old: a first sync of a long month must not wake the model for it.
  expect(diffSignificance(baselineOf([]), current({ ...base, scheduledAt: '2026-10-11T01:30:00.000Z' }), previousAsOf)).toEqual([])
  // Medium importance is the significance policy's business, not this branch's.
  expect(diffSignificance(baselineOf([]), current({ ...base, importance: 'medium' }), previousAsOf)).toEqual([])
  // Nothing published yet: it is a placeholder, not news.
  expect(diffSignificance(baselineOf([]), current({ ...base, actual: null }), previousAsOf)).toEqual([])
  // Older than the previous snapshot: the event merely fell outside its fact budget.
  expect(diffSignificance(baselineOf([]), current({ ...base, detectedAt: '2026-10-08T00:00:00.000Z' }), previousAsOf)).toEqual([])
})

it('never reports a same-value refresh, whatever the collection instant was', () => {
  const previous = baselineOf([[key('actual'), '3.2%'], [key('previous'), '3.1%']])
  for (const detectedAt of ['2026-10-09T06:00:00.000Z', '2026-10-09T12:30:00.000Z', '2026-10-10T00:00:00.000Z']) {
    expect(diffSignificance(previous, baseline([official({ detectedAt })]), previousAsOf)).toEqual([])
  }
})

it('reports a published or revised value with its previous value', () => {
  const previous = baselineOf([[key('actual'), '3.1%'], [key('previous'), '3.0%']])
  expect(diffSignificance(previous, baseline([official({ actual: { displayValue: '3.2%' }, previous: { displayValue: '3.1%' } })]), previousAsOf))
    .toEqual([
      { kind: 'actual-changed', eventKey: 'US.CPI.RELEASE.2026-M09', titleKey: 'cpi', metric: 'actual', importance: 'high', previousValue: '3.1%', value: '3.2%' },
      { kind: 'previous-revised', eventKey: 'US.CPI.RELEASE.2026-M09', titleKey: 'cpi', metric: 'previous', importance: 'high', previousValue: '3.0%', value: '3.1%' }
    ])
})

it('reports a consensus change only when the snapshot carried consensus', () => {
  const withConsensus = baselineOf([[key('consensus'), '3.1%']])
  const event = official({ consensus: { displayValue: '3.3%' } })
  expect(diffSignificance(withConsensus, baseline([event]), previousAsOf).map(signal => signal.kind)).toEqual(['consensus-changed'])
  // Unknown before-value is not a change: the metric was absent from the snapshot.
  expect(diffSignificance(baselineOf([[key('actual'), '3.2%']]), baseline([event]), previousAsOf)).toEqual([])
})

it('reports an addition only with positive evidence that it is new to us', () => {
  const fresh = official({ eventKey: 'US.PPI.RELEASE.2026-M09', eventFamily: 'producer-price-index', detectedAt: '2026-10-09T06:00:00.000Z' })
  const stale = official({ eventKey: 'US.PPI.RELEASE.2026-M09', eventFamily: 'producer-price-index', detectedAt: '2026-10-08T00:00:00.000Z' })
  const previous = baselineOf([])
  expect(diffSignificance(previous, baseline([fresh]), previousAsOf).map(signal => signal.kind)).toEqual(['event-added'])
  // Collected before the previous snapshot: it was known, just outside the fact budget.
  expect(diffSignificance(previous, baseline([stale]), previousAsOf)).toEqual([])
})

it('does not treat an event the snapshot already knew as an addition', () => {
  const previous = baselineOf([[key('actual', 'US.PPI.RELEASE.2026-M09'), '0.2%']])
  const event = official({ eventKey: 'US.PPI.RELEASE.2026-M09', eventFamily: 'producer-price-index', actual: { displayValue: '0.2%' }, detectedAt: '2026-10-09T06:00:00.000Z' })
  expect(diffSignificance(previous, baseline([event]), previousAsOf)).toEqual([])
})

it('stays silent without a predecessor instead of claiming everything is new', () => {
  expect(diffSignificance(null, baseline([official()]), null)).toEqual([])
})

it('carries the route importance and title key so the policy can filter', () => {
  const previous = baselineOf([[key('actual'), '3.1%']])
  const signals = diffSignificance(previous, baseline([official({ importance: 'high' })]), previousAsOf)
  expect(signals[0]).toMatchObject({ importance: 'high', titleKey: 'cpi', eventKey: 'US.CPI.RELEASE.2026-M09' })
})

it('rebuilds the raw event key from the evidence reference, dots intact', () => {
  expect(eventKeyOfEvidenceRef('macro-calendar:us-bls-official-calendar:US.CPI.RELEASE.2026-M08')).toBe('US.CPI.RELEASE.2026-M08')
  expect(eventKeyOfEvidenceRef('macro-calendar:0xrouter-calendar:market-observation-abc')).toBe('market-observation-abc')
  expect(eventKeyOfEvidenceRef('unrelated')).toBeNull()
  expect(eventKeyOfEvidenceRef('macro-calendar:only-one-part')).toBeNull()
  expect(eventKeyOfEvidenceRef(null)).toBeNull()
  expect(eventKeyOfEvidenceRef('macro-calendar:provider:')).toBeNull()
})

it('does not wake the model for last week routine series rolling into the window', () => {
  // A weekly supply series that is merely new to our collection window: published, past-dated,
  // and no forward-looking information. This is what made the analysis spend a call on oil rig
  // counts and conclude "暂不判断".
  const past = official({ eventKey: 'market-observation-oil-rigs', eventFamily: 'economic-indicator',
    lifecycleState: 'released', scheduledDate: '2026-10-02', scheduledAt: '2026-10-02T17:00:00.000Z', detectedAt: '2026-10-09T06:00:00.000Z' })
  const signals = diffSignificance(baselineOf([]), { ...baseline([past]), asOf: '2026-10-09T12:00:00.000Z' }, previousAsOf)
  expect(signals).toEqual([])
})

it('still wakes the model for an upcoming high-importance catalyst', () => {
  const upcoming = official({ eventKey: 'US.CPI.RELEASE.2026-M10', eventFamily: 'consumer-price-index',
    lifecycleState: 'scheduled', scheduledDate: '2026-10-13', scheduledAt: '2026-10-13T12:30:00.000Z', detectedAt: '2026-10-09T06:00:00.000Z', actual: undefined })
  const signals = diffSignificance(baselineOf([]), { ...baseline([upcoming]), asOf: '2026-10-09T12:00:00.000Z' }, previousAsOf)
  expect(signals.map(signal => signal.kind)).toEqual(['event-added'])
})
