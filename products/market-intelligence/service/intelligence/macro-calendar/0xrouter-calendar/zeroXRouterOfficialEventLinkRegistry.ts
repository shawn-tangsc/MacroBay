import type { MacroEconomicCalendarValueView } from '../../../../contracts/macro/economicCalendarQueryContracts'
import type { MarketCalendarValue } from '../../../../contracts/macro/marketCalendarQueryContracts'

export type ZeroXRouterOfficialEventLink = Readonly<{
  descriptorId: 'macro-calendar-0xrouter-economic-data'
  locale: 'zh' | 'en'
  indicatorId: string
  countryCode: 'US'
  periodKey: string
  unit: string
  officialEventFamily: string
  officialEventKey: string
  officialReleaseGroupKey: string
  evidenceHash: string
  sourceEventId?: string
  providerScheduledAt?: string
}>
export const zeroXRouterOfficialEventLinks: readonly ZeroXRouterOfficialEventLink[] = Object.freeze([{
  descriptorId: 'macro-calendar-0xrouter-economic-data', locale: 'zh', indicatorId: '8656', countryCode: 'US', periodKey: '2026-08', unit: 'thousands',
  officialEventFamily: 'employment-situation', officialEventKey: 'US.NONFARM_PAYROLLS.RELEASE.2026-M08', officialReleaseGroupKey: 'US.EMPLOYMENT_SITUATION.RELEASE.2026-M08',
  evidenceHash: '7f61e71c134bb5fd038a6dd63975b128162244e12b58750ebfe922ab57b0fd8c', sourceEventId: JSON.stringify(['212987', 73616]), providerScheduledAt: '2026-09-04T12:30:00.000Z'
}])

export type LinkableOfficialEvent = Readonly<{
  eventKey: string; releaseGroupKey: string; eventFamily: string; periodKey: string; countryCode: string
  scheduledDate: string; scheduledAt?: string; unit?: string; actual?: MacroEconomicCalendarValueView; previous?: MacroEconomicCalendarValueView
  publishedAt?: string
}>
export type LinkableMarketEvent = Readonly<{
  providerId: string; descriptorId: string; locale: 'zh' | 'en'
  scheduledDate?: string
  eventKey: string; indicatorId?: string; countryCode: string | null; periodKey?: string; unit?: string; scheduledAt?: string
  sourceEventId?: string
  sourceObservedAt: string; consensus: MarketCalendarValue; providerPrevious: MarketCalendarValue; providerActual: MarketCalendarValue
}>
export type LinkedMacroCalendarEvent = Readonly<{
  officialEventKey: string; marketEventKey: string; identityState: 'unverified'
  timeDisplaySource: 'official-scheduled' | 'provider-scheduled' | 'date-only'
  displayScheduledAt?: string; officialScheduledAt?: string; providerScheduledAt?: string
  official: { actual?: MacroEconomicCalendarValueView; previous?: MacroEconomicCalendarValueView }; market: { consensus: MarketCalendarValue; providerPrevious: MarketCalendarValue; providerActual: MarketCalendarValue }
}>

// Design 122: format normalization only after explicit monthly evidence admission.
export const ZeroXRouterOfficialLinkPolicy = Object.freeze({
  provider: '0xrouter', country: 'US', releaseTimezone: 'America/New_York',
  monthlyPeriod: /^(\d{4})-(?:M)?(0[1-9]|1[0-2])$/,
  date: /^\d{4}-\d{2}-\d{2}$/
})
export function normalizeZeroXRouterLinkMonth(value: string): string | undefined {
  const match = ZeroXRouterOfficialLinkPolicy.monthlyPeriod.exec(value)
  return match ? `${match[1]}-${match[2]}` : undefined
}
function sourceDate(value: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: ZeroXRouterOfficialLinkPolicy.releaseTimezone,
    year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(value))
  const part = (type: string) => parts.find(item => item.type === type)!.value
  return `${part('year')}-${part('month')}-${part('day')}`
}

const descriptor = 'macro-calendar-0xrouter-economic-data' as const
export function createZeroXRouterOfficialEventLinkRegistry(links: readonly ZeroXRouterOfficialEventLink[]) {
  const valid = links.filter(link => Boolean(link) && link.descriptorId === descriptor && (link.locale === 'zh' || link.locale === 'en') &&
    link.countryCode === 'US' && typeof link.indicatorId === 'string' && link.indicatorId.length > 0 &&
    typeof link.periodKey === 'string' && link.periodKey.length > 0 && typeof link.unit === 'string' && link.unit.length > 0 && typeof link.officialEventFamily === 'string' && link.officialEventFamily.length > 0 &&
    typeof link.evidenceHash === 'string' && /^[a-f0-9]{64}$/.test(link.evidenceHash) && typeof link.officialEventKey === 'string' && link.officialEventKey.length > 0 &&
    typeof link.officialReleaseGroupKey === 'string' && link.officialReleaseGroupKey.length > 0)
  const identities = new Map<string, ZeroXRouterOfficialEventLink>()
  for (const link of valid) {
    const identity = JSON.stringify([link.locale, link.indicatorId, link.countryCode, link.periodKey, link.unit, link.officialEventFamily, link.officialEventKey, link.officialReleaseGroupKey])
    const previous = identities.get(identity)
    if (previous && previous.evidenceHash !== link.evidenceHash) identities.set(identity, { ...link, evidenceHash: '' })
    else if (!previous) identities.set(identity, link)
  }
  return Object.freeze([...identities.values()].filter(link => link.evidenceHash).map(link => Object.freeze({ ...link })))
}

