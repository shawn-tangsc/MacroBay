import { existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

async function contracts() {
  expect(existsSync(new URL('./marketCalendarQueryContracts.ts', import.meta.url))).toBe(true)
  return import('./marketCalendarQueryContracts')
}
const input = { month: '2026-09', locale: 'zh', asOf: '2026-09-10T00:00:00.000Z' }
const event = { eventKey: '00000000-0000-4000-8000-000000000001', title: 'Derived event', countryCode: null,
  eventType: 'economic-indicator', importance: 'high', scheduledAt: '2026-09-11T00:00:00.000Z',
  consensus: { displayValue: '0' }, providerPrevious: null, providerActual: { displayValue: '3' },
  source: '0xRouter', sourceObservedAt: input.asOf, coverage: 'observed-unverified' }
describe('market calendar exact safe contracts', () => {
  it('admits only safe endpoint attempt state and timestamp separately from old data time', async () => {
    const c = await contracts()
    const sources = c.marketCalendarPublicPolicy.kinds.map(eventType => ({ eventType, status: 'success', sourceObservedAt: input.asOf,
      latestAttempt: { state: 'failed', attemptedAt: input.asOf } }))
    expect(c.isMarketCalendarRefreshResult({ state: 'partial', sources })).toBe(true)
    for (const latestAttempt of [{ state: 'failed', attemptedAt: 'bad' }, { state: 'failed', attemptedAt: input.asOf, body: 'private' },
      { state: 'unknown', attemptedAt: input.asOf }]) {
      expect(c.isMarketCalendarRefreshResult({ state: 'partial', sources: sources.map(source => ({ ...source, latestAttempt })) })).toBe(false)
    }
  })
  it('names the verdict and origin of an attempt, and only for a failure this boundary knows', async () => {
    const c = await contracts()
    const named = (latestAttempt: unknown) => c.isMarketCalendarRefreshResult({ state: 'partial',
      sources: c.marketCalendarPublicPolicy.kinds.map(eventType => ({ eventType, status: 'success', sourceObservedAt: input.asOf, latestAttempt })) })
    // This is what lets the page say "storage limited" about a refused automatic collection.
    expect(named({ state: 'failed', attemptedAt: input.asOf, failureCode: 'storage-pressure', trigger: 'automatic' })).toBe(true)
    expect(named({ state: 'succeeded', attemptedAt: input.asOf, trigger: 'manual' })).toBe(true)
    for (const latestAttempt of [
      { state: 'failed', attemptedAt: input.asOf, failureCode: 'private-verdict' },
      { state: 'succeeded', attemptedAt: input.asOf, failureCode: 'storage-pressure' },
      { state: 'failed', attemptedAt: input.asOf, trigger: 'private' },
      { state: 'failed', attemptedAt: input.asOf, failureCode: undefined }
    ]) expect(named(latestAttempt)).toBe(false)
    expect(c.marketCalendarPublicPolicy.refreshFailures).toContain('storage-pressure')
  })
  it('accepts a bounded linked projection without exposing evidence or provider identity', async () => {
    const c = await contracts()
    const officialLink = { officialEventKey: 'US.CPI.RELEASE.2026-M08', officialPeriodKey: '2026-M08',
      officialScheduledDate: '2026-09-11', officialScheduledAt: null, officialDetectedAt: input.asOf,
      timeDisplaySource: 'provider-scheduled', displayScheduledAt: event.scheduledAt }
    expect(c.isMarketCalendarEvent({ ...event, officialLink })).toBe(true)
    for (const extra of [{ evidenceHash: 'a'.repeat(64) }, { indicatorId: 'private' }, { collectionId: 'private' },
      { timeDisplaySource: 'observed' }, { displayScheduledAt: input.asOf }, { officialDetectedAt: 'invalid' }]) {
      expect(c.isMarketCalendarEvent({ ...event, officialLink: { ...officialLink, ...extra } })).toBe(false)
    }
    let reads = 0
    expect(c.isMarketCalendarEvent({ ...event, officialLink: { ...officialLink, get evidenceHash() { reads++; return 'private' } } })).toBe(false)
    expect(reads).toBe(0)
  })
  it('validates bounded scope without invoking accessors or accepting extra caller fields', async () => {
    const c = await contracts()
    expect(c.isMarketCalendarQuery(input)).toBe(true)
    for (const bad of [{ ...input, month: '2026-13' }, { ...input, locale: 'fr' }, { ...input, asOf: '2026-02-30T00:00:00.000Z' },
      { ...input, url: 'forbidden' }, { ...input, collectionId: 'forbidden' }, { ...input, cursor: '' }]) expect(c.isMarketCalendarQuery(bad)).toBe(false)
    let reads = 0
    expect(c.isMarketCalendarQuery({ ...input, get cursor() { reads++; return 'forbidden' } })).toBe(false)
    expect(reads).toBe(0)
  })
  it('preserves display-only zero and nullable country, rejects hidden or unsafe projection data', async () => {
    const c = await contracts()
    expect(c.isMarketCalendarEvent(event)).toBe(true)
    for (const bad of [{ ...event, rawRecordId: 'private' }, { ...event, countryCode: 'ZZ' },
      { ...event, consensus: { displayValue: '0', numericValue: 0 } }, { ...event, title: 'x'.repeat(1025) },
      { ...event, eventType: 'financial-event' }, { ...event, sourceObservedAt: 'invalid' }]) expect(c.isMarketCalendarEvent(bad)).toBe(false)
    const hidden = { ...event }; Object.defineProperty(hidden, 'token', { value: 'private' })
    expect(c.isMarketCalendarEvent(hidden)).toBe(false)
  })
  it('accepts a safe country name before an unknown code and rejects unsafe names', async () => {
    const c = await contracts()
    expect(c.isMarketCalendarEvent({ ...event, countryCode: 'CHN', countryName: '中国' })).toBe(true)
    expect(c.isMarketCalendarEvent({ ...event, countryCode: 'CHN', countryName: '中国\u0000' })).toBe(false)
    expect(c.isMarketCalendarEvent({ ...event, countryCode: 'CHN', countryName: 'x'.repeat(513) })).toBe(false)
    expect(c.isMarketCalendarEvent({ ...event, countryCode: 'US', countryName: undefined })).toBe(false)
  })
  it('rejects sparse, accessor-backed, or extended public arrays', async () => {
    const c = await contracts()
    const events = [event]
    const sources = [{ eventType: 'economic-indicator', status: 'success', sourceObservedAt: input.asOf }]
    const page = { state: 'available', month: input.month, locale: input.locale, asOf: input.asOf, events, sources: [
      sources[0], { eventType: 'financial-event', status: 'success-empty', sourceObservedAt: input.asOf },
      { eventType: 'central-bank-activity', status: 'success-empty', sourceObservedAt: input.asOf }
    ] }
    expect(c.isMarketCalendarPage(page, input)).toBe(true)
    const extended = [...events] as unknown[] & { rawRecordId?: string }
    extended.rawRecordId = 'private'
    expect(c.isMarketCalendarPage({ ...page, events: extended }, input)).toBe(false)
    const sparse = [] as unknown[]
    sparse.length = 1
    expect(c.isMarketCalendarPage({ ...page, events: sparse }, input)).toBe(false)
    let reads = 0
    const accessor = [event]
    Object.defineProperty(accessor, '0', { get() { reads++; return event } })
    expect(c.isMarketCalendarPage({ ...page, events: accessor }, input)).toBe(false)
    expect(reads).toBe(0)
    const extraSources = [...page.sources]
    Object.defineProperty(extraSources, 'rawRecordId', { value: 'private', enumerable: true })
    expect(c.isMarketCalendarRefreshResult({ state: 'completed', sources: extraSources })).toBe(false)
    expect(c.isMarketCalendarPage({ ...page, sources: extraSources }, input)).toBe(false)
  })
})
