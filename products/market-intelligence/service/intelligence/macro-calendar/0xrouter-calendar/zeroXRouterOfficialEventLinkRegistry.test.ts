import { describe, expect, it } from 'vitest'
import { createZeroXRouterOfficialEventLinkRegistry, linkZeroXRouterEvent, mergeLinkedCalendarEvents, zeroXRouterOfficialEventLinks, type LinkableOfficialEvent, type LinkableMarketEvent } from './zeroXRouterOfficialEventLinkRegistry'

// Derived contract examples only; these are not provider evidence or admitted mappings.
const official: LinkableOfficialEvent = { unit: 'percent-yoy', eventKey: 'US.CPI.RELEASE.2026-M08', releaseGroupKey: 'US.CPI.RELEASE.2026-M08', eventFamily: 'consumer-price-index', periodKey: '2026-08', countryCode: 'US', scheduledDate: '2026-09-10', scheduledAt: undefined, actual: { displayValue: '3.0%', unit: 'percent-yoy' }, previous: { displayValue: '2.9%', unit: 'percent-yoy' }, publishedAt: '2026-09-10T12:30:00.000Z' }
const market: LinkableMarketEvent = { providerId: '0xrouter', descriptorId: 'macro-calendar-0xrouter-economic-data', locale: 'zh', eventKey: 'market-1', indicatorId: 'verified-cpi', countryCode: 'US', periodKey: '2026-08', unit: 'percent-yoy', scheduledAt: '2026-09-10T12:30:00.000Z', sourceObservedAt: '2026-09-10T12:31:00.000Z', consensus: { displayValue: '3.1%' }, providerPrevious: { displayValue: '2.9%' }, providerActual: { displayValue: '3.0%' } }

