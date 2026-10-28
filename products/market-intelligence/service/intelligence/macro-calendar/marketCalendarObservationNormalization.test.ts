import { describe, expect, it } from 'vitest'

import {
  isMarketCalendarPage,
  marketCalendarPublicPolicy,
  type MarketCalendarEvent,
  type MarketCalendarPage
} from '../../../contracts/macro/marketCalendarQueryContracts'
import {
  assessMarketCalendarSurprise,
  toCalendarSurpriseView
} from '../../../contracts/macro/marketCalendarSurprise'
import { zeroXRouterCalendarStoragePolicy } from './0xrouter-calendar/marketCalendarStorageValidation'
import {
  marketCalendarObservationEventKey,
  marketCalendarObservationPolicy,
  normalizeMarketCalendarEvent,
  readMarketCalendarObservations
} from './marketCalendarObservationNormalization'

const AS_OF = '2026-09-25T08:30:00.000Z'
const MONTH = '2026-09'
const DESCRIPTOR = 'macro-calendar-0xrouter-economic-data'
const OBSERVATION_KEY = JSON.stringify(['0xrouter', DESCRIPTOR, 'zh', JSON.stringify(['211664', 71565])])

function event(overrides: Partial<MarketCalendarEvent> = {}): MarketCalendarEvent {
  return {
    eventKey: '11111111-2222-3333-4444-555555555555', observationKey: OBSERVATION_KEY,
    title: '美国核心CPI年率', countryCode: 'US', eventType: 'economic-indicator', importance: 'high',
    scheduledAt: '2026-09-10T12:30:00.000Z', consensus: { displayValue: '3.1' }, providerPrevious: { displayValue: '3.0' },
    providerActual: { displayValue: '3.2' }, source: '0xRouter', sourceObservedAt: '2026-09-10T12:31:00.000Z',
    coverage: 'observed-unverified', ...overrides
  }
}

function withoutIdentity(): MarketCalendarEvent {
  const { observationKey: _ignored, ...rest } = event()
  return rest as MarketCalendarEvent
}

function cursorFor(index: number): string {
  return `${String(index).padStart(8, '0')}-2222-3333-4444-555555555555`
}

function page(events: readonly MarketCalendarEvent[], nextCursor?: string): MarketCalendarPage {
  const result = { state: 'available', month: MONTH, locale: 'zh', asOf: AS_OF, events,
    sources: marketCalendarPublicPolicy.kinds.map(eventType => ({ eventType, status: 'success',
      sourceObservedAt: '2026-09-10T00:00:00.000Z' })),
    ...(nextCursor ? { nextCursor } : {}) }
  if (!isMarketCalendarPage(result, { month: MONTH, locale: 'zh', asOf: AS_OF })) throw new Error('test page is not a valid market page')
  return result
}