export function linkZeroXRouterEvent(official: LinkableOfficialEvent, market: LinkableMarketEvent,
  registry: readonly ZeroXRouterOfficialEventLink[], locale: 'zh' | 'en' = 'zh'): LinkedMacroCalendarEvent | undefined {
  if (!official || !market || market.providerId !== '0xrouter' || market.descriptorId !== descriptor || market.locale !== locale || (locale !== 'zh' && locale !== 'en') || typeof official.eventKey !== 'string' ||
    typeof official.periodKey !== 'string' || typeof official.eventFamily !== 'string' || typeof official.releaseGroupKey !== 'string' || typeof official.scheduledDate !== 'string' ||
    !normalizeZeroXRouterLinkMonth(official.periodKey) || !ZeroXRouterOfficialLinkPolicy.date.test(official.scheduledDate) || !validDate(official.scheduledDate) ||
    typeof market.eventKey !== 'string' || typeof market.indicatorId !== 'string' || typeof market.countryCode !== 'string' ||
    typeof market.sourceObservedAt !== 'string' || !isInstant(market.sourceObservedAt) ||
    (official.scheduledAt !== undefined && !isInstant(official.scheduledAt)) ||
    (market.scheduledAt !== undefined && !isInstant(market.scheduledAt)) ||
    (!market.scheduledAt && (!market.scheduledDate || !validDate(market.scheduledDate)))) return undefined
  const match = registry.find(link => link.locale === locale && link.indicatorId === market.indicatorId &&
    link.countryCode === official.countryCode && link.periodKey === normalizeZeroXRouterLinkMonth(official.periodKey) && market.periodKey === link.periodKey && link.unit === market.unit && link.officialEventFamily === official.eventFamily &&
    official.unit === market.unit &&
    link.officialEventKey === official.eventKey && link.officialReleaseGroupKey === official.releaseGroupKey && official.countryCode === 'US' && market.countryCode === 'US' &&
    official.scheduledDate === (market.scheduledAt ? sourceDate(market.scheduledAt) : market.scheduledDate) &&
    (!link.sourceEventId || link.sourceEventId === market.sourceEventId))
  if (!match) return undefined
  const timeDisplaySource = official.scheduledAt ? 'official-scheduled' : market.scheduledAt ? 'provider-scheduled' : 'date-only'
  return { officialEventKey: official.eventKey, marketEventKey: market.eventKey, identityState: 'unverified',
    timeDisplaySource, ...(official.scheduledAt ? { displayScheduledAt: official.scheduledAt } : market.scheduledAt ? { displayScheduledAt: market.scheduledAt } : {}),
    ...(official.scheduledAt ? { officialScheduledAt: official.scheduledAt } : {}), ...(market.scheduledAt ? { providerScheduledAt: market.scheduledAt } : {}),
    official: { ...(official.actual !== undefined ? { actual: official.actual } : {}), ...(official.previous !== undefined ? { previous: official.previous } : {}) },
    market: { consensus: market.consensus, providerPrevious: market.providerPrevious, providerActual: market.providerActual } }
}

function isInstant(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value
}
function validDate(value: string): boolean {
  if (!ZeroXRouterOfficialLinkPolicy.date.test(value) || !Number.isFinite(Date.parse(`${value}T00:00:00.000Z`))) return false
  const date = new Date(`${value}T00:00:00.000Z`)
  return date.toISOString().slice(0, 10) === value
}

export function mergeLinkedCalendarEvents<TOfficial extends LinkableOfficialEvent, TMarket extends LinkableMarketEvent>(
  officialEvents: readonly TOfficial[], marketEvents: readonly TMarket[], registry: readonly ZeroXRouterOfficialEventLink[], locale: 'zh' | 'en' = 'zh'
): Readonly<{ official: TOfficial; market: TMarket; linked: LinkedMacroCalendarEvent } | TOfficial | TMarket>[] {
  const consumedMarket = new Set<string>()
  const merged: (TOfficial | TMarket | { official: TOfficial; market: TMarket; linked: LinkedMacroCalendarEvent })[] = []
  for (const official of officialEvents) {
    const candidates = marketEvents.filter(market => !consumedMarket.has(market.eventKey) &&
      linkZeroXRouterEvent(official, market, registry, locale))
    const candidate = candidates.length === 1 && officialEvents.filter(other =>
      linkZeroXRouterEvent(other, candidates[0]!, registry, locale)).length === 1 ? candidates[0] : undefined
    const linked = candidate && linkZeroXRouterEvent(official, candidate, registry, locale)
    if (candidate && linked) {
      consumedMarket.add(candidate.eventKey)
      merged.push({ official, market: candidate, linked })
    } else merged.push(official)
  }
  merged.push(...marketEvents.filter(market => !consumedMarket.has(market.eventKey)))
  return merged
}