describe('zeroXRouter official event link registry', () => {
  it('admits exactly the PM-approved NFP batch, not other evidence, locale or candidate identity', () => {
    expect(zeroXRouterOfficialEventLinks).toHaveLength(1)
    expect(zeroXRouterOfficialEventLinks[0]).toMatchObject({ indicatorId: '8656', locale: 'zh', unit: 'thousands',
      periodKey: '2026-08', evidenceHash: '7f61e71c134bb5fd038a6dd63975b128162244e12b58750ebfe922ab57b0fd8c',
      sourceEventId: JSON.stringify(['212987', 73616]), providerScheduledAt: '2026-09-04T12:30:00.000Z' })
  })
  it('matches the admitted monthly representation and source-local release date, not UTC or Beijing dates', () => {
    const registry = createZeroXRouterOfficialEventLinkRegistry([{ descriptorId: 'macro-calendar-0xrouter-economic-data', locale: 'zh', indicatorId: 'verified-cpi', countryCode: 'US', periodKey: '2026-08', unit: 'percent-yoy', officialEventFamily: 'consumer-price-index', officialEventKey: official.eventKey, officialReleaseGroupKey: official.releaseGroupKey, evidenceHash: 'a'.repeat(64) }])
    const revisedOfficial = { ...official, periodKey: '2026-M08', unit: 'percent-yoy' }
    const nextUtcDay = { ...market, scheduledAt: '2026-09-11T01:00:00.000Z' }
    expect(linkZeroXRouterEvent(revisedOfficial, nextUtcDay, registry)).toBeDefined()
    for (const periodKey of ['2026-M07', '2026-Q3', '2026-M13']) {
      expect(linkZeroXRouterEvent({ ...revisedOfficial, periodKey }, nextUtcDay, registry)).toBeUndefined()
    }
  })
  it('requires the provider date even for date-only records and rejects absent official units', () => {
    const registry = createZeroXRouterOfficialEventLinkRegistry([{ descriptorId: 'macro-calendar-0xrouter-economic-data', locale: 'zh', indicatorId: 'verified-cpi', countryCode: 'US', periodKey: '2026-08', unit: 'percent-yoy', officialEventFamily: 'consumer-price-index', officialEventKey: official.eventKey, officialReleaseGroupKey: official.releaseGroupKey, evidenceHash: 'a'.repeat(64) }])
    expect(linkZeroXRouterEvent(official, { ...market, scheduledAt: undefined }, registry)).toBeUndefined()
    expect(linkZeroXRouterEvent({ ...official, unit: undefined }, market, registry)).toBeUndefined()
  })
  it('does not link an observation from another provider, descriptor or locale', () => {
    const registry = createZeroXRouterOfficialEventLinkRegistry([{ descriptorId: 'macro-calendar-0xrouter-economic-data', locale: 'zh', indicatorId: 'verified-cpi', countryCode: 'US', periodKey: '2026-08', unit: 'percent-yoy', officialEventFamily: 'consumer-price-index', officialEventKey: official.eventKey, officialReleaseGroupKey: official.releaseGroupKey, evidenceHash: 'a'.repeat(64) }])
    for (const mismatch of [{ providerId: 'other' }, { descriptorId: 'macro-calendar-0xrouter-financial-events' }, { locale: 'en' }] as const) {
      expect(linkZeroXRouterEvent(official, { ...market, ...mismatch }, registry)).toBeUndefined()
    }
  })
  it('never promotes a batch link into verified revision identity', () => {
    const registry = createZeroXRouterOfficialEventLinkRegistry([{ descriptorId: 'macro-calendar-0xrouter-economic-data', locale: 'zh', indicatorId: 'verified-cpi', countryCode: 'US', periodKey: '2026-08', unit: 'percent-yoy', officialEventFamily: 'consumer-price-index', officialEventKey: official.eventKey, officialReleaseGroupKey: official.releaseGroupKey, evidenceHash: 'a'.repeat(64) }])
    const linked = linkZeroXRouterEvent(official, market, registry)
    expect(linked).toBeDefined()
    expect(linked).not.toHaveProperty('identityState', 'verified')
  })
  it('rejects two official candidates for one market observation without order dependence', () => {
    const registry = createZeroXRouterOfficialEventLinkRegistry([{ descriptorId: 'macro-calendar-0xrouter-economic-data', locale: 'zh', indicatorId: 'verified-cpi', countryCode: 'US', periodKey: '2026-08', unit: 'percent-yoy', officialEventFamily: 'consumer-price-index', officialEventKey: official.eventKey, officialReleaseGroupKey: official.releaseGroupKey, evidenceHash: 'a'.repeat(64) }])
    expect(mergeLinkedCalendarEvents([official, official], [market], registry)).toHaveLength(3)
  })
  it('fails closed when identity evidence is absent or fields mismatch', () => {
    const registry = createZeroXRouterOfficialEventLinkRegistry([])
    expect(linkZeroXRouterEvent(official, market, registry)).toBeUndefined()
    expect(mergeLinkedCalendarEvents([official], [market], registry)).toHaveLength(2)
  })
  it('links only an exact admitted indicator/country/period/unit/locale descriptor', () => {
    const registry = createZeroXRouterOfficialEventLinkRegistry([{ descriptorId: 'macro-calendar-0xrouter-economic-data', locale: 'zh', indicatorId: 'verified-cpi', countryCode: 'US', periodKey: '2026-08', unit: 'percent-yoy', officialEventFamily: 'consumer-price-index', officialEventKey: official.eventKey, officialReleaseGroupKey: official.releaseGroupKey, evidenceHash: 'a'.repeat(64) }])
    expect(linkZeroXRouterEvent(official, market, registry)).toMatchObject({ officialEventKey: official.eventKey, marketEventKey: 'market-1', identityState: 'unverified', timeDisplaySource: 'provider-scheduled' })
    expect(linkZeroXRouterEvent(official, { ...market, indicatorId: 'wrong' }, registry)).toBeUndefined()
  })
  it('rejects conflicting duplicate identities instead of selecting one silently', () => {
    const links = [
      { descriptorId: 'macro-calendar-0xrouter-economic-data', locale: 'zh', indicatorId: 'verified-cpi', countryCode: 'US', periodKey: '2026-08', unit: 'percent-yoy', officialEventFamily: 'consumer-price-index', officialEventKey: official.eventKey, officialReleaseGroupKey: official.releaseGroupKey, evidenceHash: 'a'.repeat(64) },
      { descriptorId: 'macro-calendar-0xrouter-economic-data', locale: 'zh', indicatorId: 'verified-cpi', countryCode: 'US', periodKey: '2026-08', unit: 'percent-yoy', officialEventFamily: 'consumer-price-index', officialEventKey: official.eventKey, officialReleaseGroupKey: official.releaseGroupKey, evidenceHash: 'b'.repeat(64) }
    ] as const
    const registry = createZeroXRouterOfficialEventLinkRegistry(links)
    expect(linkZeroXRouterEvent(official, market, registry)).toBeUndefined()
  })
  it('keeps unlinked rows separate and applies official time precedence only after linking', () => {
    const registry = createZeroXRouterOfficialEventLinkRegistry([{ descriptorId: 'macro-calendar-0xrouter-economic-data', locale: 'zh', indicatorId: 'verified-cpi', countryCode: 'US', periodKey: '2026-08', unit: 'percent-yoy', officialEventFamily: 'consumer-price-index', officialEventKey: official.eventKey, officialReleaseGroupKey: official.releaseGroupKey, evidenceHash: 'a'.repeat(64) }])
    const merged = mergeLinkedCalendarEvents([official], [market], registry)
    expect(merged).toHaveLength(1)
    expect((merged[0] as { linked: { timeDisplaySource: string } }).linked.timeDisplaySource).toBe('provider-scheduled')
    expect(linkZeroXRouterEvent({ ...official, scheduledAt: '2026-09-10T13:00:00.000Z' }, market, registry)?.timeDisplaySource).toBe('official-scheduled')
    expect(linkZeroXRouterEvent({ ...official, scheduledAt: undefined }, { ...market, scheduledAt: undefined, scheduledDate: official.scheduledDate }, registry)?.timeDisplaySource).toBe('date-only')
  })
  it('requires exact period, unit, family, release date and observed timestamp', () => {
    const registry = createZeroXRouterOfficialEventLinkRegistry([{ descriptorId: 'macro-calendar-0xrouter-economic-data', locale: 'zh', indicatorId: 'verified-cpi', countryCode: 'US', periodKey: '2026-08', unit: 'percent-yoy', officialEventFamily: 'consumer-price-index', officialEventKey: official.eventKey, officialReleaseGroupKey: official.releaseGroupKey, evidenceHash: 'a'.repeat(64) }])
    expect(linkZeroXRouterEvent({ ...official, eventFamily: 'employment-situation' }, market, registry)).toBeUndefined()
    expect(linkZeroXRouterEvent(official, { ...market, periodKey: '2026-07' }, registry)).toBeUndefined()
    expect(linkZeroXRouterEvent(official, { ...market, unit: 'percent' }, registry)).toBeUndefined()
    expect(linkZeroXRouterEvent(official, { ...market, sourceObservedAt: 'invalid' }, registry)).toBeUndefined()
    expect(linkZeroXRouterEvent({ ...official, scheduledDate: '2026-02-30' }, market, registry)).toBeUndefined()
    expect(linkZeroXRouterEvent({ ...official, scheduledAt: 'invalid' }, market, registry)).toBeUndefined()
  })
})