describe('0xRouter observation normalization', () => {
  it('derives the analysis identity from the stable observation key, never the per-batch event key', () => {
    const first = normalizeMarketCalendarEvent(event())
    const second = normalizeMarketCalendarEvent(event({ eventKey: '99999999-8888-7777-6666-555555555555' }))
    const other = normalizeMarketCalendarEvent(event({ observationKey: `${OBSERVATION_KEY} ` }))

    expect(first?.eventKey).toBe(second?.eventKey)
    expect(first?.eventKey).toBe(marketCalendarObservationEventKey(OBSERVATION_KEY))
    expect(first?.eventKey).not.toBe(other?.eventKey)
    expect(first?.eventKey).toMatch(/^market-observation-[a-f0-9]{32}$/)
    expect(first?.eventKey).not.toContain('211664')
  })

  it('refuses an observation with no stable identity instead of reporting a new event every batch', () => {
    const { observationKey: _ignored, ...withoutKey } = event()
    expect(normalizeMarketCalendarEvent(withoutKey as MarketCalendarEvent)).toBeUndefined()
  })

  it('maps provider fields onto the official event shape without claiming official identity', () => {
    const observation = normalizeMarketCalendarEvent(event({ countryCode: 'DE', importance: 'medium' }))

    expect(observation).toMatchObject({
      eventFamily: 'economic-indicator', titleKey: '美国核心CPI年率', countryCode: 'DE', importance: 'medium',
      periodKey: '2026-M09', lifecycleState: 'released', scheduledDate: '2026-09-10',
      scheduledAt: '2026-09-10T12:30:00.000Z', detectedAt: '2026-09-10T12:31:00.000Z',
      actual: { displayValue: '3.2' }, previous: { displayValue: '3.0' }, consensus: { displayValue: '3.1' },
      consensusState: 'available', surprise: 'beat', providerIds: [DESCRIPTOR], coverage: 'partial'
    })
    expect(observation?.releaseGroupKey).toBe(observation?.eventKey)
    expect(observation?.caveats).toEqual(expect.arrayContaining([
      marketCalendarObservationPolicy.caveats.coverageUnverified,
      marketCalendarObservationPolicy.caveats.titleIsProviderDisplayName
    ]))
  })

  it('reports an unreleased observation as scheduled with no actual', () => {
    const observation = normalizeMarketCalendarEvent(event({ providerActual: null, consensus: null }))
    expect(observation).toMatchObject({ lifecycleState: 'scheduled', consensus: null, consensusState: 'unavailable',
      surprise: 'consensus-unavailable' })
    expect(observation?.actual).toBeUndefined()
  })

  it('keeps non-indicator kinds value-free and resolves their descriptor from the contract alignment', () => {
    const financial = normalizeMarketCalendarEvent(event({ eventType: 'financial-event', consensus: null,
      providerPrevious: null, providerActual: null }))
    const centralBank = normalizeMarketCalendarEvent(event({ eventType: 'central-bank-activity', consensus: null,
      providerPrevious: null, providerActual: null }))

    expect(financial).toMatchObject({ eventFamily: 'financial-event', providerIds: ['macro-calendar-0xrouter-financial-events'] })
    expect(centralBank).toMatchObject({ eventFamily: 'central-bank-activity', providerIds: ['macro-calendar-0xrouter-central-bank-activities'] })
    for (const [descriptorId, kind] of Object.entries(zeroXRouterCalendarStoragePolicy.descriptorKinds)) {
      expect(normalizeMarketCalendarEvent(event({ eventType: kind as MarketCalendarEvent['eventType'], consensus: null,
        providerPrevious: null, providerActual: null }))?.providerIds).toEqual([descriptorId])
    }
  })

  it('compares only values whose unit form is admitted and flags what it cannot compare', () => {
    const value = (displayValue: string) => ({ displayValue })
    const surprise = (actual: string, consensus: string) => {
      const assessment = assessMarketCalendarSurprise(value(actual), value(consensus))
      return { view: toCalendarSurpriseView(assessment), reason: assessment.reason }
    }

    expect(surprise('3.2', '3.1')).toEqual({ view: 'beat', reason: null })
    expect(surprise('3.0', '3.1')).toEqual({ view: 'miss', reason: null })
    expect(surprise('3.1', '3.1')).toEqual({ view: 'inline', reason: null })
    expect(surprise('3.2%', '3.1%')).toEqual({ view: 'beat', reason: null })
    expect(surprise('-1.5', '-1.2')).toEqual({ view: 'miss', reason: null })
    expect(surprise('.5', '0.4')).toEqual({ view: 'beat', reason: null })
    expect(surprise('3.2%', '3.1')).toEqual({ view: 'consensus-unavailable', reason: 'unit-mismatch' })
    expect(surprise('250K', '240K')).toEqual({ view: 'consensus-unavailable', reason: 'non-numeric' })
    expect(surprise('1.2M', '1200000')).toEqual({ view: 'consensus-unavailable', reason: 'non-numeric' })
    expect(surprise('3.2-3.4', '3.1')).toEqual({ view: 'consensus-unavailable', reason: 'non-numeric' })
    expect(toCalendarSurpriseView(assessMarketCalendarSurprise(value('3.2'), null))).toBe('consensus-unavailable')
    expect(assessMarketCalendarSurprise(value('3.2'), null).reason).toBe('missing-consensus')
    expect(toCalendarSurpriseView(assessMarketCalendarSurprise(undefined, value('3.1')))).toBe('consensus-unavailable')
    expect(assessMarketCalendarSurprise(undefined, value('3.1')).reason).toBe('missing-actual')

    const uncomparable = normalizeMarketCalendarEvent(event({ providerActual: { displayValue: '250K' },
      consensus: { displayValue: '240K' } }))
    expect(uncomparable?.surprise).toBe('consensus-unavailable')
    expect(uncomparable?.consensusState).toBe('available')
    expect(uncomparable?.caveats).toContain(marketCalendarObservationPolicy.caveats.surpriseNotComparable)
  })

  it('reads the bounded provider page, follows its cursor, and names every gap it keeps', () => {
    const requested: unknown[] = []
    const result = readMarketCalendarObservations((input) => {
      requested.push(input)
      const index = Number((input as { cursor?: string }).cursor?.slice(0, 8) ?? 0)
      return page([event({ observationKey: `${OBSERVATION_KEY}-${index}` })], cursorFor(index + 1))
    }, { month: MONTH, asOf: AS_OF })

    expect(requested).toHaveLength(marketCalendarObservationPolicy.maximumPages)
    expect(requested[0]).toEqual({ month: MONTH, locale: 'zh', asOf: AS_OF })
    expect(requested[1]).toEqual({ month: MONTH, locale: 'zh', asOf: AS_OF, cursor: cursorFor(1) })
    expect(result.observations).toHaveLength(marketCalendarObservationPolicy.maximumPages)
    expect(result.caveats).toEqual([marketCalendarObservationPolicy.caveats.pagesTruncated])
  })

  it('stops at the end of the provider page range without a truncation caveat', () => {
    const requested: unknown[] = []
    const result = readMarketCalendarObservations((input) => {
      requested.push(input)
      return page([event()], (input as { cursor?: string }).cursor ? undefined : cursorFor(1))
    }, { month: MONTH, asOf: AS_OF })

    expect(requested).toHaveLength(2)
    expect(result.observations).toHaveLength(1)
    expect(result.caveats).toEqual([])
  })

  it('bounds provider admission to the fact budget and names what it dropped', () => {
    const far = event({ observationKey: `${OBSERVATION_KEY}-far`, scheduledAt: '2026-09-01T00:00:00.000Z' })
    const near = Array.from({ length: marketCalendarObservationPolicy.maximumObservations }, (_, index) =>
      event({ observationKey: `${OBSERVATION_KEY}-near-${index}`, scheduledAt: '2026-09-24T12:30:00.000Z' }))
    const result = readMarketCalendarObservations(() => page([far, ...near]), { month: MONTH, asOf: AS_OF })

    expect(result.observations).toHaveLength(marketCalendarObservationPolicy.maximumObservations)
    expect(result.observations.map(item => item.eventKey))
      .not.toContain(marketCalendarObservationEventKey(String(far.observationKey)))
    expect(result.observations.every(item => item.lifecycleState === 'released')).toBe(true)
    expect(result.caveats).toContain(marketCalendarObservationPolicy.caveats.observationsTruncated)
  })

  it('admits an updated value ahead of a nearer schedule at the cap, deterministically', () => {
    const released = event({ observationKey: `${OBSERVATION_KEY}-released`, scheduledAt: '2026-09-02T00:00:00.000Z' })
    const scheduled = Array.from({ length: marketCalendarObservationPolicy.maximumObservations }, (_, index) =>
      event({ observationKey: `${OBSERVATION_KEY}-scheduled-${index}`, scheduledAt: '2026-09-24T12:30:00.000Z',
        consensus: null, providerPrevious: null, providerActual: null }))
    const run = () => readMarketCalendarObservations(() => page([released, ...scheduled]), { month: MONTH, asOf: AS_OF })
    const result = run()

    expect(result.observations).toHaveLength(marketCalendarObservationPolicy.maximumObservations)
    expect(result.observations[0]?.eventKey).toBe(marketCalendarObservationEventKey(String(released.observationKey)))
    expect(result.caveats).toContain(marketCalendarObservationPolicy.caveats.observationsTruncated)
    expect(run().observations.map(item => item.eventKey)).toEqual(result.observations.map(item => item.eventKey))
  })

  it('admits a high-importance release ahead of nearer routine rows, which is what the reader missed', () => {
    // The real shape of the defect: a month of already-released routine series (medium importance,
    // near the analysis instant) filled every admission slot, so the morning's CPI/PPI were absent
    // from the snapshot — and an event absent from the snapshot can never be reported as changed
    // when its actual arrives, so the release never triggered an analysis.
    const routine = Array.from({ length: marketCalendarObservationPolicy.maximumObservations }, (_, index) =>
      event({ observationKey: `${OBSERVATION_KEY}-routine-${index}`, scheduledAt: '2026-09-24T12:00:00.000Z',
        importance: 'medium' }))
    const cpi = event({ observationKey: `${OBSERVATION_KEY}-cpi`, scheduledAt: '2026-09-25T01:30:00.000Z',
      importance: 'high', providerActual: null })
    const result = readMarketCalendarObservations(() => page([...routine, cpi]), { month: MONTH, asOf: AS_OF })

    expect(result.observations[0]?.eventKey).toBe(marketCalendarObservationEventKey(String(cpi.observationKey)))
    // Even ahead of a routine row that is nearer the analysis instant, and one that carries an actual.
    expect(result.caveats).toContain(marketCalendarObservationPolicy.caveats.observationsTruncated)
  })

  it('admits the imminent high-importance release ahead of older high-importance ones that already printed', () => {
    // The decisive regression, measured on the reader's own store: with "carries an actual" ranked
    // ahead of closeness, every high-importance number of the past week outranked the release about
    // to be published — the morning's CPI sat at position 36 of 565, never entered the snapshot, and
    // an event absent from the snapshot can never be reported as changed when its actual arrives.
    const printed = Array.from({ length: marketCalendarObservationPolicy.maximumObservations }, (_, index) =>
      event({ observationKey: `${OBSERVATION_KEY}-printed-${index}`, scheduledAt: '2026-09-01T12:00:00.000Z', importance: 'high' }))
    const imminent = event({ observationKey: `${OBSERVATION_KEY}-imminent`, scheduledAt: AS_OF, importance: 'high',
      providerActual: null })
    const result = readMarketCalendarObservations(() => page([...printed, imminent]), { month: MONTH, asOf: AS_OF })

    expect(result.observations[0]?.eventKey).toBe(marketCalendarObservationEventKey(String(imminent.observationKey)))
    // And its consensus is what the analysis compares the eventual actual against.
    expect(result.observations[0]?.consensus).not.toBeNull()
    expect(result.caveats).toContain(marketCalendarObservationPolicy.caveats.observationsTruncated)
  })

  it('reads far enough into the month that its later half is not invisible', () => {
    // Four pages of a hundred rows did not reach the end of a provider month, so the second half of
    // it never became a candidate: the releases the reader was waiting for were not merely
    // deprioritised, they were never read.
    const requested: unknown[] = []
    const result = readMarketCalendarObservations((input) => {
      requested.push(input)
      const index = Number((input as { cursor?: string }).cursor?.slice(0, 8) ?? 0)
      return page([event({ observationKey: `${OBSERVATION_KEY}-${index}` })], cursorFor(index + 1))
    }, { month: MONTH, asOf: AS_OF })

    expect(requested.length).toBeGreaterThan(4)
    expect(requested).toHaveLength(marketCalendarObservationPolicy.maximumPages)
  })

  it('does not flag provider truncation while the month stays inside the cap', () => {
    const result = readMarketCalendarObservations(() => page([event(), event({ observationKey: `${OBSERVATION_KEY}-b` })]), { month: MONTH, asOf: AS_OF })

    expect(result.observations).toHaveLength(2)
    expect(result.caveats).not.toContain(marketCalendarObservationPolicy.caveats.observationsTruncated)
  })

  it('keeps the official route usable when the provider page or a row identity is unusable', () => {
    const noIdentity = readMarketCalendarObservations(() => page([withoutIdentity()]), { month: MONTH, asOf: AS_OF })
    expect(noIdentity.observations).toEqual([])
    expect(noIdentity.caveats).toEqual([marketCalendarObservationPolicy.caveats.identityMissing])

    const unavailable = readMarketCalendarObservations(() => ({ state: 'unavailable', failureCode: 'query-unavailable' }), { month: MONTH, asOf: AS_OF })
    expect(unavailable).toEqual({ observations: [], caveats: [marketCalendarObservationPolicy.caveats.pageUnavailable] })

    const hostile = readMarketCalendarObservations(() => { throw new Error('storage unavailable') }, { month: MONTH, asOf: AS_OF })
    expect(hostile).toEqual({ observations: [], caveats: [marketCalendarObservationPolicy.caveats.pageUnavailable] })

    const wrongMonth = readMarketCalendarObservations(() => ({ ...page([event()]), month: '2026-08' }), { month: MONTH, asOf: AS_OF })
    expect(wrongMonth).toEqual({ observations: [], caveats: [marketCalendarObservationPolicy.caveats.pageUnavailable] })
  })
})
